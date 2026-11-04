// Polling (plan 1.6): one posts query per due shop, inside the rate rules of plan 1.2.
import type { Env } from "./env";
import type { ShopRow } from "./db";
import { BufferError, blockedUntil, nearLimit } from "./buffer/client";
import { syncPostsPage } from "./sync";
import { inOpeningWindow } from "../shared/time";

const MIN = 60000;

/** Should this shop be polled at `now`? (plan 1.2 budget, 1.6 polling) */
export function pollIsDue(shop: Pick<ShopRow, "awake_until" | "last_polled_at" | "polls_quiet" | "timezone">, now: Date): boolean {
  const last = shop.last_polled_at ? new Date(shop.last_polled_at).getTime() : 0;
  const since = now.getTime() - last;
  if (since >= 60 * MIN) return true; // hourly otherwise
  const awake = !!shop.awake_until && new Date(shop.awake_until).getTime() > now.getTime();
  if (!awake || !inOpeningWindow(now, shop.timezone)) return false;
  // Every 15 minutes, or every 30 after two quiet polls in a row. A minute of slack for cron jitter.
  const interval = (shop.polls_quiet ?? 0) >= 2 ? 30 * MIN : 15 * MIN;
  return since >= interval - MIN;
}

export interface PollDeps {
  token: (shopId: string) => Promise<string | null>;
  notify: (shopId: string, newPosts: number) => Promise<void>;
  syncRunning: (shopId: string) => Promise<boolean>;
}

/** One poll: posts since last_polled_at − 48 h, first 100. Returns the count of new posts. */
export async function pollShop(env: Env, shop: ShopRow, deps: PollDeps, now = new Date()): Promise<number> {
  const token = await deps.token(shop.id);
  if (!token) return 0;
  const last = shop.last_polled_at ? new Date(shop.last_polled_at) : new Date(now.getTime() - 60 * 86400000);
  const since = new Date(last.getTime() - 48 * 3600000);
  const page = await syncPostsPage(env, shop, token, since, null, 100);
  const quiet = page.newPosts > 0 ? 0 : (shop.polls_quiet ?? 0) + 1;
  await env.DB.prepare(`UPDATE shops SET last_polled_at = ?2, polls_quiet = ?3 WHERE id = ?1`).bind(shop.id, now.toISOString(), quiet).run();
  await deps.notify(shop.id, page.newPosts);
  return page.newPosts;
}

/** The 15-minute cron (plan 1.6). */
export async function pollDue(env: Env, deps: PollDeps, now = new Date()): Promise<{ polled: string[]; skipped: string }> {
  if (await blockedUntil(env)) return { polled: [], skipped: "blocked" };
  if (await nearLimit(env)) return { polled: [], skipped: "near-limit" };
  const { results } = await env.DB.prepare(
    `SELECT s.* FROM shops s JOIN buffer_tokens b ON b.shop_id = s.id WHERE s.deleted_at IS NULL AND s.revoked_at IS NULL`,
  ).all<ShopRow>();
  const polled: string[] = [];
  for (const shop of results) {
    if (!pollIsDue(shop, now)) continue;
    if (await deps.syncRunning(shop.id)) continue;
    try {
      await pollShop(env, shop, deps, now);
      polled.push(shop.id);
    } catch (e) {
      // Buffer down during a poll: nothing shown; retry next tick (plan 1.8). A 429 stops the round.
      if (e instanceof BufferError && (e.kind === "rate_limited" || e.kind === "blocked")) break;
    }
  }
  return { polled, skipped: "" };
}
