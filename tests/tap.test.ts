// P4: the tap page. P5: the bell. P6: the sample bakery. P22: fonts, no outside requests.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { makeShop, addChannel, addTile, call, ownerCookie } from "./helpers";
import type { RoomMessage } from "../src/shared/types";

afterEach(() => vi.restoreAllMocks());

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();

async function shopWithPosts(opts: { thankYou?: string; review?: string } = {}) {
  const id = await makeShop({ thankYou: opts.thankYou ?? null, review: opts.review ?? null });
  await addChannel(id, `ig-${id}`, "instagram");
  await addTile(id, { id: `sour-${id}`, text: "Sourdough is out of the oven.", sentAt: ago(30), channelId: `ig-${id}`, image: true });
  await addTile(id, { id: `hours-${id}`, text: "Winter hours start Monday.", sentAt: ago(50), channelId: `ig-${id}` });
  await addTile(id, { id: `story-${id}`, text: "Fudge today", sentAt: ago(1), channelId: `ig-${id}`, story: true, image: true });
  return id;
}

function tap(body: Record<string, unknown>) {
  return call("/api/tap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function openSocket(roomName: string, device: string): Promise<{ ws: WebSocket; got: RoomMessage[] }> {
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

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("the tap page (P4, plan 3.5)", () => {
  it("renders the words, today's story first, under 30 KB, with no outside requests", async () => {
    const id = await shopWithPosts();
    const res = await call(`/t/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(new TextEncoder().encode(html).byteLength).toBeLessThan(30 * 1024);
    expect(html).toContain("Saw us online?");
    expect(html).toContain("Tap the post that brought you in.");
    expect(html).toContain("I didn't see a post");
    expect(html).toContain("Anonymous. A post, a time, nothing else.");
    expect(html).toContain("CAME IN");
    // Story pinned full width, with TODAY in brass.
    const first = html.indexOf('class="t');
    expect(html.slice(first, first + 40)).toContain('class="t st"');
    expect(html).toMatch(/class="bd lv">TODAY</);
    // P22: fonts self-hosted; nothing on the tap page loads from another origin.
    expect(html).toContain("/fonts/big-shoulders-latin.woff2");
    expect(html.match(/(?:src|href)="https?:\/\//g)).toBeNull();
    expect(html).not.toMatch(/url\(https?:/);
  });

  it("one tap inserts one row; any later tap that day inserts nothing and says Thanks again!", async () => {
    const id = await shopWithPosts({ thankYou: "Free cookie today" });
    const a = await tap({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "dev-1" });
    const ja = (await a.json()) as { counted: boolean; again: boolean; ticket: { text: string } | null; name: string };
    expect(ja).toMatchObject({ counted: true, again: false, ticket: { text: "Free cookie today" } });
    const b = await tap({ shop: id, tile: `hours-${id}`, answer: "post", source: "card", device: "dev-1" });
    expect(await b.json()).toMatchObject({ counted: false, again: true, ticket: null });
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM taps WHERE shop_id = ?1`).bind(id).first<{ n: number }>();
    expect(n!.n).toBe(1);
    // Another phone counts.
    await tap({ shop: id, tile: `hours-${id}`, answer: "post", source: "card", device: "dev-2" });
    const m = await env.DB.prepare(`SELECT COUNT(*) AS n FROM taps WHERE shop_id = ?1`).bind(id).first<{ n: number }>();
    expect(m!.n).toBe(2);
  });

  it("stores a device hash, never the device id", async () => {
    const id = await shopWithPosts();
    await tap({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "plain-device-id" });
    const r = await env.DB.prepare(`SELECT device_hash FROM taps WHERE shop_id = ?1`).bind(id).first<{ device_hash: string }>();
    expect(r!.device_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r!.device_hash).not.toContain("plain-device-id");
  });

  it("I didn't see a post inserts walked_past from the card, earns the ticket, and rings nothing", async () => {
    const id = await shopWithPosts({ thankYou: "Free cookie today" });
    const owner = await openSocket(id, "owner-laptop");
    const res = await tap({ shop: id, tile: null, answer: "walked_past", source: "card", device: "dev-3" });
    expect(await res.json()).toMatchObject({ counted: true, ticket: { text: "Free cookie today" } });
    const r = await env.DB.prepare(`SELECT answer, source, tile_id FROM taps WHERE shop_id = ?1`).bind(id).first();
    expect(r).toEqual({ answer: "walked_past", source: "card", tile_id: null });
    await settle();
    expect(owner.got.filter((m) => m.type === "ring")).toHaveLength(0);
    owner.ws.close();
  });

  it("a tap never calls Buffer", async () => {
    const id = await shopWithPosts();
    const spy = vi.spyOn(globalThis, "fetch");
    await tap({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "dev-9" });
    expect(spy.mock.calls.filter((c) => String(c[0] instanceof Request ? c[0].url : c[0]).includes("buffer"))).toHaveLength(0);
  });

  it("refuses a bad tap and a post from another shop", async () => {
    const id = await shopWithPosts();
    const other = await shopWithPosts();
    expect((await tap({ shop: id, answer: "post", source: "card", device: "d" })).status).toBe(400);
    expect((await tap({ shop: id, tile: `sour-${other}`, answer: "post", source: "card", device: "d" })).status).toBe(404);
  });

  it("a deleted shop: This shop isn't using Came In any more.", async () => {
    const id = await shopWithPosts();
    await env.DB.prepare(`UPDATE shops SET deleted_at = ?2 WHERE id = ?1`).bind(id, new Date().toISOString()).run();
    const page = await call(`/t/${id}`);
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("This shop isn't using Came In any more.");
    expect((await tap({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "d" })).status).toBe(410);
  });

  it("hidden tiles leave the tap page", async () => {
    const id = await shopWithPosts();
    await env.DB.prepare(`UPDATE tiles SET hidden = 1 WHERE id = ?1`).bind(`hours-${id}`).run();
    const html = await (await call(`/t/${id}`)).text();
    expect(html).not.toContain(`data-i="hours-${id}"`);
    expect(html).toContain(`data-i="sour-${id}"`);
  });
});

describe("the bell (P5, plan 1.4)", () => {
  it("rings every open owner screen except the tapping device, with the sentence, the source and the counts", async () => {
    const id = await shopWithPosts();
    const laptop = await openSocket(id, "laptop");
    const tablet = await openSocket(id, "tablet");
    const phone = await openSocket(id, "owners-phone");
    // The owner taps on their own phone: the phone that tapped never rings.
    const t0 = Date.now();
    await tap({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "owners-phone" });
    await settle();
    const ring = laptop.got.find((m) => m.type === "ring");
    expect(ring).toMatchObject({
      type: "ring",
      tileId: `sour-${id}`,
      sentence: expect.stringMatching(/^Someone just came in because of .+'s post, “Sourdough is out of the”\.$/),
      where: "From the card · just now",
      count: 1,
      countToday: 1,
    });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(tablet.got.some((m) => m.type === "ring")).toBe(true);
    expect(phone.got.some((m) => m.type === "ring")).toBe(false);
    for (const s of [laptop, tablet, phone]) s.ws.close();
  });

  it("the wall's counts come from taps", async () => {
    const id = await shopWithPosts();
    await tap({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "a" });
    await tap({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "b" });
    await tap({ shop: id, tile: null, answer: "walked_past", source: "card", device: "c" });
    const data = (await (await call("/api/wall", { cookie: await ownerCookie(id) })).json()) as { tiles: { id: string; count: number }[]; countToday: number; countThisWeek: number; hasTapped: boolean };
    expect(data.tiles.find((t) => t.id === `sour-${id}`)!.count).toBe(2);
    expect(data.tiles.find((t) => t.id === `hours-${id}`)!.count).toBe(0);
    expect(data.countToday).toBe(2);
    expect(data.countThisWeek).toBe(2);
    expect(data.hasTapped).toBe(true);
  });

  it("the owner API needs the owner cookie", async () => {
    expect((await call("/api/wall")).status).toBe(401);
    expect((await call("/api/wall", { cookie: "ci_owner=forged.123.sig" })).status).toBe(401);
  });
});

describe("the sample bakery (P6, plan 3.10)", () => {
  it("works with no sign-in: twelve posts, baseline counts, the live story first", async () => {
    const res = await call("/api/sample/wall");
    const data = (await res.json()) as { shop: { name: string; isSample: boolean }; tiles: { id: string; count: number; isLive: boolean }[]; countToday: number; countThisWeek: number };
    expect(data.shop).toMatchObject({ name: "Rye & Lantern", isSample: true });
    expect(data.tiles).toHaveLength(12);
    expect(data.tiles[0]).toMatchObject({ id: "story", isLive: true });
    expect(data.tiles.find((t) => t.id === "sour")!.count).toBe(6);
    expect(data.countToday).toBe(3);
    expect(data.countThisWeek).toBe(11);
  });

  it("a tap rings only the same browser's room and adds to this session's counts", async () => {
    const first = await call("/api/sample/wall");
    const cookie = first.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const session = cookie.split("=")[1];
    const mine = await openSocket(`sample:${session}`, "x");
    const someoneElse = await openSocket(`sample:another-session`, "y");
    const r = await call("/api/sample/tap", { method: "POST", cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ tile: "sour", answer: "post" }) });
    expect(r.status).toBe(200);
    await settle();
    expect(mine.got.find((m) => m.type === "ring")).toMatchObject({ sentence: expect.stringMatching(/^Someone just came in because of .+ sourdough post\.$/), count: 7 });
    expect(someoneElse.got.some((m) => m.type === "ring")).toBe(false);
    const after = (await (await call("/api/sample/wall", { cookie })).json()) as { tiles: { id: string; count: number }[]; countToday: number };
    expect(after.tiles.find((t) => t.id === "sour")!.count).toBe(7);
    expect(after.countToday).toBe(4);
    // A fresh browser still sees the baseline.
    const fresh = (await (await call("/api/sample/wall")).json()) as { tiles: { id: string; count: number }[] };
    expect(fresh.tiles.find((t) => t.id === "sour")!.count).toBe(6);
    mine.ws.close();
    someoneElse.ws.close();
  });

  it("the sample tap page is the same tap page, with the bakery's thank-you and review link", async () => {
    const html = await (await call("/sample/t")).text();
    expect(html).toContain("Rye &amp; Lantern");
    expect(html).toContain("@ryeandlantern");
    expect(html).toContain('"ty":"Free cookie today"');
    expect(html).toContain('"ep":"/api/sample/tap"');
  });
});

describe("the public pages", () => {
  it("landing carries the plan's words and the two buttons", async () => {
    const html = await (await call("/")).text();
    for (const w of [
      "Find out which of your posts bring people through the door.",
      "Came In reads the posts you've already sent through Buffer.",
      "Connect Buffer",
      "Try the sample bakery",
      "Free for one shop.",
      "The card on your counter.",
      "A customer taps the post they saw.",
      "Your phone rings.",
      "It counts people at the door, not likes.",
      "Built for Buffer Commit 2026",
    ])
      expect(html).toContain(w);
  });
  it("privacy has the plan's words", async () => {
    const html = await (await call("/privacy")).text();
    expect(html).toContain("No name, no number, no email, no location.");
  });
});

describe("the sample's one session (P6)", () => {
  it("the sample page sets the session cookie before the wall, socket and phone frame ask for it", async () => {
    const res = await call("/sample");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("ci_sample="))).toBe(true);
  });
});

describe("the try strip's QR code (plan 3.4)", () => {
  it("serves an SVG QR for a shop's tap page, and the sample's", async () => {
    const id = await makeShop();
    const res = await call(`/qr/${id}.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toMatch(/^<svg/);
    expect((await call("/qr/sample.svg")).status).toBe(200);
    expect((await call("/qr/nosuchshop.svg")).status).toBe(404);
  });
});

describe("look check on c82e7ef (LookieBot)", () => {
  it("the landing, privacy and credits follow the system into After close; the tap page stays Day", async () => {
    for (const path of ["/", "/privacy", "/credits"]) {
      const html = await (await call(path)).text();
      expect(html).toContain("@media (prefers-color-scheme:dark){:root{--paper:#17140F");
    }
    const id = await makeShop();
    const tapHtml = await (await call(`/t/${id}`)).text();
    expect(tapHtml).not.toContain("prefers-color-scheme:dark");
  });
  it("the tap page hides its scrollbar and gives the thank-you the ticket's width", async () => {
    const id = await makeShop();
    const html = await (await call(`/t/${id}`)).text();
    expect(html).toContain("scrollbar-width:none");
    expect(html).toContain("::-webkit-scrollbar,.th::-webkit-scrollbar{display:none}");
    expect(html).toContain(".tk>div:first-child{min-width:0}");
    expect(html).toContain("weekday:'short',day:'numeric',month:'short'");
  });
});
