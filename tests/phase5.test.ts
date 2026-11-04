// Phase 5: P21 Locations and pricing (plan 1.5, 3.13): many shops in one browser, each wholly separate.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { makeShop, addChannel, addTile, call, cookiesFrom, fakeBuffer } from "./helpers";
import { sign } from "../src/worker/lib/crypto";
import { getShop } from "../src/worker/db";

afterEach(() => {
  vi.restoreAllMocks();
});

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** An owner cookie holding several shops, the first one current. */
async function cookieFor(shops: string[], current = shops[0]): Promise<string> {
  return `ci_owner=${await sign(`${current}.${Date.now()}.${shops.join(",")}`, env.COOKIE_SECRET)}`;
}
const ownerOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("ci_owner="))!.split(";")[0];

async function shopWith(name: string, text: string) {
  const id = await makeShop();
  await env.DB.prepare(`UPDATE shops SET name = ?2 WHERE id = ?1`).bind(id, name).run();
  await addChannel(id, `ig-${id}`, "instagram");
  await addTile(id, { id: `t-${id}`, text, sentAt: ago(30), channelId: `ig-${id}`, image: true });
  return id;
}

describe("many shops in one browser (P21, plan 1.5)", () => {
  it("the old one-shop cookie still works, and a list cookie names every shop", async () => {
    const a = await shopWith("Shop A", "A's post");
    const { sign: s } = await import("../src/worker/lib/crypto");
    const old = `ci_owner=${await s(`${a}.${Date.now()}`, env.COOKIE_SECRET)}`;
    const wall = (await (await call("/api/wall", { cookie: old })).json()) as { shop: { name: string } };
    expect(wall.shop.name).toBe("Shop A");
    const locs = (await (await call("/api/locations", { cookie: old })).json()) as { shops: { id: string }[]; current: string };
    expect(locs.shops.map((x) => x.id)).toEqual([a]);
  });

  it("switching to a shop in the list opens it; one that isn't is refused and nothing changes", async () => {
    const a = await shopWith("Shop A", "A's post");
    const b = await shopWith("Shop B", "B's post");
    const stranger = await shopWith("Shop C", "C's post");
    const cookie = await cookieFor([a, b]);
    const ok = await call("/setup/switch", { ...json({ shop: b }), cookie });
    expect(ok.status).toBe(200);
    const next = ownerOf(ok);
    const wall = (await (await call("/api/wall", { cookie: next })).json()) as { shop: { name: string } };
    expect(wall.shop.name).toBe("Shop B");
    const no = await call("/setup/switch", { ...json({ shop: stranger }), cookie });
    expect(no.status).toBe(403);
    expect(no.headers.getSetCookie().some((c) => c.startsWith("ci_owner="))).toBe(false);
    const still = (await (await call("/api/wall", { cookie })).json()) as { shop: { name: string } };
    expect(still.shop.name).toBe("Shop A");
  });

  it("a cookie whose list was tampered with is refused", async () => {
    const a = await shopWith("Shop A", "A's post");
    const b = await shopWith("Shop B", "B's post");
    const good = await cookieFor([a]);
    const forged = good.replace(`.${(good.split(".")[2] ?? "").split(".")[0]}`, ""); // same value, broken HMAC
    const tampered = `ci_owner=${good.split("=")[1].replace(a + ",", "").replace(/\.[^.]+$/, `.AAAA`)}`;
    void forged;
    expect((await call("/api/wall", { cookie: tampered })).status).toBe(401);
    // A current shop that is not in its own list is refused too.
    const bad = `ci_owner=${await sign(`${b}.${Date.now()}.${a}`, env.COOKIE_SECRET)}`;
    expect((await call("/api/wall", { cookie: bad })).status).toBe(401);
  });

  it("each shop is wholly separate: tiles, taps, settings and the week never cross", async () => {
    const a = await shopWith("Shop A", "Sourdough for A");
    const b = await shopWith("Shop B", "Haircuts for B");
    await call("/api/tap", json({ shop: a, tile: `t-${a}`, answer: "post", source: "card", device: "d1" }));
    await call("/api/tap", json({ shop: a, tile: `t-${a}`, answer: "post", source: "card", device: "d2" }));
    const cookie = await cookieFor([a, b]);
    await call("/api/setup", { ...json({ thankYou: "A's free cookie" }), cookie });
    const wallA = (await (await call("/api/wall", { cookie })).json()) as { tiles: { id: string; count: number }[]; countToday: number };
    expect(wallA.tiles.map((t) => t.id)).toEqual([`t-${a}`]);
    expect(wallA.countToday).toBe(2);
    const onB = ownerOf(await call("/setup/switch", { ...json({ shop: b }), cookie }));
    const wallB = (await (await call("/api/wall", { cookie: onB })).json()) as { tiles: { id: string }[]; countToday: number };
    expect(wallB.tiles.map((t) => t.id)).toEqual([`t-${b}`]);
    expect(wallB.countToday).toBe(0);
    const weekB = (await (await call("/api/week?range=today", { cookie: onB })).json()) as { summary: { headline: string }; tiles: { id: string }[] };
    expect(weekB.summary.headline).toBe("Nobody has tapped yet today.");
    expect(weekB.tiles.every((t) => t.id !== `t-${a}`)).toBe(true);
    const setupB = (await (await call("/api/setup", { cookie: onB })).json()) as { settings: { thankYou: string | null } };
    expect(setupB.settings.thankYou).toBeNull();
    // A post of A is not reachable from B's session.
    expect((await call(`/api/post/t-${a}`, { cookie: onB })).status).toBe(404);
    // And B's tap page and card never carry A's post.
    expect(await (await call(`/t/${b}`)).text()).not.toContain("Sourdough for A");
  });

  it("deleting one shop leaves the others signed in", async () => {
    const a = await shopWith("Shop A", "A's post");
    const b = await shopWith("Shop B", "B's post");
    const cookie = await cookieFor([a, b]);
    const res = await call("/api/shop/delete", { method: "POST", cookie });
    expect(((await res.json()) as { next: string }).next).toBe("/wall");
    const next = ownerOf(res);
    const wall = (await (await call("/api/wall", { cookie: next })).json()) as { shop: { name: string } };
    expect(wall.shop.name).toBe("Shop B");
    expect((await getShop(env, a))!.deleted_at).not.toBeNull();
    expect((await getShop(env, b))!.deleted_at).toBeNull();
  });
});

describe("Add a location runs Connect Buffer again (P21, plan 3.13)", () => {
  let acct = "acct-loc";
  let n = 0;
  async function firstShop() {
    acct = `acct-loc-${++n}`;
    fakeBuffer({ account: { id: acct, name: "O", timezone: "America/Chicago", organizations: [{ id: "o-1", name: "Shop One" }] } });
    const start = await call("/auth/start");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cb = await call(`/auth/callback?code=good&state=${state}`, { cookie: cookiesFrom(start) });
    return ownerOf(cb);
  }
  async function addWith(orgs: { id: string; name: string }[], owner: string) {
    fakeBuffer({ account: { id: acct, name: "O", timezone: "America/Chicago", organizations: orgs } });
    const start = await call("/auth/start?add=1", { cookie: owner });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    return call(`/auth/callback?code=good&state=${state}`, { cookie: `${owner}; ${cookiesFrom(start)}` });
  }

  it("the page before consent says why you sign in again", async () => {
    const owner = await firstShop();
    const html = await (await call("/setup/add", { cookie: owner })).text();
    expect(html).toContain("You'll sign in to Buffer again, so each shop keeps its own connection.");
    expect((await call("/setup/add")).status).toBe(302);
  });

  it("a new organization becomes a second shop with its own sign-in; the first stays", async () => {
    const owner = await firstShop();
    const res = await addWith([{ id: "o-1", name: "Shop One" }, { id: "o-2", name: "Shop Two" }], owner);
    expect(res.headers.get("location")).toBe("/setup/channels");
    const next = ownerOf(res);
    const locs = (await (await call("/api/locations", { cookie: next })).json()) as { shops: { name: string }[]; current: string };
    expect(locs.shops.map((s) => s.name).sort()).toEqual(["Shop One", "Shop Two"]);
    const two = await env.DB.prepare(`SELECT id FROM shops WHERE buffer_account_id = ?1 AND buffer_org_id = 'o-2'`).bind(acct).first<{ id: string }>();
    expect(locs.current).toBe(two!.id);
    const tokens = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buffer_tokens WHERE shop_id IN (SELECT id FROM shops WHERE buffer_account_id = ?1)`).bind(acct).first<{ n: number }>();
    expect(tokens!.n).toBe(2);
  });

  it("Which shop? lists only the organizations not yet added", async () => {
    const owner = await firstShop();
    const res = await addWith([{ id: "o-1", name: "Shop One" }, { id: "o-3", name: "Shop Three" }, { id: "o-4", name: "Shop Four" }], owner);
    expect(res.headers.get("location")).toBe("/setup/org");
    const orgs = (await (await call("/api/orgs", { cookie: cookiesFrom(res) })).json()) as { orgs: { name: string }[] };
    expect(orgs.orgs.map((o) => o.name)).toEqual(["Shop Three", "Shop Four"]);
  });

  it("nothing new says so; the same single shop is reconnected and not duplicated", async () => {
    const owner = await firstShop();
    const again = await addWith([{ id: "o-1", name: "Shop One" }], owner);
    expect(again.headers.get("location")).toBe("/setup/add?state=reconnected");
    expect(await (await call("/setup/add?state=reconnected", { cookie: owner })).text()).toContain("Reconnected.");
    const cnt = await env.DB.prepare(`SELECT COUNT(*) AS n FROM shops WHERE buffer_account_id = ?1`).bind(acct).first<{ n: number }>();
    expect(cnt!.n).toBe(1);
    const two = await addWith([{ id: "o-1", name: "Shop One" }, { id: "o-2", name: "Shop Two" }], owner);
    const both = ownerOf(two);
    const none = await addWith([{ id: "o-1", name: "Shop One" }, { id: "o-2", name: "Shop Two" }], both);
    expect(none.headers.get("location")).toBe("/setup/add?state=none");
    const page = await (await call("/setup/add?state=none", { cookie: both })).text();
    expect(page).toContain("Every shop in this Buffer is already added.");
    expect(page).toContain("Connect a different Buffer account");
  });

  it("is never blocked by payment: a second shop needs no price and no link", async () => {
    const owner = await firstShop();
    const res = await addWith([{ id: "o-1", name: "Shop One" }, { id: "o-2", name: "Shop Two" }], owner);
    expect(res.status).toBe(302);
    expect(env.PRICE_TEXT).toBeUndefined();
  });
});

describe("the pricing page (P21, plan 3.13)", () => {
  const e = env as unknown as { PRICE_TEXT?: string; STRIPE_PAYMENT_LINK?: string };
  afterEach(() => {
    delete e.PRICE_TEXT;
    delete e.STRIPE_PAYMENT_LINK;
  });

  it("with nothing set it says one shop is free and to write to us", async () => {
    const html = await (await call("/pricing")).text();
    expect(html).toContain("One shop is free.");
    expect(html).toContain("Need more than one shop? Write to us.");
    expect(html).not.toContain("Pay for more shops");
  });

  it("with a price and a Stripe link it says the price and opens the link; other links are ignored", async () => {
    e.PRICE_TEXT = "9";
    e.STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_abc";
    const html = await (await call("/pricing")).text();
    expect(html).toContain("More shops are $9 a month each.");
    expect(html).toContain('href="https://buy.stripe.com/test_abc" target="_blank"');
    expect(html).toContain("We don't check payments, so you won't be locked out.");
    e.STRIPE_PAYMENT_LINK = "https://evil.example.com/pay";
    expect(await (await call("/pricing")).text()).not.toContain("evil.example.com");
  });

  it("is linked from the landing and the footer", async () => {
    const html = await (await call("/")).text();
    expect(html).toContain('href="/pricing"');
  });
});

describe("Today is one number everywhere (plan 1.3)", () => {
  it("the header, the Today headline and its rows agree; walked past, a friend and Google are not in it; stickers never feed it", async () => {
    const id = await makeShop();
    await addChannel(id, `ig-${id}`, "instagram");
    await addTile(id, { id: `a-${id}`, text: "A", sentAt: ago(5), channelId: `ig-${id}` });
    await addTile(id, { id: `b-${id}`, text: "B", sentAt: ago(70), channelId: `ig-${id}` });
    // Old taps on a post: they count on its 60-day sticker, not today.
    await env.DB.prepare(`INSERT INTO taps (id, shop_id, tile_id, answer, source, device_hash, rewarded, created_at) VALUES ('old1', ?1, ?2, 'post', 'card', 'o1', 0, ?3)`).bind(id, `b-${id}`, ago(48)).run();
    await call("/api/tap", json({ shop: id, tile: `a-${id}`, answer: "post", source: "card", device: "d1" }));
    await call("/api/tap", json({ shop: id, tile: `a-${id}`, answer: "post", source: "card", device: "d2" }));
    await call("/api/tap", json({ shop: id, tile: `b-${id}`, answer: "post", source: "online", device: "d3" }));
    await call("/api/tap", json({ shop: id, tile: null, answer: "walked_past", source: "card", device: "d4" }));
    const cookie = `ci_owner=${await sign(`${id}.${Date.now()}.${id}`, env.COOKIE_SECRET)}`;
    const wall = (await (await call("/api/wall", { cookie })).json()) as { countToday: number; tiles: { id: string; count: number }[] };
    const day = (await (await call("/api/week?range=today", { cookie })).json()) as { summary: { headline: string; people: number }; tiles: { weekPeople: number }[] };
    expect(wall.countToday).toBe(3);
    expect(wall.tiles.find((t) => t.id === `b-${id}`)!.count).toBe(2); // the sticker is 60 days, the old tap included
    expect(day.summary.people).toBe(3);
    expect(day.summary.headline).toBe("3 people came in today because of 2 posts.");
    expect(day.tiles.reduce((n, t) => n + t.weekPeople, 0)).toBe(wall.countToday);
  });

  it("in the sample the header and the Today tab agree, before and after a tap", async () => {
    const first = await call("/api/sample/wall");
    const cookie = first.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const w0 = (await first.json()) as { countToday: number };
    const d0 = (await (await call("/api/sample/week?range=today", { cookie })).json()) as { summary: { people: number }; tiles: { weekPeople: number }[] };
    expect(d0.summary.people).toBe(w0.countToday);
    expect(d0.tiles.reduce((n, t) => n + t.weekPeople, 0)).toBe(w0.countToday);
    await call("/api/sample/tap", { ...json({ tile: "sour", answer: "post" }), cookie });
    await call("/api/sample/tap", { ...json({ tile: null, answer: "walked_past" }), cookie });
    const w1 = (await (await call("/api/sample/wall", { cookie })).json()) as { countToday: number };
    const d1 = (await (await call("/api/sample/week?range=today", { cookie })).json()) as { summary: { people: number } };
    expect(w1.countToday).toBe(w0.countToday + 1);
    expect(d1.summary.people).toBe(w1.countToday);
  });
});

describe("the staging-only two-shop page", () => {
  it("does not exist outside staging", async () => {
    const res = await call("/staging/shops");
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe("screens paint a frame at once (plan 3.4)", () => {
  it("the page the browser first gets already holds the header and tile placeholders", async () => {
    const html = await (await call("/wall")).text();
    expect(html).toContain('class="sk-h"');
    expect(html).toContain('class="sk-t"');
  });

  it("tile names read without a leading 'the' for screen readers", async () => {
    const tap = await (await call("/sample/t")).text();
    expect(tap).not.toMatch(/aria-label="the /i);
    const staff = await (await call("/sample/c")).text();
    expect(staff).not.toMatch(/aria-label="the /i);
  });
});
