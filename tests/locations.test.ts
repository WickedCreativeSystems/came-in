// Locations as stores (plan 1.3, 3.13, P21): each has its own card, tap page, staff screen and counts.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { makeShop, addChannel, addTile, call, fakeBuffer } from "./helpers";
import { sign } from "../src/worker/lib/crypto";
import { listLocations, createLocation, renameLocation, removeLocation, firstLocation } from "../src/worker/locations";
import { recordTap } from "../src/worker/taps";
import { mondayPushes } from "../src/worker/index";

afterEach(() => {
  vi.restoreAllMocks();
});

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const cookieOf = async (shop: string) => `ci_owner=${await sign(`${shop}.${Date.now()}.${shop}`, env.COOKIE_SECRET)}`;

async function shopWithTwo(name = "Downtown Bakery") {
  const id = await makeShop();
  await env.DB.prepare(`UPDATE shops SET name = ?2 WHERE id = ?1`).bind(id, name).run();
  await addChannel(id, `ig-${id}`, "instagram");
  await addTile(id, { id: `a-${id}`, text: "Sourdough is out.", sentAt: ago(5), channelId: `ig-${id}` });
  await addTile(id, { id: `b-${id}`, text: "Cinnamon knots.", sentAt: ago(8), channelId: `ig-${id}` });
  const first = (await firstLocation(env, id))!;
  const second = await createLocation(env, id, "Eastside");
  if (!second.ok) throw new Error("no second location");
  return { id, first: first.id, second: second.location.id, cookie: await cookieOf(id) };
}

async function tapAt(shop: string, loc: string | null, device: string, tile: string, source: "card" | "online" = "card") {
  return call("/api/tap", json({ shop, tile, answer: "post", source, device, ...(loc ? { location: loc } : {}) }));
}

describe("a shop's locations", () => {
  it("every shop has a first location with its own id and name; /t/<shop> is that location", async () => {
    const id = await makeShop();
    const locs = await listLocations(env, id);
    expect(locs).toHaveLength(1);
    expect(locs[0]).toMatchObject({ id, first: true, hasTaps: false });
    const a = await (await call(`/t/${id}`)).text();
    const b = await (await call(`/t/${id}/${id}`)).text();
    expect(a).toContain(`"loc":"${id}"`);
    expect(b).toContain(`"loc":"${id}"`);
  });

  it("names: empty, long, taken (any case), the cap of 10; rename keeps the rules", async () => {
    const id = await makeShop();
    expect(await createLocation(env, id, "  ")).toMatchObject({ ok: false, problem: "empty" });
    expect(await createLocation(env, id, "x".repeat(25))).toMatchObject({ ok: false, problem: "long" });
    const ok = await createLocation(env, id, "Eastside");
    expect(ok.ok).toBe(true);
    expect(await createLocation(env, id, "eastside")).toMatchObject({ ok: false, problem: "taken" });
    for (let i = 0; i < 8; i++) expect((await createLocation(env, id, `Store ${i}`)).ok).toBe(true);
    expect(await createLocation(env, id, "One too many")).toMatchObject({ ok: false, problem: "cap" });
    const all = await listLocations(env, id);
    expect(all).toHaveLength(10);
    expect(await renameLocation(env, id, all[1].id, "Store 2")).toMatchObject({ ok: false, problem: "taken" });
    expect(await renameLocation(env, id, all[1].id, "Westside")).toMatchObject({ ok: true });
  });

  it("Remove only a location that is not the first and has no taps; the removed card says so and records nothing", async () => {
    const { id, first, second } = await shopWithTwo();
    expect(await removeLocation(env, id, first)).toMatchObject({ ok: false, problem: "first" });
    await tapAt(id, second, "d1", `a-${id}`);
    expect(await removeLocation(env, id, second)).toMatchObject({ ok: false, problem: "taps" });
    const third = await createLocation(env, id, "Uptown");
    if (!third.ok) throw new Error("x");
    expect(await removeLocation(env, id, third.location.id)).toMatchObject({ ok: true });
    const page = await call(`/t/${id}/${third.location.id}`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain("This card isn't in use any more. Ask at the till.");
    const tap = await tapAt(id, third.location.id, "d2", `a-${id}`);
    expect(tap.status).toBe(410);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM taps WHERE location_id = ?1`).bind(third.location.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
    // The name is free again.
    expect((await createLocation(env, id, "Uptown")).ok).toBe(true);
  });

  it("a location id paired with another shop is a 404 everywhere", async () => {
    const a = await shopWithTwo();
    const b = await shopWithTwo("Other Shop");
    expect((await call(`/t/${a.id}/${b.second}`)).status).toBe(404);
    expect((await tapAt(a.id, b.second, "d1", `a-${a.id}`)).status).toBe(404);
    expect((await call(`/api/wall?loc=${b.second}`, { cookie: a.cookie })).status).toBe(404);
    expect((await call(`/api/week?loc=${b.second}`, { cookie: a.cookie })).status).toBe(404);
    expect((await call(`/api/post/a-${a.id}?loc=${b.second}`, { cookie: a.cookie })).status).toBe(404);
    expect((await call(`/card?l=${b.second}`, { cookie: a.cookie })).status).toBe(404);
    expect((await call(`/api/shop/locations/${b.second}`, { ...json({ name: "Hijack" }, "PATCH"), cookie: a.cookie })).status).toBe(404);
    expect((await call(`/api/shop/locations/${b.second}`, { method: "DELETE", cookie: a.cookie })).status).toBe(404);
    const stillThere = await listLocations(env, b.id);
    expect(stillThere.map((l) => l.name)).toEqual(["Other Shop", "Eastside"]);
  });
});

describe("taps and counts follow the location (plan 1.3)", () => {
  it("a card tap carries its location, no location means the first, an online tap has none", async () => {
    const { id, first, second } = await shopWithTwo();
    await tapAt(id, second, "d1", `a-${id}`);
    await tapAt(id, null, "d2", `a-${id}`);
    await tapAt(id, second, "d3", `a-${id}`, "online");
    const rows = (await env.DB.prepare(`SELECT source, location_id FROM taps WHERE shop_id = ?1 ORDER BY created_at`).bind(id).all<{ source: string; location_id: string | null }>()).results;
    expect(rows).toEqual([{ source: "card", location_id: second }, { source: "card", location_id: first }, { source: "online", location_id: null }]);
  });

  it("one counted tap per device per shop per day, whichever location it was at", async () => {
    const { id, second } = await shopWithTwo();
    expect(((await (await tapAt(id, second, "same", `a-${id}`)).json()) as { counted: boolean }).counted).toBe(true);
    const again = (await (await tapAt(id, null, "same", `b-${id}`)).json()) as { counted: boolean; again: boolean };
    expect(again).toMatchObject({ counted: false, again: true });
  });

  it("every count follows the tab: a location is its own taps, All is the sum plus online", async () => {
    const { id, first, second, cookie } = await shopWithTwo();
    await tapAt(id, first, "d1", `a-${id}`);
    await tapAt(id, second, "d2", `a-${id}`);
    await tapAt(id, second, "d3", `a-${id}`);
    await tapAt(id, second, "d4", `b-${id}`);
    await tapAt(id, null, "d5", `a-${id}`, "online");
    type Wall = { countToday: number; tiles: { id: string; count: number }[]; locations: { id: string }[]; location: string | null };
    const get = async (q: string) => (await (await call(`/api/wall${q}`, { cookie })).json()) as Wall;
    const all = await get("");
    const f = await get(`?loc=${first}`);
    const s = await get(`?loc=${second}`);
    expect(all.locations.map((l) => l.id)).toEqual([first, second]);
    expect([f.countToday, s.countToday, all.countToday]).toEqual([1, 3, 5]);
    expect(all.countToday).toBe(f.countToday + s.countToday + 1); // plus the online tap
    const sticker = (w: Wall, t: string) => w.tiles.find((x) => x.id === t)!.count;
    expect([sticker(f, `a-${id}`), sticker(s, `a-${id}`), sticker(all, `a-${id}`)]).toEqual([1, 2, 4]);
    // This week: each tab's headline and rows add up to its own header number.
    for (const [q, n] of [["", 5], [`&loc=${first}`, 1], [`&loc=${second}`, 3]] as const) {
      const wk = (await (await call(`/api/week?range=today${q}`, { cookie })).json()) as { summary: { people: number }; tiles: { weekPeople: number; byLocation?: { label: string; n: number }[] }[] };
      expect(wk.summary.people).toBe(n);
      expect(wk.tiles.reduce((m, t) => m + t.weekPeople, 0)).toBe(n);
      if (q === "") expect(wk.tiles[0].byLocation).toEqual([{ label: "Eastside", n: 2 }, { label: "Downtown Bakery", n: 1 }, { label: "Online", n: 1 }]);
      else expect(wk.tiles[0].byLocation).toBeUndefined();
    }
    // A post's page: the same, and "Where they came in" under All locations.
    const all2 = (await (await call(`/api/post/a-${id}`, { cookie })).json()) as { byLocation?: { label: string; n: number }[]; tile: { count: number } };
    expect(all2.tile.count).toBe(4);
    expect(all2.byLocation).toEqual([{ label: "Downtown Bakery", n: 1 }, { label: "Eastside", n: 2 }, { label: "Online", n: 1 }]);
    const one = (await (await call(`/api/post/a-${id}?loc=${second}`, { cookie })).json()) as { byLocation?: unknown; tile: { count: number } };
    expect(one.tile.count).toBe(2);
    expect(one.byLocation).toBeUndefined();
  });

  it("a walked-past answer at a location is not in the today number", async () => {
    const { id, first, cookie } = await shopWithTwo();
    await call("/api/tap", json({ shop: id, tile: null, answer: "walked_past", source: "card", device: "w1", location: first }));
    const w = (await (await call(`/api/wall?loc=${first}`, { cookie })).json()) as { countToday: number };
    expect(w.countToday).toBe(0);
  });
});

describe("the bell names the store (plan 1.7)", () => {
  it("with two or more locations the sentence says where; with one it does not; an online tap has none", async () => {
    const one = await makeShop();
    await addChannel(one, `ig-${one}`, "instagram");
    await addTile(one, { id: `a-${one}`, text: "Sourdough is out.", sentAt: ago(5), channelId: `ig-${one}` });
    const solo = await recordTap(env, { shop: one, tile: `a-${one}`, answer: "post", source: "card", device: "s1", location: null });
    expect(solo.status === 200 && solo.ring?.message.sentence).toMatch(/^Someone just came in because of /);

    const { id, second } = await shopWithTwo();
    const t = await recordTap(env, { shop: id, tile: `a-${id}`, answer: "post", source: "card", device: "m1", location: second });
    expect(t.status === 200 && t.ring?.message.sentence).toMatch(/^Someone just came in at Eastside because of /);
    expect(t.status === 200 && t.ring?.message.locationId).toBe(second);
    const o = await recordTap(env, { shop: id, tile: `a-${id}`, answer: "post", source: "online", device: "m2", location: null });
    expect(o.status === 200 && o.ring?.message.sentence).toMatch(/^Someone just came in because of /);
  });
});

describe("cards and staff screens (plan 3.6, 3.8, 3.11)", () => {
  it("each location has its own card and QR; the first is /t/<shop>; the page switches between them", async () => {
    const { id, second, cookie } = await shopWithTwo();
    const c1 = await (await call("/card", { cookie })).text();
    const c2 = await (await call(`/card?l=${second}`, { cookie })).text();
    expect(c1).toContain("Card for");
    expect(c1).toContain(">Eastside</a>");
    expect(c2).toContain('<div class="loc">Eastside</div>');
    expect(c1).toContain('<div class="loc">Downtown Bakery</div>');
    expect(c1).not.toBe(c2);
    expect(c2).toContain(`l=${second}`);
    void id;
    // One location: the card is as before, with no switch and no name line.
    const solo = await makeShop();
    const sc = await (await call("/card", { cookie: await cookieOf(solo) })).text();
    expect(sc).not.toContain("Card for");
    expect(sc).not.toContain('class="loc"');
  });

  it("the staff screen belongs to one location; with two it must say which", async () => {
    const { id, first, second, cookie } = await shopWithTwo();
    const none = await call("/api/counter/open", { ...json({}), cookie });
    expect(none.status).toBe(400);
    const bad = await call("/api/counter/open", { ...json({ location: "zzzzzzzzzz" }), cookie });
    expect(bad.status).toBe(400);
    const open = (await (await call("/api/counter/open", { ...json({ location: second }), cookie })).json()) as { url: string };
    const page = await (await call(open.url)).text();
    expect(page).toContain("Staff screen · Eastside");
    const token = open.url.split("/c/")[1];
    await call("/api/counter/tap", json({ token, tile: `a-${id}`, answer: "post", device: "x" }));
    const tap = await env.DB.prepare(`SELECT source, location_id FROM taps WHERE shop_id = ?1`).bind(id).first<{ source: string; location_id: string }>();
    expect(tap).toEqual({ source: "counter", location_id: second });
    void first;
    // A shop with one location opens its screen with no question.
    const solo = await makeShop();
    const ok = await call("/api/counter/open", { ...json({}), cookie: await cookieOf(solo) });
    expect(ok.status).toBe(200);
  });

  it("Setup lists one tap link per location", async () => {
    const { first, second, cookie, id } = await shopWithTwo();
    const d = (await (await call("/api/setup", { cookie })).json()) as { tapUrls: { id: string; name: string; url: string }[] };
    expect(d.tapUrls.map((l) => l.id)).toEqual([first, second]);
    expect(d.tapUrls[0].url.endsWith(`/t/${id}`)).toBe(true);
    expect(d.tapUrls[1].url.endsWith(`/t/${id}/${second}`)).toBe(true);
  });
});

describe("Add a location with the same posts (plan 3.13)", () => {
  it("makes it at once, renames the first so the tabs read well, and says what is wrong in the plan's words", async () => {
    const id = await makeShop();
    await env.DB.prepare(`UPDATE shops SET name = 'Rye Bakery' WHERE id = ?1`).bind(id).run();
    const cookie = await cookieOf(id);
    expect(((await (await call("/api/shop/locations", { ...json({ name: "" }), cookie })).json()) as { error: string }).error).toBe("Give it a name.");
    const ok = (await (await call("/api/shop/locations", { ...json({ name: "Eastside", firstName: "Downtown" }), cookie })).json()) as { ok: boolean; location: { id: string }; next: string };
    expect(ok.ok).toBe(true);
    expect(ok.next).toBe(`/setup?added=${ok.location.id}`);
    expect((await listLocations(env, id)).map((l) => l.name)).toEqual(["Downtown", "Eastside"]);
    const dup = await call("/api/shop/locations", { ...json({ name: "Eastside" }), cookie });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toBe("You already have a location called Eastside.");
    // A first-name clash rolls the new location back (the rename only applies while the shop has one).
    const lone = await makeShop();
    const loneCookie = await cookieOf(lone);
    const clash = await call("/api/shop/locations", { ...json({ name: "Uptown", firstName: "uptown" }), cookie: loneCookie });
    expect(clash.status).toBe(400);
    expect(((await clash.json()) as { field: string }).field).toBe("firstName");
    expect(await listLocations(env, lone)).toHaveLength(1);
    // Past the first location, the first-name field is ignored.
    const later = await call("/api/shop/locations", { ...json({ name: "Uptown", firstName: "Eastside" }), cookie });
    expect(later.status).toBe(200);
    // Rename, then Remove with taps is refused with a reason.
    const rn = await call(`/api/shop/locations/${ok.location.id}`, { ...json({ name: "East End" }, "PATCH"), cookie });
    expect(rn.status).toBe(200);
  });
});

describe("the Monday push names the stores (plan 3.7)", () => {
  it("adds 'Downtown 7 · Eastside 4.' with two or more locations", async () => {
    const { id, first, second, cookie } = await shopWithTwo();
    const last = new Date("2026-11-04T18:00:00Z");
    const mk = (n: number, loc: string, tile: string) =>
      Promise.all(Array.from({ length: n }, (_, i) => env.DB.prepare(`INSERT INTO taps (id, shop_id, location_id, tile_id, answer, source, device_hash, rewarded, created_at) VALUES (?1, ?2, ?3, ?4, 'post', 'card', ?5, 0, ?6)`).bind(`mon-${loc}-${i}`, id, loc, tile, `dm${loc}${i}`, last.toISOString()).run()));
    await mk(7, first, `a-${id}`);
    await mk(4, second, `b-${id}`);
    const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await call("/api/push/subscribe", { ...json({ device: "p", subscription: { endpoint: "https://push.test/mon", keys: { p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) } } }), cookie });
    let payloadFor = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(req.url).host === "push.test") {
        payloadFor = "sent";
        return new Response(null, { status: 201 });
      }
      return new Response("no", { status: 404 });
    });
    expect(await mondayPushes(env, new Date("2026-11-09T15:00:00Z"))).toContain(id);
    expect(payloadFor).toBe("sent");
    const { weekByLocation } = await import("../src/worker/week");
    const shop = (await env.DB.prepare(`SELECT * FROM shops WHERE id = ?1`).bind(id).first())!;
    expect(await weekByLocation(env, shop as never, "last", new Date("2026-11-09T15:00:00Z"))).toBe("Downtown Bakery 7 · Eastside 4");
    void fakeBuffer;
  });
});
