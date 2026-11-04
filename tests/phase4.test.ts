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
    expect(js).toContain("/sample/t");
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

describe("the vision sort (P20)", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const e = env as unknown as { ANTHROPIC_API_KEY?: string };
  afterEach(() => {
    delete e.ANTHROPIC_API_KEY;
  });

  async function photoShop() {
    const id = await makeShop();
    await addChannel(id, `ig-${id}`, "instagram");
    await addTile(id, { id: `sour-${id}`, text: "Sourdough is out of the oven.", sentAt: ago(30), channelId: `ig-${id}`, image: true });
    await env.DB.prepare(`UPDATE posts SET kind = 'photo', thumb_status = 'ok', thumb_key = ?2 WHERE id = ?1`).bind(`p-sour-${id}`, `thumbs/${id}/p-sour-${id}`).run();
    await env.MEDIA.put(`thumbs/${id}/p-sour-${id}`, JPEG, { httpMetadata: { contentType: "image/jpeg" } });
    return id;
  }
  const answer = (text: string, status = 200) => vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.anthropic.com/")) return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status });
    return new Response("no", { status: 404 });
  });

  it("sorts the picture and names the post, once, and the name reaches the bell sentence", async () => {
    const { queueVision, parseVision, cleanSubject } = await import("../src/worker/vision");
    const id = await photoShop();
    e.ANTHROPIC_API_KEY = "test-key";
    const spy = answer('Here you go: {"kind":"real_photo","subject":"Sourdough!"}');
    expect(await queueVision(env)).toBeGreaterThanOrEqual(1);
    await runJobs(env, id);
    const row = await env.DB.prepare(`SELECT kind_detail FROM posts WHERE id = ?1`).bind(`p-sour-${id}`).first<{ kind_detail: string }>();
    expect(row!.kind_detail).toBe("real_photo");
    const tile = await env.DB.prepare(`SELECT subject FROM tiles WHERE id = ?1`).bind(`sour-${id}`).first<{ subject: string }>();
    expect(tile!.subject).toBe("sourdough");
    const call1 = spy.mock.calls.find((c) => String(c[0]).startsWith("https://api.anthropic.com/"))!;
    const sent = JSON.parse(String((call1[1] as RequestInit).body));
    expect(sent.model).toBe("claude-haiku-5-5");
    expect((call1[1] as RequestInit).headers).toMatchObject({ "x-api-key": "test-key" });
    // Never re-run.
    expect(await queueVision(env)).toBe(0);
    const before = spy.mock.calls.length;
    await runJobs(env, id);
    expect(spy.mock.calls.length).toBe(before);
    expect(parseVision('{"kind":"nope"}')).toBeNull();
    expect(cleanSubject("one two three four")).toBeNull();
    expect(cleanSubject("Winter Hours.")).toBe("winter hours");
  });

  it("without the key nothing is queued or sent; with a failing call nothing is stored and the job retries", async () => {
    const { queueVision } = await import("../src/worker/vision");
    const id = await photoShop();
    const spy = answer("{}");
    expect(await queueVision(env)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    e.ANTHROPIC_API_KEY = "test-key";
    answer("I could not tell.", 200);
    await queueVision(env);
    await runJobs(env, id);
    const row = await env.DB.prepare(`SELECT kind_detail FROM posts WHERE id = ?1`).bind(`p-sour-${id}`).first<{ kind_detail: string | null }>();
    expect(row!.kind_detail).toBeNull();
    const job = await env.DB.prepare(`SELECT tries, done_at FROM buffer_jobs WHERE shop_id = ?1 AND kind = 'vision'`).bind(id).first<{ tries: number; done_at: string | null }>();
    expect(job).toMatchObject({ tries: 1, done_at: null });
    // The wall still names the post the plain way.
    const wall = (await (await call("/api/wall", { cookie: await ownerCookie(id) })).json()) as { tiles: { name: string }[] };
    expect(wall.tiles[0].name).toMatch(/post/);
  });
});

describe("the vision sort on a video post", () => {
  it("names the post from its thumbnail but doesn't sort it as a photo", async () => {
    const e = env as unknown as { ANTHROPIC_API_KEY?: string };
    const { queueVision } = await import("../src/worker/vision");
    const id = await makeShop();
    await addChannel(id, `yt-${id}`, "youtube");
    await addTile(id, { id: `vid-${id}`, text: "A dungeon from a seed.", sentAt: ago(30), channelId: `yt-${id}`, image: true });
    await env.DB.prepare(`UPDATE posts SET kind = 'video', thumb_status = 'ok', thumb_key = ?2 WHERE id = ?1`).bind(`p-vid-${id}`, `thumbs/${id}/p-vid-${id}`).run();
    await env.MEDIA.put(`thumbs/${id}/p-vid-${id}`, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), { httpMetadata: { contentType: "image/jpeg" } });
    e.ANTHROPIC_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"kind":"graphic","subject":"dungeon map"}' }] })));
    await queueVision(env);
    await runJobs(env, id);
    delete e.ANTHROPIC_API_KEY;
    const post = await env.DB.prepare(`SELECT kind_detail FROM posts WHERE id = ?1`).bind(`p-vid-${id}`).first<{ kind_detail: string | null }>();
    const tile = await env.DB.prepare(`SELECT subject FROM tiles WHERE id = ?1`).bind(`vid-${id}`).first<{ subject: string }>();
    expect(post!.kind_detail).toBeNull();
    expect(tile!.subject).toBe("dungeon map");
  });
});

describe("Ring my phone sounds like a bell (P9)", () => {
  it("the notification is not silent, vibrates, and re-alerts on the same post; the push is high urgency", async () => {
    const sw = await (await call("/sw.js")).text();
    expect(sw).toContain("silent: false");
    expect(sw).toMatch(/vibrate: \[\d+(, \d+)+\]/);
    expect(sw).toContain("renotify: true");
    expect(sw).toMatch(/tag: note\.tag \|\| "came-in"/);
  });

  it("the push goes out with high urgency", async () => {
    const { sendAll } = await import("../src/worker/push");
    const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const seen: Headers[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      seen.push(req.headers);
      return new Response(null, { status: 201 });
    });
    const r = await sendAll(env, [{ id: "s1", device_id: "d", endpoint: "https://push.test/x", p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) }], { title: "Came In", body: "x", icon: null, url: "/wall", tag: "t1" });
    expect(r.sent).toBe(1);
    expect(seen[0].get("urgency")).toBe("high");
  });
});

describe("the privacy page says what goes to Anthropic", () => {
  it("in the plan's words", async () => {
    const html = await (await call("/privacy")).text();
    expect(html).toContain("For a post with a picture or video, its picture and words are sent once to Anthropic, only to give the post a short name. Nothing else is sent, and nothing about a customer.");
  });
});
