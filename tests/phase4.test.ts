// Phase 4: P16 receipt tip and embed, P18 disconnect and delete, P20 vision sort, the Monday push catch-up.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { makeShop, addChannel, addTile, call, ownerCookie, fakeBuffer } from "./helpers";
import { runJobs, closeDeletedShop } from "../src/worker/writes";
import { getShop } from "../src/worker/db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function shopWithNotes(n = 2) {
  const id = await makeShop();
  await addChannel(id, `ig-${id}`, "instagram");
  for (let i = 0; i < n; i++) {
    await addTile(id, { id: `t${i}-${id}`, text: `Post ${i}`, sentAt: ago(30 + i), channelId: `ig-${id}`, image: true });
    await env.DB.prepare(`UPDATE tiles SET note_id = ?2, note_count = 3 WHERE id = ?1`).bind(`t${i}-${id}`, `note-${i}-${id}`).run();
  }
  return id;
}

const rows = async (table: string, id: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE shop_id = ?1`).bind(id).first<{ n: number }>())!.n;

describe("disconnect and delete takes Came In's notes out of Buffer (P18)", () => {
  it("every row and image goes now; the sign-in stays only until each note is deleted in Buffer", async () => {
    const id = await shopWithNotes(2);
    const fb = fakeBuffer();
    const cookie = await ownerCookie(id);
    await env.MEDIA.put(`share/${id}/s1.png`, "x");
    expect(await (await call("/api/shop/delete", { method: "POST", cookie })).json()).toMatchObject({ ok: true });
    for (const t of ["taps", "posts", "tiles", "channels", "counters", "push_subs"]) expect(await rows(t, id), t).toBe(0);
    expect(await env.MEDIA.get(`share/${id}/s1.png`)).toBeNull();
    // Waiting: one job per note, and the sign-in they need.
    expect(await rows("buffer_tokens", id)).toBe(1);
    expect(await rows("buffer_jobs", id)).toBe(2);
    await runJobs(env, id);
    expect(fb.deletedNotes.sort()).toEqual([`note-0-${id}`, `note-1-${id}`]);
    for (const t of ["buffer_tokens", "buffer_jobs"]) expect(await rows(t, id), t).toBe(0);
    expect((await getShop(env, id))!.deleted_at).not.toBeNull();
  });

  it("a shop with no notes keeps nothing, and a note that can't be removed doesn't hold the sign-in for ever", async () => {
    const none = await shopWithNotes(0);
    await call("/api/shop/delete", { method: "POST", cookie: await ownerCookie(none) });
    expect(await rows("buffer_tokens", none)).toBe(0);

    const id = await shopWithNotes(1);
    fakeBuffer();
    await call("/api/shop/delete", { method: "POST", cookie: await ownerCookie(id) });
    await env.DB.prepare(`UPDATE buffer_jobs SET tries = 5 WHERE shop_id = ?1`).bind(id).run();
    expect(await closeDeletedShop(env, id)).toBe(true);
    expect(await rows("buffer_tokens", id)).toBe(0);
    expect(await rows("buffer_jobs", id)).toBe(0);
  });
});

describe("the receipt tip and the embed (P16)", () => {
  it("/embed.js is a script that frames /e/<shop> from the script's own origin", async () => {
    const res = await call("/embed.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const js = await res.text();
    expect(js).toContain('"/e/"');
    expect(js).toContain("data-shop");
  });

  it("/e/<shop> is the tap page with no header, Day, and its taps are marked online", async () => {
    const id = await makeShop();
    await addChannel(id, `ig-${id}`, "instagram");
    await addTile(id, { id: `sour-${id}`, text: "Sourdough is out.", sentAt: ago(30), channelId: `ig-${id}`, image: true });
    const res = await call(`/e/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("content-security-policy") ?? "").not.toMatch(/frame-ancestors/);
    const html = await res.text();
    expect(html).not.toContain('class="hd"');
    expect(html).toContain('"src":"online"');
    expect(html).toContain('"mode":"embed"');
    await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "online", device: "e1" }));
    const row = await env.DB.prepare(`SELECT source FROM taps WHERE shop_id = ?1`).bind(id).first<{ source: string }>();
    expect(row!.source).toBe("online");
    const wall = (await (await call("/api/wall", { cookie: await ownerCookie(id) })).json()) as { countToday: number };
    expect(wall.countToday).toBe(1);
  });

  it("a deleted or unknown shop's embed says it is gone", async () => {
    expect((await call("/e/zzzzzzzzzz")).status).toBe(404);
  });
});

describe("the second round of strangers (Nov 4)", () => {
  it("the staff screen has its reserved row, the 'or' line and the staff words", async () => {
    const html = await (await call("/sample/c")).text();
    expect(html).toContain("Staff screen");
    expect(html).toContain("Or, if it wasn't a post:");
    expect(html).toContain('id="ok"');
    expect(html).not.toMatch(/\.ok\{position:fixed/);
    expect(html).toContain(".t.chk");
  });

  it("This week lists only posts with people, and counts the others", async () => {
    const week = (await (await call("/api/sample/week")).json()) as { summary: { posts: number }; tiles: { weekPeople: number }[] };
    expect(week.tiles.filter((t) => t.weekPeople > 0)).toHaveLength(week.summary.posts);
  });

  it("the sample's text-only post is shown by name without a leading 'the'", async () => {
    const html = await (await call("/sample/t")).text();
    expect(html).not.toMatch(/class="tx">the /i);
  });
});
