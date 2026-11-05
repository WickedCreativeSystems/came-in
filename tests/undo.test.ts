// P7 / plan 3.6: Undo on the staff screen.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { makeShop, addChannel, addTile, call, ownerCookie, cookiesFrom } from "./helpers";
import type { RoomMessage } from "../src/shared/types";

afterEach(() => vi.useRealTimers());

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const settle = () => new Promise((r) => setTimeout(r, 50));
const del = (path: string, cookie?: string) => call(path, { method: "DELETE", cookie });

async function shopWithPosts() {
  const id = await makeShop({});
  await addChannel(id, `ig-${id}`, "instagram");
  await addTile(id, { id: `sour-${id}`, text: "Sourdough is out of the oven.", sentAt: ago(30), channelId: `ig-${id}`, image: true });
  await addTile(id, { id: `hours-${id}`, text: "Winter hours start Monday.", sentAt: ago(50), channelId: `ig-${id}` });
  return id;
}

async function openCounterFor(id: string): Promise<string> {
  const r = await call("/api/counter/open", { method: "POST", cookie: await ownerCookie(id) });
  const { url } = (await r.json()) as { url: string };
  return url.slice(3);
}

async function openSocket(roomName: string, device: string) {
  const stub = env.SHOP_ROOM.get(env.SHOP_ROOM.idFromName(roomName));
  const res = await stub.fetch(`https://room/?device=${device}`, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket!;
  const got: RoomMessage[] = [];
  ws.accept();
  ws.addEventListener("message", (e) => got.push(JSON.parse(e.data as string)));
  return { ws, got };
}

async function tapOn(token: string, tile: string | null, answer = "post"): Promise<{ id?: string; counted: boolean }> {
  const r = await call("/api/counter/tap", json({ token, tile, answer, device: "tablet" }));
  return (await r.json()) as { id?: string; counted: boolean };
}

async function todayCount(id: string): Promise<number> {
  const r = await call("/api/wall", { cookie: await ownerCookie(id) });
  return ((await r.json()) as { countToday: number }).countToday;
}

describe("Undo on the staff screen (P7, plan 3.6)", () => {
  it("the page has the Undo button's words and a 5 second strip", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const html = await (await call(`/c/${token}`)).text();
    for (const w of ["Undo", "Undone.", "Too late to undo.", "setTimeout(fold,5000)", `/c/${token}/taps/`]) expect(html).toContain(w);
  });

  it("takes the newest tap back: the row goes, counts drop, open owner screens hear {type:undo}, the earlier ring stays", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const wall = await openSocket(id, "laptop");
    const t = await tapOn(token, `sour-${id}`);
    expect(t.counted).toBe(true);
    expect(t.id).toMatch(/\w+/);
    await settle();
    expect(await todayCount(id)).toBe(1);
    const r = await del(`/c/${token}/taps/${t.id}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    await settle();
    expect(await todayCount(id)).toBe(0);
    expect(wall.got.some((m) => m.type === "ring")).toBe(true);
    expect(wall.got.find((m) => m.type === "undo")).toMatchObject({ type: "undo", tapId: t.id, tileId: `sour-${id}` });
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM taps WHERE id = ?1`).bind(t.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
    // Gone now: a second Undo finds nothing.
    expect((await del(`/c/${token}/taps/${t.id}`)).status).toBe(404);
    wall.ws.close();
  });

  it("works for the three 'not a post' answers too", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const t = await tapOn(token, null, "walked_past");
    expect(t.id).toBeTruthy();
    expect((await del(`/c/${token}/taps/${t.id}`)).status).toBe(200);
  });

  it("an id from another counter, another shop, or nowhere is a 404 and nothing is deleted", async () => {
    const id = await shopWithPosts();
    const other = await shopWithPosts();
    const token = await openCounterFor(id);
    const token2 = await openCounterFor(id);
    const otherToken = await openCounterFor(other);
    const mine = await tapOn(token, `sour-${id}`);
    const theirs = await tapOn(otherToken, `sour-${other}`);
    expect((await del(`/c/${token2}/taps/${mine.id}`)).status).toBe(404);
    expect((await del(`/c/${token}/taps/${theirs.id}`)).status).toBe(404);
    expect((await del(`/c/${token}/taps/not-a-tap`)).status).toBe(404);
    expect((await del(`/c/${"x".repeat(32)}/taps/${mine.id}`)).status).toBe(404);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM taps WHERE id IN (?1, ?2)`).bind(mine.id, theirs.id).first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it("only the newest tap can be undone, and only within 60 seconds (410, too late)", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const start = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: start });
    const a = await tapOn(token, `sour-${id}`);
    vi.setSystemTime(start + 4000);
    const b = await tapOn(token, `hours-${id}`);
    expect(b.counted).toBe(true);
    const old = await del(`/c/${token}/taps/${a.id}`);
    expect(old.status).toBe(410);
    expect(await old.json()).toMatchObject({ ok: false });
    vi.setSystemTime(start + 4000 + 59_000);
    // Inside the window the newest one still goes.
    const c = await tapOn(token, `sour-${id}`);
    expect(c.counted).toBe(true);
    vi.setSystemTime(start + 4000 + 59_000 + 61_000);
    expect((await del(`/c/${token}/taps/${c.id}`)).status).toBe(410);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM taps WHERE id IN (?1, ?2, ?3)`).bind(a.id, b.id, c.id).first<{ n: number }>();
    expect(n!.n).toBe(3);
  });

  it("two taps on two tiles 3.2 s apart give two taps, and Undo then removes only the second (the first is too late)", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const start = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: start });
    const a = await tapOn(token, `sour-${id}`);
    vi.setSystemTime(start + 3200);
    const b = await tapOn(token, `hours-${id}`);
    expect(a.counted).toBe(true);
    expect(b.counted).toBe(true);
    expect(await todayCount(id)).toBe(2);
    expect((await del(`/c/${token}/taps/${a.id}`)).status).toBe(410);
    expect((await del(`/c/${token}/taps/${b.id}`)).status).toBe(200);
    expect(await todayCount(id)).toBe(1);
    const left = await env.DB.prepare(`SELECT id FROM taps WHERE id IN (?1, ?2)`).bind(a.id, b.id).all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual([a.id]);
  });

  it("a tap within 3 s of the last one is not counted, as plan 1.3 says", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const start = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: start });
    expect((await tapOn(token, `sour-${id}`)).counted).toBe(true);
    vi.setSystemTime(start + 1000);
    expect((await tapOn(token, `hours-${id}`)).counted).toBe(false);
    vi.setSystemTime(start + 3200);
    expect((await tapOn(token, `hours-${id}`)).counted).toBe(true);
  });

  it("a closed staff screen can't undo", async () => {
    const id = await shopWithPosts();
    const token = await openCounterFor(id);
    const t = await tapOn(token, `sour-${id}`);
    await call("/api/counter/close", { ...json({ token }), cookie: await ownerCookie(id) });
    expect((await del(`/c/${token}/taps/${t.id}`)).status).toBe(409);
  });
});

describe("Undo in the sample", () => {
  it("takes back this browser's newest staff-screen tap, and nobody else's", async () => {
    const first = await call("/sample/c");
    const cookie = cookiesFrom(first);
    const wall0 = (await (await call("/api/sample/wall", { cookie })).json()) as { countToday: number };
    const tile = `${(await (await call("/api/sample/wall", { cookie })).json() as { tiles: { id: string }[] }).tiles[0].id}`;
    const r = await call("/api/sample/counter/tap", { ...json({ tile, answer: "post" }), cookie });
    const { id } = (await r.json()) as { id: string };
    expect(id).toMatch(/^\d+$/);
    const wall1 = (await (await call("/api/sample/wall", { cookie })).json()) as { countToday: number };
    expect(wall1.countToday).toBe(wall0.countToday + 1);
    const stranger = cookiesFrom(await call("/sample/c"));
    expect((await del(`/api/sample/counter/taps/${id}`, stranger)).status).toBe(404);
    expect((await del(`/api/sample/counter/taps/${id}`, cookie)).status).toBe(200);
    const wall2 = (await (await call("/api/sample/wall", { cookie })).json()) as { countToday: number };
    expect(wall2.countToday).toBe(wall0.countToday);
    expect((await del(`/api/sample/counter/taps/${id}`, cookie)).status).toBe(404);
    expect((await del(`/api/sample/counter/taps/abc`, cookie)).status).toBe(404);
  });
});
