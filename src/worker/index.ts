// Came In: the Worker. Routes, the tap, the owner API, images and the crons.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import QRCode from "qrcode";
import type { Env } from "./env";
import { ShopRoom } from "./shoproom";
import {
  authorizeUrl,
  exchangeCode,
  graphql,
  blockedUntil,
  BufferError,
} from "./buffer/client";
import { ACCOUNT } from "./buffer/queries";
import { codeChallenge, codeVerifier, randomToken, shopId as newShopId, encrypt, decrypt, timingSafeEqual } from "./lib/crypto";
import { setOwnerCookie, ownerShopId, setOAuthCookie, readOAuthCookie, clearOAuthCookie, sampleSession } from "./lib/cookies";
import { getShop, liveShop, wallTiles, tapGrid, postCounts, wake, type ShopRow } from "./db";
import { storeTokens } from "./tokens";
import { syncChannels, setCardChannel, retryMissingImages } from "./sync";
import { pollDue, pollShop } from "./poll";
import { parseTapInput, recordTap } from "./taps";
import { sampleWall, recordSampleTap, isSampleTile, deleteOldSampleTaps } from "./sample";
import { renderTapPage, renderGonePage, type TapTile } from "./render/tap";
import { renderLanding, renderPrivacy, renderCredits } from "./render/site";
import { SAMPLE_SHOP, SAMPLE_POSTS } from "../shared/sample";

const SAMPLE_POSTS_BY_ID = new Map(SAMPLE_POSTS.map((p) => [p.id, p]));
import { dayBadge, bellSentence, whereLine, firstLine } from "../shared/names";
import { isValidTimeZone } from "../shared/time";
import type { WallData, WallTile, ChannelRow } from "../shared/types";
import type { TokenResponse } from "./buffer/client";
import { pushShop, pushSample, parseSubscription, saveShopSub, saveSampleSub, pushConfigured, type PushNote } from "./push";
import { openCounter, getCounter, closeCounter, parseCounterTap, recordCounterTap } from "./counter";
import { renderCounterPage, renderCounterClosed } from "./render/counter";
import { renderCard, cardSize, type CardSize } from "./render/card";
import { parsePatch, shopSettings, saveShopSettings, sampleSettings, saveSampleSettings, setSample, deleteShop } from "./settings";
import { clearOwnerCookie } from "./lib/cookies";
import { shopWeek, parseRange } from "./week";
import { shopPostPage } from "./post";
import { postAgain, postShare, moreLikeThis, queueWinnerJobs, runJobs, againTargets, refusalFor, type PostTarget, type ChannelResult } from "./writes";
import { sampleWeek, samplePostPage, SAMPLE_CHANNELS } from "./sample";
import { mondayBody, summarize } from "../shared/week";
import { zonedParts, shopWeekKey } from "../shared/time";

export { ShopRoom };

type C = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const PENDING_COOKIE = "ci_pending";

function room(env: Env, name: string) {
  return env.SHOP_ROOM.get(env.SHOP_ROOM.idFromName(name));
}

function origin(c: C): string {
  return new URL(c.req.url).origin;
}

/** The address printed on cards and pasted on receipts: this Worker's public origin (plan section 2). */
function publicOrigin(c: C): string {
  return (c.env.PUBLIC_ORIGIN || origin(c)).replace(/\/+$/, "");
}

async function ownerShop(c: C): Promise<ShopRow | null> {
  const id = await ownerShopId(c);
  return id ? liveShop(c.env, id) : null;
}

function noStore(c: C) {
  c.header("Cache-Control", "no-store");
}

// A real error on our side (D1 or R2): the owner app shows the stamp strip (plan 1.8).
app.onError((err, c) => {
  console.error("came-in error", c.req.method, new URL(c.req.url).pathname, err?.message);
  if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ error: "server" }, 500);
  return c.text("Something's wrong on our side. Try again in a minute.", 500);
});

// ---------- Public pages ----------

app.get("/", (c) => {
  const e = c.req.query("error");
  return c.html(renderLanding({ error: e === "denied" ? "denied" : e === "exchange" ? "exchange" : null, contactEmail: c.env.CONTACT_EMAIL ?? null }));
});
app.get("/privacy", (c) => c.html(renderPrivacy(c.env.CONTACT_EMAIL ?? null)));
app.get("/credits", (c) => c.html(renderCredits(c.env.CONTACT_EMAIL ?? null)));

// ---------- OAuth (plan 1.2) ----------

app.get("/auth/start", async (c) => {
  const verifier = codeVerifier();
  const state = randomToken(32);
  await setOAuthCookie(c, { verifier, state });
  const url = authorizeUrl(c.env, { redirectUri: `${origin(c)}/auth/callback`, state, codeChallenge: await codeChallenge(verifier) });
  return c.redirect(url, 302);
});

interface AccountData {
  account: { id: string; name: string | null; timezone: string | null; organizations: { id: string; name: string }[] };
}

app.get("/auth/callback", async (c) => {
  const q = c.req.query();
  if (q.error) {
    clearOAuthCookie(c);
    return c.redirect(q.error === "access_denied" ? "/?error=denied" : "/?error=exchange", 302);
  }
  const saved = await readOAuthCookie(c);
  clearOAuthCookie(c);
  if (!saved || !q.code || !q.state || !timingSafeEqual(saved.state, q.state)) return c.redirect("/?error=exchange", 302);
  let tokens: TokenResponse;
  let acct: AccountData["account"];
  try {
    tokens = await exchangeCode(c.env, { code: q.code, redirectUri: `${origin(c)}/auth/callback`, verifier: saved.verifier });
    const { data } = await graphql<AccountData>(c.env, tokens.access_token, ACCOUNT, {}, { skipBlockCheck: true });
    acct = data.account;
  } catch (e) {
    console.error("connect failed", (e as Error).message);
    return c.redirect("/?error=exchange", 302);
  }
  const tz = acct.timezone && isValidTimeZone(acct.timezone) ? acct.timezone : "Europe/London";
  const orgs = acct.organizations ?? [];
  if (orgs.length === 0) return c.redirect("/?error=exchange", 302);
  if (orgs.length === 1) {
    const shop = await connectShop(c.env, acct.id, orgs[0], tz, tokens);
    await setOwnerCookie(c, shop.id);
    return c.redirect("/setup/channels", 302);
  }
  // Several organizations: "Which shop?" (plan 3.2). The tokens wait, encrypted, in a ten-minute cookie.
  const pending = await encrypt(JSON.stringify({ accountId: acct.id, orgs, tz, tokens, at: Date.now() }), c.env.TOKEN_ENC_KEY);
  setCookie(c, PENDING_COOKIE, pending, { httpOnly: true, secure: origin(c).startsWith("https:"), sameSite: "Lax", path: "/", maxAge: 600 });
  return c.redirect("/setup/org", 302);
});

async function readPending(c: C): Promise<{ accountId: string; orgs: { id: string; name: string }[]; tz: string; tokens: TokenResponse } | null> {
  const raw = getCookie(c, PENDING_COOKIE);
  if (!raw) return null;
  try {
    const p = JSON.parse(await decrypt(raw, c.env.TOKEN_ENC_KEY));
    if (Date.now() - p.at > 600000) return null;
    return p;
  } catch {
    return null;
  }
}

/** Make or find the shop for an account and organization, and keep its tokens (plan 1.2 step 3). */
export async function connectShop(env: Env, accountId: string, org: { id: string; name: string }, tz: string, tokens: TokenResponse): Promise<ShopRow> {
  let shop = await env.DB.prepare(`SELECT * FROM shops WHERE buffer_account_id = ?1 AND buffer_org_id = ?2`).bind(accountId, org.id).first<ShopRow>();
  const now = new Date().toISOString();
  if (!shop) {
    const id = newShopId();
    await env.DB.prepare(
      `INSERT INTO shops (id, buffer_account_id, buffer_org_id, name, handle, timezone, created_at) VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)`,
    ).bind(id, accountId, org.id, org.name, tz, now).run();
    shop = (await getShop(env, id))!;
  } else {
    await env.DB.prepare(`UPDATE shops SET revoked_at = NULL, deleted_at = NULL WHERE id = ?1`).bind(shop.id).run();
  }
  await storeTokens(env, shop.id, tokens);
  return shop;
}

app.get("/api/orgs", async (c) => {
  noStore(c);
  const p = await readPending(c);
  if (!p) return c.json({ error: "expired" }, 404);
  return c.json({ orgs: p.orgs.map((o) => ({ id: o.id, name: o.name })) });
});

app.post("/api/setup/org", async (c) => {
  const p = await readPending(c);
  if (!p) return c.json({ error: "expired" }, 404);
  const { org } = await c.req.json<{ org: string }>().catch(() => ({ org: "" }));
  const chosen = p.orgs.find((o) => o.id === org);
  if (!chosen) return c.json({ error: "no such shop" }, 400);
  const shop = await connectShop(c.env, p.accountId, chosen, p.tz, p.tokens);
  deleteCookie(c, PENDING_COOKIE, { path: "/" });
  await setOwnerCookie(c, shop.id);
  return c.json({ ok: true, next: "/setup/channels" });
});

// ---------- First run: channels and the first sync (plan 3.3) ----------

async function channelRows(env: Env, shop: ShopRow): Promise<ChannelRow[]> {
  const { results } = await env.DB.prepare(`SELECT id, name, display_name, service, avatar, enabled FROM channels WHERE shop_id = ?1 ORDER BY rowid`).bind(shop.id).all<{ id: string; name: string; display_name: string | null; service: string; avatar: string | null; enabled: number }>();
  return results.map((r) => ({ id: r.id, name: r.name, displayName: r.display_name, service: r.service, avatar: r.avatar, enabled: !!r.enabled, onCard: r.id === shop.card_channel_id }));
}

app.get("/api/channels", async (c) => {
  noStore(c);
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  let rows = await channelRows(c.env, shop);
  if (!rows.length) {
    const token = await room(c.env, shop.id).getToken(shop.id);
    if (!token) return c.json({ error: "reconnect" }, 409);
    try {
      await syncChannels(c.env, shop, token);
    } catch (e) {
      if (e instanceof BufferError) return c.json({ error: "buffer", kind: e.kind }, 503);
      throw e;
    }
    rows = await channelRows(c.env, (await getShop(c.env, shop.id))!);
  }
  return c.json({ channels: rows });
});

app.post("/api/channels", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const body = await c.req.json<{ enabled?: string[]; card?: string }>().catch(() => ({}) as { enabled?: string[]; card?: string });
  const rows = await channelRows(c.env, shop);
  const enabled = new Set((body.enabled ?? []).filter((id) => rows.some((r) => r.id === id)));
  if (!enabled.size) return c.json({ error: "Pick at least one channel." }, 400);
  await c.env.DB.batch(rows.map((r) => c.env.DB.prepare(`UPDATE channels SET enabled = ?2 WHERE id = ?1`).bind(r.id, enabled.has(r.id) ? 1 : 0)));
  const card = body.card && enabled.has(body.card) ? body.card : rows.find((r) => r.onCard && enabled.has(r.id))?.id ?? [...enabled][0];
  await setCardChannel(c.env, shop, card);
  await room(c.env, shop.id).startSync(shop.id);
  return c.json({ ok: true });
});

app.get("/api/sync", async (c) => {
  noStore(c);
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const s = await room(c.env, shop.id).syncStatus();
  const posts = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM posts WHERE shop_id = ?1`).bind(shop.id).first<{ n: number }>();
  return c.json({ running: s.running, count: Math.max(s.count, s.running ? 0 : posts?.n ?? 0), startedAt: s.startedAt, failures: s.failures });
});

// ---------- The wall (plan 3.4) ----------

app.get("/api/wall", async (c) => {
  noStore(c);
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const now = new Date();
  await wake(c.env, shop.id, now);
  const [tiles, counts, sync, blocked, extras] = await Promise.all([
    wallTiles(c.env, shop, now, { includeHidden: true }),
    postCounts(c.env, shop, now),
    room(c.env, shop.id).syncStatus(),
    blockedUntil(c.env),
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM counters WHERE shop_id = ?1) AS counters, (SELECT COUNT(*) FROM push_subs WHERE shop_id = ?1 AND failed_at IS NULL) AS subs`,
    ).bind(shop.id).first<{ counters: number; subs: number }>(),
  ]);
  const data: WallData = {
    shop: {
      id: shop.id,
      name: shop.name,
      handle: shop.handle,
      avatarUrl: shop.avatar_key ? `/i/${shop.id}/avatar` : null,
      timezone: shop.timezone,
      theme: shop.theme,
      isSample: false,
      markWinners: !!shop.mark_winners,
      tapUrl: `${publicOrigin(c)}/t/${shop.id}`,
      createdAt: shop.created_at,
    },
    tiles,
    countToday: counts.today,
    countThisWeek: counts.week,
    hasTapped: counts.any,
    sync: { status: sync.running ? (sync.failures >= 3 ? "failed" : "running") : "idle", count: sync.count, startedAt: sync.startedAt },
    strips: { rateLimited: !!blocked, reconnect: !!shop.revoked_at },
    checklist: {
      connected: true,
      card: !!shop.card_printed_at,
      counter: (extras?.counters ?? 0) > 0,
      phone: (extras?.subs ?? 0) > 0,
      thankYou: !!shop.thank_you_text,
      review: !!shop.review_url,
    },
    now: now.toISOString(),
  };
  return c.json(data);
});

/** Refresh: once per 60 s per shop; otherwise {"waited":true} (plan 1.6). */
app.post("/api/refresh", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  if (shop.last_polled_at && Date.now() - new Date(shop.last_polled_at).getTime() < 60000) return c.json({ waited: true });
  if (shop.revoked_at) return c.json({ waited: false, newPosts: 0, reconnect: true });
  const r = room(c.env, shop.id);
  try {
    const newPosts = await pollShop(c.env, shop, {
      token: (id) => r.getToken(id),
      notify: async () => {},
      syncRunning: async () => false,
    });
    return c.json({ waited: false, newPosts });
  } catch (e) {
    if (e instanceof BufferError) return c.json({ waited: false, newPosts: 0, rateLimited: e.kind === "rate_limited" || e.kind === "blocked" });
    throw e;
  }
});

app.get("/api/ws", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.text("signed out", 401);
  if (c.req.header("Upgrade") !== "websocket") return c.text("expected websocket", 426);
  return room(c.env, shop.id).fetch(c.req.raw);
});

// ---------- QR codes (inline SVG from the qrcode package, plan section 2) ----------

async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 4, errorCorrectionLevel: "M", color: { dark: "#231F1B", light: "#FFFFFF" } });
}

app.get("/qr/sample.svg", async (c) => {
  c.header("Content-Type", "image/svg+xml");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(await qrSvg(`${publicOrigin(c)}/sample/t`));
});

app.get("/qr/:file", async (c) => {
  const m = /^([a-z]{10})\.svg$/.exec(c.req.param("file"));
  if (!m) return c.notFound();
  const shop = await liveShop(c.env, m[1]);
  if (!shop) return c.notFound();
  c.header("Content-Type", "image/svg+xml");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(await qrSvg(`${publicOrigin(c)}/t/${shop.id}`));
});

// ---------- Images from R2, served through the Worker (no public bucket, plan 1.6) ----------

async function serveR2(c: C, key: string, cache: string) {
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("Cache-Control", cache);
  h.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers: h });
}

app.get("/i/:shop{[a-z]{10}}/avatar", (c) => serveR2(c, `avatars/${c.req.param("shop")}`, "public, max-age=86400"));
app.get("/i/:shop{[a-z]{10}}/:post/full", (c) => serveR2(c, `full/${c.req.param("shop")}/${c.req.param("post")}`, "public, max-age=31536000, immutable"));
app.get("/i/:shop{[a-z]{10}}/:post", (c) => serveR2(c, `thumbs/${c.req.param("shop")}/${c.req.param("post")}`, "public, max-age=31536000, immutable"));

// ---------- The tap page (plan 3.5) ----------

function toTapTile(t: WallTile, now: Date, tz: string): TapTile {
  return {
    id: t.id,
    name: t.name,
    imageUrl: t.imageUrl,
    text: firstLine(t.text),
    badge: dayBadge(new Date(t.firstSentAt), now, tz, t.isLive, "tap"),
    live: t.isLive,
  };
}

app.get("/t/:shop{[a-z]{10}}", async (c) => {
  c.header("Cache-Control", "no-store");
  const shop = await liveShop(c.env, c.req.param("shop"));
  if (!shop) return c.html(renderGonePage(), 404);
  const now = new Date();
  c.executionCtx.waitUntil(wake(c.env, shop.id, now));
  const { story, tiles } = tapGrid(await wallTiles(c.env, shop, now));
  return c.html(
    renderTapPage({
      mode: "shop",
      shop: { id: shop.id, name: shop.name, handle: shop.handle, avatarUrl: shop.avatar_key ? `/i/${shop.id}/avatar` : null, timezone: shop.timezone },
      story: story ? toTapTile(story, now, shop.timezone) : null,
      tiles: tiles.map((t) => toTapTile(t, now, shop.timezone)),
      thankYou: shop.thank_you_text,
      reviewUrl: shop.review_url,
      tapEndpoint: "/api/tap",
      source: "card",
      // "Open the tap page" on the owner's own screen uses a separate device id, so this screen rings.
      deviceKey: c.req.query("try") ? "ci_device_try" : "ci_device",
      showHeader: true,
    }),
  );
});

app.post("/api/tap", async (c) => {
  const input = parseTapInput(await c.req.json().catch(() => null));
  if (!input) return c.json({ ok: false, error: "bad tap" }, 400);
  const out = await recordTap(c.env, input);
  if (out.status === 200 && "ring" in out && out.ring) {
    const r = room(c.env, input.shop);
    // The bell rings for every open owner screen except the tapping device, then every phone (plan 1.4).
    const shop = await liveShop(c.env, input.shop);
    c.executionCtx.waitUntil(r.ring(out.ring.message, out.ring.exceptDevice));
    if (shop) c.executionCtx.waitUntil(pushShop(c.env, shop.id, ringNote(shop.name, shop.avatar_key ? `/i/${shop.id}/avatar` : null, out.ring.message.sentence, `/post/${out.ring.message.tileId}`, out.ring.message.tileId), out.ring.exceptDevice));
    if (shop && out.ring.message.tileId && (await queueWinnerJobs(c.env, shop, out.ring.message.tileId, out.ring.message.count))) c.executionCtx.waitUntil(r.kickJobs(shop.id));
  }
  return c.json(out.body, out.status);
});

// ---------- The sample bakery (plan 3.10) ----------

app.get("/api/sample/wall", async (c) => {
  noStore(c);
  const session = sampleSession(c, () => randomToken(32));
  const [wall, settings, subs] = await Promise.all([
    sampleWall(c.env, session),
    sampleSettings(c.env, session),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sample_push_subs WHERE session_id = ?1 AND failed_at IS NULL`).bind(session).first<{ n: number }>(),
  ]);
  wall.shop.theme = settings.theme;
  wall.checklist = { connected: true, card: settings.cardPrinted, counter: settings.counterOpened, phone: (subs?.n ?? 0) > 0, thankYou: !!settings.thankYou, review: !!settings.reviewUrl };
  return c.json(wall);
});

app.get("/sample/t", async (c) => {
  c.header("Cache-Control", "no-store");
  const session = sampleSession(c, () => randomToken(32));
  const settings = await sampleSettings(c.env, session);
  const now = new Date();
  const wall = await sampleWall(c.env, "none", now);
  const { story, tiles } = tapGrid(wall.tiles);
  return c.html(
    renderTapPage({
      mode: "sample",
      shop: { id: SAMPLE_SHOP.id, name: SAMPLE_SHOP.name, handle: SAMPLE_SHOP.handle, avatarUrl: null, timezone: SAMPLE_SHOP.timezone },
      story: story ? toTapTile(story, now, SAMPLE_SHOP.timezone) : null,
      tiles: tiles.map((t) => toTapTile(t, now, SAMPLE_SHOP.timezone)),
      thankYou: settings.thankYou,
      reviewUrl: settings.reviewUrl,
      tapEndpoint: "/api/sample/tap",
      source: "sample",
      deviceKey: "ci_device_sample",
      showHeader: true,
    }),
  );
});

app.post("/api/sample/tap", async (c) => {
  const session = sampleSession(c, () => randomToken(32));
  const b = (await c.req.json().catch(() => ({}))) as { tile?: string | null; answer?: string };
  const answer = b.answer === "walked_past" ? "walked_past" : "post";
  const tile = answer === "post" ? (b.tile ?? null) : null;
  if (answer === "post" && !isSampleTile(tile)) return c.json({ ok: false, error: "no such post" }, 400);
  const now = new Date();
  const r = await recordSampleTap(c.env, session, tile, answer, now, "counter");
  const settings = await sampleSettings(c.env, session);
  if (answer === "post" && r.name) {
    // Sample taps ring only this browser: its room is sample:<session>, and only phones this browser rang up (plan 1.5).
    c.executionCtx.waitUntil(pushSample(c.env, session, ringNote(SAMPLE_SHOP.name, null, bellSentence(r.name), `/sample/post/${tile}`, tile), null));
    c.executionCtx.waitUntil(
      room(c.env, `sample:${session}`).ring({
        type: "ring",
        tileId: tile,
        sentence: bellSentence(r.name),
        where: whereLine("card"),
        count: r.count,
        countToday: r.countToday,
        imageUrl: r.imageUrl,
        at: now.toISOString(),
      }),
    );
  }
  return c.json({ ok: true, counted: true, again: false, name: r.name, ticket: settings.thankYou ? { text: settings.thankYou, at: now.toISOString() } : null, reviewUrl: settings.reviewUrl });
});

app.get("/sample/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.text("expected websocket", 426);
  const session = sampleSession(c, () => randomToken(32));
  return room(c.env, `sample:${session}`).fetch(c.req.raw);
});

// ---------- Phase 2: Setup, the card, the counter, Ring my phone ----------

function ringNote(shopName: string, icon: string | null, sentence: string, url: string, tag: string | null): PushNote {
  return { title: shopName, body: sentence, icon: icon ?? "/icons/icon-192.png", url, tag: tag ?? undefined };
}

app.get("/api/setup", async (c) => {
  noStore(c);
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const subs = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subs WHERE shop_id = ?1 AND failed_at IS NULL`).bind(shop.id).first<{ n: number }>();
  return c.json({
    settings: shopSettings(shop),
    tapUrl: `${publicOrigin(c)}/t/${shop.id}`,
    embed: `<script src="${publicOrigin(c)}/embed.js" data-shop="${shop.id}"></script>`,
    phones: subs?.n ?? 0,
    channels: await channelRows(c.env, shop),
    pushKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC : null,
  });
});

app.post("/api/setup", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const r = parsePatch(await c.req.json().catch(() => ({})));
  if (!r.ok) return c.json({ error: r.error, field: r.field }, 400);
  await saveShopSettings(c.env, shop.id, r.patch);
  return c.json({ ok: true, settings: shopSettings((await getShop(c.env, shop.id))!) });
});

app.get("/api/sample/setup", async (c) => {
  noStore(c);
  const session = sampleSession(c, () => randomToken(32));
  const subs = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sample_push_subs WHERE session_id = ?1 AND failed_at IS NULL`).bind(session).first<{ n: number }>();
  const { counterOpened, ...settings } = await sampleSettings(c.env, session);
  return c.json({
    settings,
    tapUrl: `${publicOrigin(c)}/sample/t`,
    embed: `<script src="${publicOrigin(c)}/embed.js" data-shop="sample"></script>`,
    phones: subs?.n ?? 0,
    channels: [],
    pushKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC : null,
    counterOpened,
  });
});

app.post("/api/sample/setup", async (c) => {
  const session = sampleSession(c, () => randomToken(32));
  const r = parsePatch(await c.req.json().catch(() => ({})));
  if (!r.ok) return c.json({ error: r.error, field: r.field }, 400);
  await saveSampleSettings(c.env, session, r.patch);
  const { counterOpened, ...settings } = await sampleSettings(c.env, session);
  void counterOpened;
  return c.json({ ok: true, settings });
});

// The printed card (plan 3.11).
app.get("/card", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.redirect("/", 302);
  const size = cardSize(c.req.query("size"));
  return c.html(
    renderCard({
      shop: { name: shop.name, handle: shop.handle, avatarUrl: shop.avatar_key ? `/i/${shop.id}/avatar` : null },
      qrSvg: await qrSvg(`${publicOrigin(c)}/t/${shop.id}`),
      size,
      printedEndpoint: "/api/card/printed",
      backUrl: "/setup#card",
      sizeHref: (s: CardSize) => `/card?size=${s}`,
    }),
  );
});

app.get("/sample/card", async (c) => {
  sampleSession(c, () => randomToken(32));
  const size = cardSize(c.req.query("size"));
  return c.html(
    renderCard({
      shop: { name: SAMPLE_SHOP.name, handle: SAMPLE_SHOP.handle, avatarUrl: null },
      qrSvg: await qrSvg(`${publicOrigin(c)}/sample/t`),
      size,
      printedEndpoint: "/api/sample/card/printed",
      backUrl: "/sample/setup#card",
      sizeHref: (s: CardSize) => `/sample/card?size=${s}`,
    }),
  );
});

app.post("/api/card/printed", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  await c.env.DB.prepare(`UPDATE shops SET card_printed_at = ?2 WHERE id = ?1`).bind(shop.id, new Date().toISOString()).run();
  return c.json({ ok: true });
});

app.post("/api/sample/card/printed", async (c) => {
  const session = sampleSession(c, () => randomToken(32));
  await setSample(c.env, session, "card_printed", new Date().toISOString());
  return c.json({ ok: true });
});

// The counter (plan 1.5, 3.6).
app.post("/api/counter/open", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  return c.json({ ok: true, url: `/c/${await openCounter(c.env, shop.id)}` });
});

app.post("/api/counter/close", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const { token } = (await c.req.json().catch(() => ({}))) as { token?: string };
  if (!token || !(await closeCounter(c.env, shop.id, token))) return c.json({ error: "no such counter" }, 404);
  return c.json({ ok: true });
});

app.get("/c/:token", async (c) => {
  c.header("Cache-Control", "no-store");
  const counter = await getCounter(c.env, c.req.param("token"));
  if (!counter) return c.html(renderGonePage(), 404);
  if (counter.closed_at) return c.html(renderCounterClosed(), 410);
  const shop = await liveShop(c.env, counter.shop_id);
  if (!shop) return c.html(renderGonePage(), 404);
  const now = new Date();
  c.executionCtx.waitUntil(wake(c.env, shop.id, now));
  const tiles = (await wallTiles(c.env, shop, now)).slice(0, 12);
  const owner = (await ownerShopId(c)) === shop.id;
  return c.html(
    renderCounterPage({
      shop: { name: shop.name, handle: shop.handle, avatarUrl: shop.avatar_key ? `/i/${shop.id}/avatar` : null },
      tiles: tiles.map((t) => toTapTile(t, now, shop.timezone)),
      token: counter.token,
      endpoint: "/api/counter/tap",
      owner,
      closeEndpoint: owner ? "/api/counter/close" : null,
      wallUrl: "/wall",
      sample: false,
    }),
  );
});

app.post("/api/counter/tap", async (c) => {
  const input = parseCounterTap(await c.req.json().catch(() => null));
  if (!input) return c.json({ ok: false, error: "bad tap" }, 400);
  const out = await recordCounterTap(c.env, input);
  if (out.status === 200 && out.ring) {
    const { message, exceptDevice, shop } = out.ring;
    c.executionCtx.waitUntil(room(c.env, shop.id).ring(message, exceptDevice));
    c.executionCtx.waitUntil(pushShop(c.env, shop.id, ringNote(shop.name, shop.avatar_key ? `/i/${shop.id}/avatar` : null, message.sentence, `/post/${message.tileId}`, message.tileId), exceptDevice));
    if (message.tileId && (await queueWinnerJobs(c.env, shop, message.tileId, message.count))) c.executionCtx.waitUntil(room(c.env, shop.id).kickJobs(shop.id));
  }
  return c.json(out.body, out.status);
});

app.get("/sample/c", async (c) => {
  c.header("Cache-Control", "no-store");
  const session = sampleSession(c, () => randomToken(32));
  await setSample(c.env, session, "counter_opened", "1");
  const now = new Date();
  const wall = await sampleWall(c.env, session, now);
  return c.html(
    renderCounterPage({
      shop: { name: SAMPLE_SHOP.name, handle: SAMPLE_SHOP.handle, avatarUrl: null },
      tiles: wall.tiles.slice(0, 12).map((t) => toTapTile(t, now, SAMPLE_SHOP.timezone)),
      token: "sample",
      endpoint: "/api/sample/counter/tap",
      owner: true,
      closeEndpoint: null,
      wallUrl: "/sample",
      sample: true,
    }),
  );
});

app.post("/api/sample/counter/tap", async (c) => {
  const session = sampleSession(c, () => randomToken(32));
  const b = (await c.req.json().catch(() => ({}))) as { tile?: string | null; answer?: string; device?: string };
  const answer = b.answer === "walked_past" || b.answer === "friend" || b.answer === "google" ? b.answer : "post";
  const tile = answer === "post" ? (b.tile ?? null) : null;
  if (answer === "post" && !isSampleTile(tile)) return c.json({ ok: false, error: "no such post" }, 400);
  const now = new Date();
  const r = await recordSampleTap(c.env, session, tile, answer, now, "counter");
  if (answer === "post" && r.name) {
    const message = { type: "ring" as const, tileId: tile, sentence: bellSentence(r.name), where: whereLine("counter"), count: r.count, countToday: r.countToday, imageUrl: r.imageUrl, at: now.toISOString() };
    c.executionCtx.waitUntil(room(c.env, `sample:${session}`).ring(message));
    c.executionCtx.waitUntil(pushSample(c.env, session, ringNote(SAMPLE_SHOP.name, null, message.sentence, `/sample/post/${tile}`, tile), null));
  }
  return c.json({ ok: true, counted: true, name: r.name });
});

// Ring my phone (plan 3.8; P9).
app.get("/api/push/key", (c) => c.json({ publicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC : null }));

app.post("/api/push/subscribe", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const b = (await c.req.json().catch(() => ({}))) as { device?: string; subscription?: unknown };
  const sub = parseSubscription(b.subscription, c.env.PUSH_TEST_HOSTS);
  const device = typeof b.device === "string" ? b.device.slice(0, 64) : "";
  if (!sub || !device) return c.json({ error: "bad subscription" }, 400);
  await saveShopSub(c.env, shop.id, device, sub, c.req.header("user-agent") ?? null);
  return c.json({ ok: true });
});

app.post("/api/sample/push/subscribe", async (c) => {
  const session = sampleSession(c, () => randomToken(32));
  const b = (await c.req.json().catch(() => ({}))) as { device?: string; subscription?: unknown };
  const sub = parseSubscription(b.subscription, c.env.PUSH_TEST_HOSTS);
  const device = typeof b.device === "string" ? b.device.slice(0, 64) : "";
  if (!sub || !device) return c.json({ error: "bad subscription" }, 400);
  await saveSampleSub(c.env, session, device, sub);
  return c.json({ ok: true });
});

// Disconnect and delete everything (plan 3.8).
app.post("/api/shop/delete", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  await deleteShop(c.env, shop.id);
  clearOwnerCookie(c);
  return c.json({ ok: true, next: "/" });
});

// ---------- Phase 3: This week, a post's page, the write-backs, the share image ----------

app.get("/api/week", async (c) => {
  noStore(c);
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const data = await shopWeek(c.env, shop, parseRange(c.req.query("range")));
  return c.json({ ...data, channels: await targetChannels(c.env, shop.id), drafts: c.env.BUFFER_DRAFTS === "1" });
});

app.get("/api/sample/week", async (c) => {
  noStore(c);
  const session = sampleSession(c, () => randomToken(32));
  const data = await sampleWeek(c.env, session, parseRange(c.req.query("range")));
  return c.json({ ...data, channels: SAMPLE_CHANNELS, drafts: false });
});

async function targetChannels(env: Env, shopId: string): Promise<{ id: string; name: string; service: string }[]> {
  const { results } = await env.DB.prepare(`SELECT id, name, display_name, service FROM channels WHERE shop_id = ?1 AND enabled = 1 ORDER BY rowid`).bind(shopId).all<{ id: string; name: string; display_name: string | null; service: string }>();
  return results.map((r) => ({ id: r.id, name: r.display_name || r.name, service: r.service, needsBoard: r.service === "pinterest" }));
}

async function chosenTargets(env: Env, shopId: string, ids: unknown): Promise<PostTarget[]> {
  const all = await targetChannels(env, shopId);
  const want = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  return all.filter((ch) => want.has(ch.id)).map((ch) => ({ channelId: ch.id, service: ch.service }));
}

/** One answer for the sheet (plan 3.7, 3.9, 1.8). */
function sheetAnswer(results: ChannelResult[], drafts: boolean): { outcome: "queued" | "approval" | "draft" | "failed"; results: ChannelResult[] } {
  const ok = results.filter((r) => r.status === "queued" || r.status === "retrying" || r.status === "approval" || r.status === "draft");
  if (!ok.length) return { outcome: "failed", results };
  if (drafts && ok.some((r) => r.status === "draft")) return { outcome: "draft", results };
  if (ok.some((r) => r.status === "approval")) return { outcome: "approval", results };
  return { outcome: "queued", results };
}

app.get("/api/post/:tile", async (c) => {
  noStore(c);
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const page = await shopPostPage(c.env, shop, c.req.param("tile"));
  if (!page) return c.json({ error: "no such post" }, 404);
  return c.json({ ...page, drafts: c.env.BUFFER_DRAFTS === "1" });
});

function parsePostPatch(b: Record<string, unknown>): { nickname?: string | null; hidden?: boolean } | string {
  const out: { nickname?: string | null; hidden?: boolean } = {};
  if ("nickname" in b) {
    const n = typeof b.nickname === "string" ? b.nickname.replace(/\s+/g, " ").trim() : "";
    if ([...n].length > 24) return "Keep it to 24 characters.";
    out.nickname = n || null;
  }
  if ("hidden" in b) out.hidden = !!b.hidden;
  return out;
}

app.post("/api/post/:tile", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const p = parsePostPatch((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  if (typeof p === "string") return c.json({ error: p, field: "nickname" }, 400);
  const tileId = c.req.param("tile");
  const t = await c.env.DB.prepare(`SELECT id FROM tiles WHERE id = ?1 AND shop_id = ?2`).bind(tileId, shop.id).first();
  if (!t) return c.json({ error: "no such post" }, 404);
  if ("nickname" in p) await c.env.DB.prepare(`UPDATE tiles SET nickname = ?2 WHERE id = ?1`).bind(tileId, p.nickname).run();
  if ("hidden" in p) await c.env.DB.prepare(`UPDATE tiles SET hidden = ?2 WHERE id = ?1`).bind(tileId, p.hidden ? 1 : 0).run();
  return c.json({ ok: true });
});

app.post("/api/post/:tile/again", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const b = (await c.req.json().catch(() => ({}))) as { channels?: unknown; text?: unknown };
  const targets = await chosenTargets(c.env, shop.id, b.channels);
  if (!targets.length) return c.json({ error: "Pick at least one channel." }, 400);
  const text = typeof b.text === "string" && b.text.trim() ? b.text.trim() : null;
  const results = await postAgain(c.env, shop, c.req.param("tile"), targets, text, publicOrigin(c));
  return c.json(sheetAnswer(results, c.env.BUFFER_DRAFTS === "1"));
});

// The sheets ask which channels would refuse, before they open (plan 3.9).
app.get("/api/post/:tile/targets", async (c) => {
  noStore(c);
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const t = await againTargets(c.env, shop.id, c.req.param("tile"), await targetChannels(c.env, shop.id));
  if (!t) return c.json({ error: "no such post" }, 404);
  return c.json({ channels: t });
});

app.get("/api/week/targets", async (c) => {
  noStore(c);
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  // Post this sends the square share image.
  return c.json({ channels: (await targetChannels(c.env, shop.id)).map((ch) => ({ ...ch, refusal: refusalFor(ch.service, "image") })) });
});

app.get("/api/sample/post/:tile/targets", (c) => {
  const p = SAMPLE_POSTS_BY_ID.get(c.req.param("tile"));
  if (!p) return c.json({ error: "no such post" }, 404);
  const media = p.textOnly ? "none" : p.id === "hands" ? "video" : "image";
  return c.json({ channels: SAMPLE_CHANNELS.map((ch) => ({ ...ch, refusal: refusalFor(ch.service, media) })) });
});

app.get("/api/sample/week/targets", (c) => c.json({ channels: SAMPLE_CHANNELS.map((ch) => ({ ...ch, refusal: refusalFor(ch.service, "image") })) }));

app.post("/api/post/:tile/idea", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const page = await shopPostPage(c.env, shop, c.req.param("tile"));
  if (!page) return c.json({ error: "no such post" }, 404);
  const outcome = await moreLikeThis(c.env, shop, page.tile.id, page.tile.services, publicOrigin(c), `More like ${page.tile.name}`);
  return c.json({ outcome: outcome === "failed" ? "failed" : "saved" });
});

// The share image: drawn in the owner's browser, uploaded here, served for Buffer to fetch (plan 3.7, P14).
const SHARE_MAX = 5 * 1024 * 1024;
const SHARE_KEEP = 10; // per shop and kind; older ones are deleted

async function storeShare(c: C, owner: string, kind: string, range: string, tz: string): Promise<Response> {
  if (kind !== "story" && kind !== "square") return c.json({ error: "bad kind" }, 400);
  if (c.req.header("content-type") !== "image/png") return c.json({ error: "PNG only" }, 415);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > SHARE_MAX || buf.byteLength < 8) return c.json({ error: "too big" }, 413);
  const sig = new Uint8Array(buf.slice(0, 8));
  if (![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => sig[i] === b)) return c.json({ error: "not a PNG" }, 415);
  const name = `${shopWeekKey(new Date(), tz)}-${parseRange(range)}-${kind}-${randomToken(8)}.png`;
  await c.env.MEDIA.put(`share/${owner}/${name}`, buf, { httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" } });
  // Keep the newest few of each kind; a queued post's image is among them.
  const list = await c.env.MEDIA.list({ prefix: `share/${owner}/` });
  const mine = list.objects.filter((o) => o.key.includes(`-${kind}-`)).sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());
  if (mine.length > SHARE_KEEP) await c.env.MEDIA.delete(mine.slice(SHARE_KEEP).map((o) => o.key));
  return c.json({ ok: true, url: `${publicOrigin(c)}/s/${owner}/${name}` });
}

app.post("/api/share/:kind", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  return storeShare(c, shop.id, c.req.param("kind"), c.req.query("range") ?? "this", shop.timezone);
});

app.get("/s/:owner/:file", async (c) => {
  const owner = c.req.param("owner");
  const file = c.req.param("file");
  if (!/^[a-z]{10}$/.test(owner) || !/^[A-Za-z0-9-]+\.png$/.test(file)) return c.notFound();
  return serveR2(c, `share/${owner}/${file}`, "public, max-age=31536000, immutable");
});

app.post("/api/week/post", async (c) => {
  const shop = await ownerShop(c);
  if (!shop) return c.json({ error: "signed out" }, 401);
  const b = (await c.req.json().catch(() => ({}))) as { channels?: unknown; text?: unknown; image?: unknown };
  const targets = await chosenTargets(c.env, shop.id, b.channels);
  if (!targets.length) return c.json({ error: "Pick at least one channel." }, 400);
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 2000) : "";
  const image = typeof b.image === "string" ? b.image : "";
  if (!image.startsWith(`${publicOrigin(c)}/s/${shop.id}/`)) return c.json({ error: "share image first" }, 400);
  const results = await postShare(c.env, shop, targets, text, image);
  return c.json(sheetAnswer(results, c.env.BUFFER_DRAFTS === "1"));
});

// The sample: write-backs show as done without calling Buffer (plan 3.10).
app.get("/api/sample/post/:tile", async (c) => {
  noStore(c);
  const session = sampleSession(c, () => randomToken(32));
  const page = await samplePostPage(c.env, session, c.req.param("tile"));
  if (!page) return c.json({ error: "no such post" }, 404);
  return c.json({ ...page, drafts: false });
});

app.post("/api/sample/post/:tile", async (c) => {
  const session = sampleSession(c, () => randomToken(32));
  const tile = c.req.param("tile");
  if (!isSampleTile(tile)) return c.json({ error: "no such post" }, 404);
  const p = parsePostPatch((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  if (typeof p === "string") return c.json({ error: p, field: "nickname" }, 400);
  if ("nickname" in p) await setSample(c.env, session, `nick:${tile}`, p.nickname ?? null);
  if ("hidden" in p) await setSample(c.env, session, `hide:${tile}`, p.hidden ? "1" : null);
  return c.json({ ok: true });
});

app.post("/api/sample/post/:tile/again", async (c) => {
  sampleSession(c, () => randomToken(32));
  const b = (await c.req.json().catch(() => ({}))) as { channels?: string[] };
  const ids = (b.channels ?? []).filter((id) => SAMPLE_CHANNELS.some((s) => s.id === id));
  if (!ids.length) return c.json({ error: "Pick at least one channel." }, 400);
  return c.json({ outcome: "queued", results: ids.map((id) => ({ channelId: id, status: "queued" })) });
});

app.post("/api/sample/post/:tile/idea", (c) => c.json({ outcome: "saved" }));

app.post("/api/sample/week/post", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { channels?: string[] };
  const ids = (b.channels ?? []).filter((id) => SAMPLE_CHANNELS.some((s) => s.id === id));
  if (!ids.length) return c.json({ error: "Pick at least one channel." }, 400);
  return c.json({ outcome: "queued", results: ids.map((id) => ({ channelId: id, status: "queued" })) });
});

// ---------- The owner app (Vite + Preact, static assets) ----------

const APP_ROUTES = ["/wall", "/week", "/setup", "/setup/org", "/setup/channels", "/setup/reading", "/sample", "/sample/week", "/sample/setup"];

async function serveApp(c: C) {
  const url = new URL(c.req.url);
  // The sample's page, its socket and its phone frame must share one session,
  // so the session cookie is set here, before any of them start (plan 1.5).
  if (url.pathname === "/sample" || url.pathname.startsWith("/sample/")) sampleSession(c, () => randomToken(32));
  url.pathname = "/index.html";
  const res = await c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers }));
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "no-cache");
  for (const v of c.res.headers.getSetCookie()) out.headers.append("Set-Cookie", v);
  return out;
}

for (const r of APP_ROUTES) app.get(r, serveApp);
app.get("/post/:tile", serveApp);
app.get("/sample/post/:tile", serveApp);

// Everything else is a static asset (fonts, the app's bundles, the sample photos).
app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status === 404) return c.text("Not found", 404);
  return res;
});

// ---------- Crons (plan 1.6) ----------

/** Monday at 08:00 shop time: "Your week: …", opening last week (plan 3.7; P11). Once a week per shop. */
export async function mondayPushes(env: Env, now = new Date()): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.* FROM shops s WHERE s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM push_subs p WHERE p.shop_id = s.id AND p.failed_at IS NULL)`,
  ).all<ShopRow>();
  const sent: string[] = [];
  for (const shop of results) {
    const p = zonedParts(now, shop.timezone);
    if (p.weekday !== 1 || p.hour !== 8 || p.minute >= 15) continue;
    const week = shopWeekKey(now, shop.timezone);
    if (shop.monday_push_week === week) continue;
    await env.DB.prepare(`UPDATE shops SET monday_push_week = ?2 WHERE id = ?1`).bind(shop.id, week).run();
    const last = await shopWeek(env, shop, "last", now);
    const body = mondayBody(last.summary);
    if (!body) continue;
    await pushShop(env, shop.id, { title: "Came In", body, icon: "/icons/icon-192.png", url: "/week?range=last", tag: `week-${week}` }, null);
    sent.push(shop.id);
  }
  return sent;
}
void summarize;

/** The 04:00 cron (plan 1.6): channel names and avatars, missing images, old sample rows. */
export async function daily(env: Env, token: (shopId: string) => Promise<string | null>, now = new Date()): Promise<void> {
  await deleteOldSampleTaps(env, now);
  await pruneSample(env, now);
  await retryMissingImages(env, token);
  const { results } = await env.DB.prepare(`SELECT s.* FROM shops s JOIN buffer_tokens b ON b.shop_id = s.id WHERE s.deleted_at IS NULL AND s.revoked_at IS NULL`).all<ShopRow>();
  for (const shop of results) {
    try {
      const t = await token(shop.id);
      if (t) await syncChannels(env, shop, t);
    } catch (e) {
      console.error("daily channel refresh failed", shop.id, (e as Error)?.message);
      if (e instanceof BufferError && (e.kind === "rate_limited" || e.kind === "blocked")) break;
    }
  }
}

async function pruneSample(env: Env, now: Date): Promise<void> {
  const old = new Date(now.getTime() - 7 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sample_settings WHERE updated_at < ?1`).bind(old),
    env.DB.prepare(`DELETE FROM sample_push_subs WHERE created_at < ?1`).bind(old),
  ]);
}

async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const deps = {
    token: (id: string) => room(env, id).getToken(id),
    notify: async (id: string, n: number) => {
      if (n > 0) await room(env, id).broadcast({ type: "posts", reason: "poll", count: n });
    },
    syncRunning: async (id: string) => (await room(env, id).syncStatus()).running,
  };
  const now = new Date(controller.scheduledTime || Date.now());
  if (controller.cron === "0 4 * * *") {
    await daily(env, deps.token, now);
    await runJobs(env, null, now);
    return;
  }
  await pollDue(env, deps, now);
  await runJobs(env, null, now);
  await mondayPushes(env, now);
}

export default {
  fetch: app.fetch,
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;

export { app };
