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
import { SAMPLE_SHOP } from "../shared/sample";
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
    if (shop) c.executionCtx.waitUntil(pushShop(c.env, shop.id, ringNote(shop.name, shop.avatar_key ? `/i/${shop.id}/avatar` : null, out.ring.message.sentence, "/wall", out.ring.message.tileId), out.ring.exceptDevice));
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
  const r = await recordSampleTap(c.env, session, tile, answer, now);
  const settings = await sampleSettings(c.env, session);
  if (answer === "post" && r.name) {
    // Sample taps ring only this browser: its room is sample:<session>, and only phones this browser rang up (plan 1.5).
    c.executionCtx.waitUntil(pushSample(c.env, session, ringNote(SAMPLE_SHOP.name, null, bellSentence(r.name), "/sample", tile), null));
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
    c.executionCtx.waitUntil(pushShop(c.env, shop.id, ringNote(shop.name, shop.avatar_key ? `/i/${shop.id}/avatar` : null, message.sentence, "/wall", message.tileId), exceptDevice));
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
  const r = await recordSampleTap(c.env, session, tile, answer, now);
  if (answer === "post" && r.name) {
    const message = { type: "ring" as const, tileId: tile, sentence: bellSentence(r.name), where: whereLine("counter"), count: r.count, countToday: r.countToday, imageUrl: r.imageUrl, at: now.toISOString() };
    c.executionCtx.waitUntil(room(c.env, `sample:${session}`).ring(message));
    c.executionCtx.waitUntil(pushSample(c.env, session, ringNote(SAMPLE_SHOP.name, null, message.sentence, "/sample", tile), null));
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

// Everything else is a static asset (fonts, the app's bundles, the sample photos).
app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status === 404) return c.text("Not found", 404);
  return res;
});

// ---------- Crons (plan 1.6) ----------

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
    return;
  }
  await pollDue(env, deps, now);
}

export default {
  fetch: app.fetch,
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;

export { app };
