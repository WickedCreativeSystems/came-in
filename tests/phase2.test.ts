// Phase 2: P7 counter, P8 card, P9 Ring my phone, P10 Setup, P19 rate-limit discipline.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { makeShop, addChannel, addTile, call, ownerCookie, fakeBuffer, cookiesFrom } from "./helpers";
import { pollDue } from "../src/worker/poll";
import worker from "../src/worker/index";
import { createScheduledController, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

async function runCron(cron: string, at: Date) {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron, scheduledTime: at }), env, ctx);
  await waitOnExecutionContext(ctx);
}
import { getShop } from "../src/worker/db";
import type { RoomMessage } from "../src/shared/types";

afterEach(() => vi.restoreAllMocks());

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const settle = () => new Promise((r) => setTimeout(r, 50));

async function shopWithPosts(opts: { thankYou?: string } = {}) {
  const id = await makeShop({ thankYou: opts.thankYou ?? null });
  await addChannel(id, `ig-${id}`, "instagram");
  await addTile(id, { id: `sour-${id}`, text: "Sourdough is out of the oven.", sentAt: ago(30), channelId: `ig-${id}`, image: true });
  await addTile(id, { id: `hours-${id}`, text: "Winter hours start Monday.", sentAt: ago(50), channelId: `ig-${id}` });
  return id;
}

async function openSocket(roomName: string, device: string) {
  const stub = env.SHOP_ROOM.get(env.SHOP_ROOM.idFromName(roomName));
  const res = await stub.fetch(`https://room/?device=${device}`, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket!;
  const got: RoomMessage[] = [];
  ws.accept();
  ws.addEventListener("message", (e) => {
    got.push(JSON.parse(e.data as string));
  });
  return { ws, got };
}

async function openCounterFor(id: string): Promise<string> {
  const r = await call("/api/counter/open", { method: "POST", cookie: await ownerCookie(id) });
  const { url } = (await r.json()) as { url: string };
  expect(url).toMatch(/^\/c\/[A-Za-z0-9]{32}$/);
  return url.slice(3);
}

describe("the counter (P7, plan 3.6)", () => {
  it("opens from Setup, shows the words, and the three answers insert rows with tile_id NULL", async () => {
    const id = await shopWithPosts({ thankYou: "Free cookie today" });
    const token = await openCounterFor(id);
    const html = await (await call(`/c/${token}`)).text();
    for (const w of ["What brought them in?", "Walked past", "A friend told them", "Found us on Google", "Counter", "Owner"]) expect(html).toContain(w);
    expect(html).not.toContain("prefers-color-scheme:dark"); // always Day
    let t = Date.now();
    for (const answer of ["walked_past", "friend", "google"]) {
      vi.setSystemTime(t);
      const r = await call("/api/counter/tap", json({ token, tile: null, answer, device: "tablet" }));
      expect(await r.json()).toMatchObject({ ok: true, counted: true });
      t += 4000;
    }
    vi.useRealTimers();
    const { results } = await env.DB.prepare(`SELECT answer, source, tile_id, rewarded FROM taps WHERE shop_id = ?1 ORDER BY created_at`).bind(id).all();
    expect(results).toEqual([
      { answer: "walked_past", source: "counter", tile_id: null, rewarded: 0 },
      { answer: "friend", source: "counter", tile_id: null, rewarded: 0 },
      { answer: "google", source: "counter", tile_id: null, rewarded: 0 },
    ]);
  });

  it("has no per-device limit, only one tap per 3 seconds; a post tap rings 'At the counter', not on the counter", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const wall = await openSocket(id, "laptop");
    const counterScreen = await openSocket(id, "tablet");
    const start = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: start });
    const a = await call("/api/counter/tap", json({ token, tile: `sour-${id}`, answer: "post", device: "tablet" }));
    expect(await a.json()).toMatchObject({ counted: true });
    const b = await call("/api/counter/tap", json({ token, tile: `hours-${id}`, answer: "post", device: "tablet" }));
    expect(await b.json()).toMatchObject({ counted: false });
    vi.setSystemTime(start + 3500);
    const c = await call("/api/counter/tap", json({ token, tile: `sour-${id}`, answer: "post", device: "tablet" }));
    expect(await c.json()).toMatchObject({ counted: true });
    vi.useRealTimers();
    await settle();
    const ring = wall.got.find((m) => m.type === "ring");
    expect(ring).toMatchObject({ where: "At the counter · just now", tileId: `sour-${id}` });
    expect(counterScreen.got.some((m) => m.type === "ring")).toBe(false);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM taps WHERE shop_id = ?1 AND tile_id = ?2`).bind(id, `sour-${id}`).first<{ n: number }>();
    expect(n!.n).toBe(2);
    wall.ws.close();
    counterScreen.ws.close();
  });

  it("a closed counter says so, and only its shop's owner can close it", async () => {
    const id = await shopWithPosts();
    const other = await shopWithPosts();
    const token = await openCounterFor(id);
    expect((await call("/api/counter/close", { ...json({ token }), cookie: await ownerCookie(other) })).status).toBe(404);
    expect((await call("/api/counter/close", { ...json({ token }), cookie: await ownerCookie(id) })).status).toBe(200);
    const page = await call(`/c/${token}`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain("This counter was closed. Open it again from Setup.");
    expect((await call("/api/counter/tap", json({ token, tile: null, answer: "walked_past", device: "x" }))).status).toBe(409);
  });

  it("shows the owner corner's two buttons only with the owner cookie", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    expect(await (await call(`/c/${token}`)).text()).not.toContain("Close the counter on this device");
    const mine = await (await call(`/c/${token}`, { cookie: await ownerCookie(id) })).text();
    expect(mine).toContain("Close the counter on this device");
    expect(mine).toContain("Back to the wall");
  });

  it("the sample counter works with no account", async () => {
    const first = await call("/sample/c");
    const html = await first.text();
    expect(html).toContain("What brought them in?");
    const cookie = cookiesFrom(first);
    const r = await call("/api/sample/counter/tap", { ...json({ tile: null, answer: "friend" }), cookie });
    expect(await r.json()).toMatchObject({ ok: true });
  });
});

describe("the printed card (P8, plan 3.11)", () => {
  it("renders at A6 by default, and at A5 and 4×6 in, with the words and an inline QR for the tap page", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const a6 = await (await call("/card", { cookie })).text();
    expect(a6).toContain("@page{size:105mm 148mm;margin:0}");
    expect(a6).toContain(".card{width:105mm;height:148mm");
    for (const w of ["Saw us online?", "Tap the post that brought you in.<br>Three seconds, no app.", "Came In", "Print", "Save as PDF", "@testbakery"]) expect(a6).toContain(w);
    expect(a6).toMatch(/<div class="qr"[^>]*><svg[^>]*viewBox="0 0 \d+ \d+"/);
    expect(a6).not.toContain("prefers-color-scheme:dark");
    const a5 = await (await call("/card?size=a5", { cookie })).text();
    expect(a5).toContain("@page{size:148mm 210mm;margin:0}");
    expect(a5).toContain(".card{width:148mm;height:210mm");
    const four = await (await call("/card?size=4x6", { cookie })).text();
    expect(four).toContain("@page{size:4in 6in;margin:0}");
  });

  it("the QR has a quiet zone of at least 4 modules", async () => {
    const id = await shopWithPosts();
    const html = await (await call("/card", { cookie: await ownerCookie(id) })).text();
    const svg = html.match(/<div class="qr"[^>]*>(<svg[\s\S]*?<\/svg>)/)![1];
    const size = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)![1]);
    // qrcode draws the dark modules as one path; its first move is the top-left module after the margin.
    const firstMove = svg.match(/<path[^>]*stroke="#231F1B"[^>]*d="M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/) ?? svg.match(/d="M(\d+) (\d+(?:\.5)?)/);
    expect(firstMove).not.toBeNull();
    expect(Math.floor(Number(firstMove![1]))).toBeGreaterThanOrEqual(4);
    expect(size).toBeGreaterThan(21 + 8);
  });

  it("Print marks the checklist's card chip done; the sample has its own card", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const before = (await (await call("/api/wall", { cookie })).json()) as { checklist: { card: boolean } };
    expect(before.checklist.card).toBe(false);
    await call("/api/card/printed", { method: "POST", cookie });
    const after = (await (await call("/api/wall", { cookie })).json()) as { checklist: { card: boolean } };
    expect(after.checklist.card).toBe(true);
    const sample = await (await call("/sample/card")).text();
    expect(sample).toContain("Rye &amp; Lantern");
  });

  it("without the owner cookie /card goes to the landing", async () => {
    expect((await call("/card")).status).toBe(302);
  });
});

async function testSubscription(endpoint: string) {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const auth = new Uint8Array(16);
  crypto.getRandomValues(auth);
  return { endpoint, keys: { p256dh: b64(raw), auth: b64(auth) } };
}

describe("Ring my phone (P9)", () => {
  it("a tap pushes the sentence to every phone except the tapping device; a 410 endpoint is never used again", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    for (const [device, endpoint] of [["owners-phone", "https://push.test/a"], ["second-phone", "https://push.test/b"], ["gone-phone", "https://push.test/gone"]]) {
      const r = await call("/api/push/subscribe", { ...json({ device, subscription: await testSubscription(endpoint) }), cookie });
      expect(r.status).toBe(200);
    }
    const sent: { url: string; auth: string | null; encoding: string | null; ttl: string | null; bytes: number }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(req.url).host === "push.test") {
        sent.push({ url: req.url, auth: req.headers.get("authorization"), encoding: req.headers.get("content-encoding"), ttl: req.headers.get("ttl"), bytes: (await req.arrayBuffer()).byteLength });
        return new Response(null, { status: req.url.endsWith("/gone") ? 410 : 201 });
      }
      return new Response("no", { status: 404 });
    });
    const t0 = Date.now();
    await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "owners-phone" }));
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(sent.map((s) => s.url).sort()).toEqual(["https://push.test/b", "https://push.test/gone"]);
    for (const s of sent) {
      expect(s.auth).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
      expect(s.encoding).toBe("aes128gcm");
      expect(s.bytes).toBeGreaterThan(100);
    }
    const gone = await env.DB.prepare(`SELECT failed_at FROM push_subs WHERE endpoint = 'https://push.test/gone'`).first<{ failed_at: string | null }>();
    expect(gone!.failed_at).not.toBeNull();
    sent.length = 0;
    await call("/api/tap", json({ shop: id, tile: `hours-${id}`, answer: "post", source: "card", device: "someone-else" }));
    expect(sent.map((s) => s.url).sort()).toEqual(["https://push.test/a", "https://push.test/b"]);
  });

  it("'I didn't see a post' pushes nothing", async () => {
    const id = await shopWithPosts();
    await call("/api/push/subscribe", { ...json({ device: "p", subscription: await testSubscription("https://push.test/c") }), cookie: await ownerCookie(id) });
    const spy = vi.spyOn(globalThis, "fetch");
    await call("/api/tap", json({ shop: id, tile: null, answer: "walked_past", source: "card", device: "customer" }));
    expect(spy.mock.calls.filter((c) => String(c[0] instanceof Request ? c[0].url : c[0]).includes("push.test"))).toHaveLength(0);
  });

  it("refuses a subscription that isn't https or has no keys; serves the public key", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    expect((await call("/api/push/subscribe", { ...json({ device: "p", subscription: { endpoint: "http://x.test/a", keys: { p256dh: "a", auth: "b" } } }), cookie })).status).toBe(400);
    expect((await call("/api/push/subscribe", { ...json({ device: "p", subscription: { endpoint: "https://x.test/a" } }), cookie })).status).toBe(400);
    const k = (await (await call("/api/push/key")).json()) as { publicKey: string };
    expect(k.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
  });
});

describe("Setup (P10, plan 3.8)", () => {
  it("every section saves and reloads", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const save = (patch: unknown) => call("/api/setup", { ...json(patch), cookie });
    expect((await save({ thankYou: "Free cookie today. Show this at the till." })).status).toBe(200);
    expect((await save({ reviewUrl: "https://g.page/r/abc/review" })).status).toBe(200);
    expect((await save({ markWinners: false })).status).toBe(200);
    expect((await save({ theme: "night" })).status).toBe(200);
    const d = (await (await call("/api/setup", { cookie })).json()) as { settings: Record<string, unknown>; tapUrl: string; embed: string };
    expect(d.settings).toMatchObject({ thankYou: "Free cookie today. Show this at the till.", reviewUrl: "https://g.page/r/abc/review", markWinners: false, theme: "night" });
    expect(d.tapUrl).toBe(`https://came-in.test/t/${id}`);
    expect(d.embed).toBe(`<script src="https://came-in.test/embed.js" data-shop="${id}"></script>`);
    const wall = (await (await call("/api/wall", { cookie })).json()) as { shop: { theme: string }; checklist: { thankYou: boolean; review: boolean } };
    expect(wall.shop.theme).toBe("night");
    expect(wall.checklist).toMatchObject({ thankYou: true, review: true });
    // The tap page uses them.
    const tap = await (await call(`/t/${id}`)).text();
    expect(tap).toContain('"ty":"Free cookie today. Show this at the till."');
    expect(tap).toContain('"rv":"https://g.page/r/abc/review"');
  });

  it("refuses a thank-you over 60 characters and a link that isn't a Google review link", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const long = await call("/api/setup", { ...json({ thankYou: "x".repeat(61) }), cookie });
    expect(long.status).toBe(400);
    const bad = await call("/api/setup", { ...json({ reviewUrl: "https://example.com/review" }), cookie });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "That link doesn't look like a Google review link.", field: "reviewUrl" });
    for (const ok of ["https://g.page/r/x/review", "https://maps.app.goo.gl/abc", "https://www.google.com/maps/place/x", "https://search.google.com/local/writereview?placeid=1"])
      expect((await call("/api/setup", { ...json({ reviewUrl: ok }), cookie })).status).toBe(200);
    for (const bad of ["https://google.ru.com/x", "https://google.click/x", "https://google.com.evil.com/x", "https://evil.com/?google.com"])
      expect((await call("/api/setup", { ...json({ reviewUrl: bad }), cookie })).status, bad).toBe(400);
    expect((await call("/api/setup", { ...json({ reviewUrl: "http://g.page/r/x" }), cookie })).status).toBe(400);
  });

  it("the checklist's counter and phone chips go done when there is a counter and a phone", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    await openCounterFor(id);
    await call("/api/push/subscribe", { ...json({ device: "p", subscription: await testSubscription("https://push.test/z") }), cookie });
    const wall = (await (await call("/api/wall", { cookie })).json()) as { checklist: Record<string, boolean> };
    expect(wall.checklist).toMatchObject({ connected: true, counter: true, phone: true });
  });

  it("the sample's Setup saves per browser and its tap page follows", async () => {
    const first = await call("/api/sample/setup");
    const cookie = cookiesFrom(first);
    expect((await call("/api/sample/setup", { ...json({ thankYou: "Free coffee today" }), cookie })).status).toBe(200);
    const tap = await (await call("/sample/t", { cookie })).text();
    expect(tap).toContain('"ty":"Free coffee today"');
    const fresh = await (await call("/sample/t")).text();
    expect(fresh).toContain('"ty":"Free cookie today"');
  });

  it("a channel switched off drops its marks; a tile whose only channel is off leaves the wall, the tap page and the counter", async () => {
    const id = await makeShop();
    await addChannel(id, `ig-${id}`, "instagram");
    await addChannel(id, `fb-${id}`, "facebook");
    await addTile(id, { id: `both-${id}`, text: "On both", sentAt: ago(5), channelId: `ig-${id}` });
    await env.DB.prepare(`INSERT INTO posts (id, shop_id, tile_id, channel_id, text, sent_at, kind, thumb_status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'On both', ?5, 'text', 'missing', ?5, ?5)`)
      .bind(`fbp-${id}`, id, `both-${id}`, `fb-${id}`, ago(5))
      .run();
    await addTile(id, { id: `fbonly-${id}`, text: "Only on Facebook", sentAt: ago(6), channelId: `fb-${id}` });
    const cookie = await ownerCookie(id);
    await env.DB.prepare(`UPDATE channels SET enabled = 0 WHERE id = ?1`).bind(`fb-${id}`).run();
    const wall = (await (await call("/api/wall", { cookie })).json()) as { tiles: { id: string; services: string[] }[] };
    expect(wall.tiles.map((t) => t.id)).toEqual([`both-${id}`]);
    expect(wall.tiles[0].services).toEqual(["instagram"]);
    expect(await (await call(`/t/${id}`)).text()).not.toContain(`fbonly-${id}`);
    const token = await openCounterFor(id);
    expect(await (await call(`/c/${token}`)).text()).not.toContain(`fbonly-${id}`);
  });

  it("Disconnect and delete everything removes the shop's rows and images; its tap page says it's gone", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    await env.MEDIA.put(`thumbs/${id}/p1`, "x");
    await env.MEDIA.put(`avatars/${id}`, "x");
    await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "d" }));
    const r = await call("/api/shop/delete", { method: "POST", cookie });
    expect(await r.json()).toMatchObject({ ok: true, next: "/" });
    for (const t of ["taps", "posts", "tiles", "channels", "buffer_tokens"]) {
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE shop_id = ?1`).bind(id).first<{ n: number }>();
      expect(n!.n, t).toBe(0);
    }
    expect(await env.MEDIA.get(`thumbs/${id}/p1`)).toBeNull();
    expect(await env.MEDIA.get(`avatars/${id}`)).toBeNull();
    expect((await getShop(env, id))!.deleted_at).not.toBeNull();
    expect(await (await call(`/t/${id}`)).text()).toContain("This shop isn't using Came In any more.");
    expect((await call("/api/wall", { cookie })).status).toBe(401);
  });
});

describe("rate-limit discipline (P19, plan 1.2)", () => {
  it("buffer_calls_daily stays under 160 with 4 shops awake for a day, the quiet rule active and no new posts", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await makeShop({ tz: "America/Chicago" });
      await addChannel(id, `p19-${id}`, "instagram");
      ids.push(id);
    }
    // Only these four shops take part.
    await env.DB.prepare(`UPDATE shops SET revoked_at = '2026-01-01T00:00:00Z' WHERE id NOT IN (${ids.map(() => "?").join(",")})`).bind(...ids).run();
    const dayStart = new Date("2026-11-05T06:00:00Z"); // midnight in Chicago
    await env.DB.prepare(`UPDATE shops SET awake_until = ?1, last_polled_at = ?2, polls_quiet = 0 WHERE id IN (${ids.map((_, i) => `?${i + 3}`).join(",")})`)
      .bind(new Date(dayStart.getTime() + 2 * 86400000).toISOString(), new Date(dayStart.getTime() - 3600000).toISOString(), ...ids)
      .run();
    const fb = fakeBuffer();
    const counted = async () => ((await env.DB.prepare(`SELECT SUM(count) AS n FROM buffer_calls_daily`).first<{ n: number | null }>())?.n ?? 0);
    const before = await counted();
    // The real crons, through the Worker's scheduled handler, every 15 minutes for a day and the 04:00 run.
    for (let t = 0; t < 24 * 60; t += 15) {
      const at = new Date(dayStart.getTime() + t * 60000);
      if (at.getUTCHours() === 4 && at.getUTCMinutes() === 0) await runCron("0 4 * * *", at);
      await runCron("*/15 * * * *", at);
    }
    const calls = (await counted()) - before;
    // Per shop: 32 polls in the 06:00-22:00 window at the quiet rule's 30 minutes, 8 hourly polls
    // outside it, and the daily channel refresh: 41, so 164 for four shops (P19: "at most 164").
    expect(fb.calls.filter((c) => c.query.includes("CameInChannels")).length).toBe(4);
    expect(calls).toBeGreaterThanOrEqual(160);
    expect(calls).toBeLessThanOrEqual(164);
    // Every call updated buffer_rate from the ratelimit header.
    const r = await env.DB.prepare(`SELECT remaining, quota FROM buffer_rate WHERE window = '24h'`).first<{ remaining: number; quota: number }>();
    expect(r).toEqual({ remaining: 437, quota: 600 });
  });

  it("polling skips every shop when a window is under 10% of its quota", async () => {
    const id = await makeShop();
    await addChannel(id, `nl-${id}`, "instagram");
    await env.DB.prepare(`INSERT INTO buffer_rate (window, remaining, quota) VALUES ('15m', 9, 110) ON CONFLICT(window) DO UPDATE SET remaining = 9, quota = 110`).run();
    const fb = fakeBuffer();
    const r = await pollDue(env, { token: async () => "tok", notify: async () => {}, syncRunning: async () => false });
    expect(r.skipped).toBe("near-limit");
    expect(fb.calls).toHaveLength(0);
    await env.DB.prepare(`DELETE FROM buffer_rate WHERE window = '15m'`).run();
  });
});

describe("look check on 34fc040 (LookieBot)", () => {
  it("the card's unit is its width / 298 at every size", async () => {
    const id = await makeShop();
    const cookie = await ownerCookie(id);
    expect(await (await call("/card", { cookie })).text()).toContain(":root{--u:calc(105mm / 298)}");
    expect(await (await call("/card?size=a5", { cookie })).text()).toContain(":root{--u:calc(148mm / 298)}");
    expect(await (await call("/card?size=4x6", { cookie })).text()).toContain(":root{--u:calc(101.6mm / 298)}");
  });
});


describe("check fixes on ad8bbf5 (NerdCider)", () => {
  it("a subscription is only accepted for a browser push service, and a sample browser keeps at most five phones", async () => {
    const first = await call("/api/sample/setup");
    const cookie = cookiesFrom(first);
    for (const host of ["evil.example.com", "came-in-staging.walkertbrown.workers.dev", "fcm.googleapis.com.evil.com"]) {
      const r = await call("/api/sample/push/subscribe", { ...json({ device: "d", subscription: await testSubscription(`https://${host}/x`) }), cookie });
      expect(r.status, host).toBe(400);
    }
    for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) {
      const r = await call("/api/sample/push/subscribe", { ...json({ device: "d", subscription: await testSubscription(`https://${host}/x`) }), cookie });
      expect(r.status, host).toBe(200);
    }
    for (let i = 0; i < 4; i++) await call("/api/sample/push/subscribe", { ...json({ device: `d${i}`, subscription: await testSubscription(`https://fcm.googleapis.com/fcm/send/${i}`) }), cookie });
    const session = cookie.match(/ci_sample=([^;]+)/)![1];
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sample_push_subs WHERE session_id = ?1`).bind(session).first<{ n: number }>();
    expect(n!.n).toBe(5);
    const shop = await shopWithPosts();
    expect((await call("/api/push/subscribe", { ...json({ device: "p", subscription: await testSubscription("https://evil.example.com/x") }), cookie: await ownerCookie(shop) })).status).toBe(400);
  });

  it("the counter's 3-second rule holds for two taps at the same instant, and counts only tiles on its grid", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const both = await Promise.all([
      call("/api/counter/tap", json({ token, tile: null, answer: "walked_past", device: "t" })),
      call("/api/counter/tap", json({ token, tile: null, answer: "friend", device: "t" })),
    ]);
    const bodies = (await Promise.all(both.map((r) => r.json()))) as { counted: boolean }[];
    expect(bodies.filter((b) => b.counted)).toHaveLength(1);
    await env.DB.prepare(`UPDATE tiles SET hidden = 1 WHERE id = ?1`).bind(`hours-${id}`).run();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.now() + 5000 });
    expect((await call("/api/counter/tap", json({ token, tile: `hours-${id}`, answer: "post", device: "t" }))).status).toBe(404);
    vi.useRealTimers();
    expect((await call("/api/tap", json({ shop: id, tile: `hours-${id}`, answer: "post", source: "card", device: "c" }))).status).toBe(404);
  });

  it("the counter waits the full 3 seconds before the next answer, and the owner corner needs the owner", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const html = await (await call(`/c/${token}`)).text();
    expect(html).toContain("Math.max(0,3050-(Date.now()-at))");
    expect(html).toContain('<a href="/">Owner</a>');
    expect(html).not.toContain("Back to the wall");
  });

  it("the card's QR, the tap link and the script use the Worker's public address, whatever host the page was opened on", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const headers = new Headers({ cookie });
    const res = await (await import("../src/worker/index")).default.fetch(new Request("https://other-host.test/api/setup", { headers }), env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
    const d = (await res.json()) as { tapUrl: string; embed: string };
    expect(d.tapUrl).toBe(`https://came-in.test/t/${id}`);
    expect(d.embed).toContain('src="https://came-in.test/embed.js"');
  });
});


describe("token refreshes are counted on their own (plan 1.2)", () => {
  it("a refresh adds to token_refreshes, not to the API count", async () => {
    const { refreshToken } = await import("../src/worker/buffer/client");
    fakeBuffer();
    const read = async () => (await env.DB.prepare(`SELECT SUM(count) AS c, SUM(token_refreshes) AS r FROM buffer_calls_daily`).first<{ c: number | null; r: number | null }>())!;
    const a = await read();
    await refreshToken(env, "rt-old");
    const b = await read();
    expect((b.r ?? 0) - (a.r ?? 0)).toBe(1);
    expect((b.c ?? 0) - (a.c ?? 0)).toBe(0);
  });
});
