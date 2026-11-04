// ShopRoom: one Durable Object per shop (plan 1.4). It holds the open owner
// screens' WebSockets, rings them, owns the single place Buffer tokens are
// refreshed, and runs the first sync page by page on alarms (plan 1.6).
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { RoomMessage } from "../shared/types";
import { BufferError, refreshToken } from "./buffer/client";
import { loadTokens, storeTokens } from "./tokens";
import { getShop } from "./db";
import { syncChannels, syncPostsPage, FIRST_SYNC_DAYS } from "./sync";
import { runJobs } from "./writes";

interface SyncState {
  shopId: string;
  since: string;
  cursor: string | null;
  count: number;
  startedAt: string;
  failures: number;
  channelsDone: boolean;
}

export class ShopRoom extends DurableObject<Env> {
  private tokenLock: Promise<unknown> = Promise.resolve();

  // ---- sockets ----

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const url = new URL(request.url);
    const device = (url.searchParams.get("device") ?? "").slice(0, 64) || "unknown";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`d:${device}`]);
    server.send(JSON.stringify({ type: "hello", now: new Date().toISOString() } satisfies RoomMessage));
    const sync = await this.ctx.storage.get<SyncState>("sync");
    if (sync) server.send(JSON.stringify({ type: "sync", status: "running", count: sync.count } satisfies RoomMessage));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {}
  }

  /** Send to every open owner screen except the tapping device (plan 1.4). Returns how many got it. */
  async ring(message: RoomMessage, exceptDevice?: string | null): Promise<number> {
    return this.broadcast(message, exceptDevice);
  }

  async broadcast(message: RoomMessage, exceptDevice?: string | null): Promise<number> {
    const data = JSON.stringify(message);
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (exceptDevice && this.ctx.getTags(ws).includes(`d:${exceptDevice}`)) continue;
      try {
        ws.send(data);
        sent++;
      } catch {}
    }
    return sent;
  }

  async openScreens(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  // ---- tokens ----

  /**
   * The access token, refreshed under the object's single lock when fewer
   * than 5 minutes remain. Refresh tokens rotate and are single-use, so this
   * is the only place that refreshes (plan 1.2).
   */
  async getToken(shopId: string): Promise<string | null> {
    const run = this.tokenLock.then(() => this.getTokenLocked(shopId));
    this.tokenLock = run.catch(() => undefined);
    return run;
  }

  private async getTokenLocked(shopId: string): Promise<string | null> {
    const t = await loadTokens(this.env, shopId);
    if (!t) return null;
    if (t.expiresAt.getTime() - Date.now() > 5 * 60000) return t.access;
    try {
      const fresh = await refreshToken(this.env, t.refresh);
      await storeTokens(this.env, shopId, fresh, t.refresh);
      return fresh.access_token;
    } catch (e) {
      if (e instanceof BufferError && e.kind === "unauthorized") {
        await this.env.DB.prepare(`UPDATE shops SET revoked_at = ?2 WHERE id = ?1`).bind(shopId, new Date().toISOString()).run();
        await this.broadcast({ type: "posts", reason: "refresh" });
        return null;
      }
      throw e;
    }
  }

  // ---- first sync ----

  /** Start (or restart) the first sync: channels, then 60 days of sent posts, one page per alarm. */
  async startSync(shopId: string): Promise<void> {
    const state: SyncState = {
      shopId,
      since: new Date(Date.now() - FIRST_SYNC_DAYS * 86400000).toISOString(),
      cursor: null,
      count: 0,
      startedAt: new Date().toISOString(),
      failures: 0,
      channelsDone: false,
    };
    await this.ctx.storage.put("sync", state);
    await this.ctx.storage.setAlarm(Date.now() + 10);
    await this.broadcast({ type: "sync", status: "running", count: 0 });
  }

  async syncStatus(): Promise<{ running: boolean; count: number; startedAt: string | null; failures: number }> {
    const s = await this.ctx.storage.get<SyncState>("sync");
    return { running: !!s, count: s?.count ?? 0, startedAt: s?.startedAt ?? null, failures: s?.failures ?? 0 };
  }

  /** A tile just reached a winner's count: run its tag and note soon, off the tap's request (plan 1.7). */
  async kickJobs(shopId: string): Promise<void> {
    await this.ctx.storage.put("jobs", shopId);
    const at = await this.ctx.storage.getAlarm();
    if (!at || at > Date.now() + 1000) await this.ctx.storage.setAlarm(Date.now() + 500);
  }

  async alarm(): Promise<void> {
    const jobsFor = await this.ctx.storage.get<string>("jobs");
    if (jobsFor) {
      await this.ctx.storage.delete("jobs");
      try {
        const n = await runJobs(this.env, jobsFor);
        if (n) await this.broadcast({ type: "posts", reason: "refresh" });
      } catch (e) {
        console.error("jobs failed", jobsFor, (e as Error)?.message);
      }
    }
    const state = await this.ctx.storage.get<SyncState>("sync");
    if (!state) return;
    const shop = await getShop(this.env, state.shopId);
    if (!shop || shop.deleted_at) {
      await this.ctx.storage.delete("sync");
      return;
    }
    try {
      const token = await this.getToken(shop.id);
      if (!token) {
        await this.finishSync(state, "failed");
        return;
      }
      if (!state.channelsDone) {
        await syncChannels(this.env, shop, token);
        state.channelsDone = true;
        await this.ctx.storage.put("sync", state);
        await this.ctx.storage.setAlarm(Date.now() + 10);
        return;
      }
      const fresh = (await getShop(this.env, shop.id)) ?? shop;
      const before = state.count;
      const page = await syncPostsPage(this.env, fresh, token, new Date(state.since), state.cursor, undefined, async (n) => {
        await this.broadcast({ type: "sync", status: "running", count: before + n });
      });
      state.count = before + page.upserted;
      state.cursor = page.endCursor;
      state.failures = 0;
      await this.ctx.storage.put("sync", state);
      await this.broadcast({ type: "sync", status: "running", count: state.count });
      if (page.hasNextPage && page.endCursor) {
        await this.ctx.storage.put("sync", state);
        await this.ctx.storage.setAlarm(Date.now() + 50);
      } else {
        await this.finishSync(state, "idle");
      }
    } catch (e) {
      state.failures += 1;
      console.error("first sync page failed", state.shopId, state.failures, (e as Error)?.message);
      if (state.failures >= 20) {
        // "We'll keep trying; your wall will fill in on its own": the hourly poll takes over.
        await this.finishSync(state, "failed");
        return;
      }
      await this.ctx.storage.put("sync", state);
      const retryIn = e instanceof BufferError && e.retryAfterSeconds ? e.retryAfterSeconds * 1000 : Math.min(60000, 2000 * 2 ** state.failures);
      // "We'll keep trying; your wall will fill in on its own." (plan 1.8)
      await this.broadcast({ type: "sync", status: state.failures >= 3 ? "failed" : "running", count: state.count });
      await this.ctx.storage.setAlarm(Date.now() + retryIn);
    }
  }

  private async finishSync(state: SyncState, status: "idle" | "failed"): Promise<void> {
    await this.ctx.storage.delete("sync");
    await this.env.DB.prepare(`UPDATE shops SET last_polled_at = ?2, polls_quiet = 0 WHERE id = ?1`).bind(state.shopId, new Date().toISOString()).run();
    await this.broadcast({ type: "sync", status, count: state.count, done: true });
    await this.broadcast({ type: "posts", reason: "sync", count: state.count });
  }
}
