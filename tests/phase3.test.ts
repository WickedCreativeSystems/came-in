// Phase 3: P11 This week, P12 write-backs, P13 note, P14 share image, P15 check, P17 nickname and hide.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { makeShop, addChannel, addTile, call, ownerCookie, fakeBuffer, cookiesFrom } from "./helpers";
import { summarize, ratioLine, mondayBody, type WeekTap, type WeekTile } from "../src/shared/week";
import { sampleHistory } from "../src/shared/sampleweek";
import { isNoteStep, noteText, runJobs } from "../src/worker/writes";
import { mondayPushes } from "../src/worker/index";
import { getShop } from "../src/worker/db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const TZ = "America/Chicago";

function tiles(): WeekTile[] {
  return [
    { id: "a", firstSentAt: "2026-11-03T00:10:00Z", kind: "photo", kindDetail: null, isStory: false }, // Mon 6:10 pm
    { id: "b", firstSentAt: "2026-11-05T14:00:00Z", kind: "video", kindDetail: null, isStory: false }, // Thu 8 am
    { id: "c", firstSentAt: "2026-11-04T15:00:00Z", kind: "text", kindDetail: null, isStory: false },
    { id: "s", firstSentAt: "2026-11-05T15:00:00Z", kind: "photo", kindDetail: null, isStory: true },
  ];
}
const tap = (tileId: string | null, answer: WeekTap["answer"] = "post", source = "card"): WeekTap => ({ tileId, answer, source, at: "2026-11-05T18:00:00Z" });

describe("This week's words (P11, plan 1.7 and 3.7)", () => {
  it("nobody yet, under ten answers, and the full sentence", () => {
    expect(summarize([], tiles(), TZ, "this").headline).toBe("Nobody has tapped yet this week.");
    expect(summarize([tap("a"), tap("a"), tap("b")], tiles(), TZ, "this").headline).toBe("3 people said a post brought them in this week.");
    const many = [...Array(9)].map(() => tap("a")).concat([tap("b"), tap("c"), tap("s")]);
    expect(summarize(many, tiles(), TZ, "this").headline).toBe("12 people came in because of 4 posts.");
    expect(summarize([tap("a")], tiles(), TZ, "this").headline).toBe("1 person said a post brought them in this week.");
  });

  it("pattern lines only with at least 3 people, all-zero lines hidden, at most 4, biggest first", () => {
    expect(summarize([tap("a"), tap("a")], tiles(), TZ, "this").patterns).toEqual([]);
    const s = summarize([tap("a"), tap("a"), tap("a"), tap("b"), tap("s")], tiles(), TZ, "this");
    expect(s.patterns.length).toBeLessThanOrEqual(4);
    expect(s.patterns).toContain("Photos brought 4 people. Videos brought 1. Text-only posts brought 0.");
    expect(s.patterns).toContain("Stories brought 1 person.");
    expect(s.patterns.some((p) => /^Posts sent on Monday brought the most people: 3\.$/.test(p))).toBe(true);
    expect(s.patterns.some((p) => /^Posts sent in the evening brought 3 people; mornings 2\.$/.test(p))).toBe(true);
  });

  it("sorted photos read as real things and graphics", () => {
    const t = tiles().map((x) => (x.id === "a" ? { ...x, kindDetail: "real_photo" as const } : x.id === "s" ? { ...x, kindDetail: "graphic" as const } : x));
    const s = summarize([tap("a"), tap("a"), tap("a"), tap("s")], t, TZ, "this");
    expect(s.patterns).toContain("Photos of real things brought 3 people. Graphics brought 1.");
  });

  it("the ratio line: counter taps only, at least 10, 1 in N or the reduced fraction", () => {
    expect(ratioLine(9, 3)).toBeNull();
    expect(ratioLine(16, 4)).toBe("At your counter, 1 in 4 new customers who told us came because of a post.");
    expect(ratioLine(12, 3)).toBe("At your counter, 1 in 4 new customers who told us came because of a post.");
    expect(ratioLine(8 + 4, 9)).toBe("At your counter, 3 in 4 new customers who told us came because of a post.");
    expect(ratioLine(10, 0)).toBeNull();
    expect(ratioLine(10, 10)).toBe("At your counter, every new customer who told us came because of a post.");
    expect(ratioLine(14, 14)).toBe("At your counter, every new customer who told us came because of a post.");
    expect(ratioLine(9, 9)).toBeNull();
    // Card taps never count toward the ratio.
    const s = summarize([...Array(10)].map(() => tap("a", "post", "card")), tiles(), TZ, "this");
    expect(s.ratio).toBeNull();
  });

  it("receipt lines when the counter has been used; I didn't see a post counts as walked past", () => {
    const s = summarize([tap(null, "walked_past", "counter"), tap(null, "walked_past", "card"), tap(null, "friend", "counter"), tap(null, "google", "counter")], tiles(), TZ, "this");
    expect(s.receipts).toEqual([
      { label: "Walked past", n: 2 },
      { label: "A friend told them", n: 1 },
      { label: "Found us on Google", n: 1 },
    ]);
    expect(summarize([tap("a")], tiles(), TZ, "this").receipts).toEqual([]);
  });

  it("tiles ranked by people, zeros last; the Monday push's words", () => {
    const s = summarize([tap("b"), tap("b"), tap("a")], tiles(), TZ, "last");
    expect(s.ranked.map((r) => r.tileId).slice(0, 2)).toEqual(["b", "a"]);
    expect(s.ranked.slice(2).every((r) => r.people === 0)).toBe(true);
    const many = [...Array(11)].map((_, i) => tap(["a", "b", "c", "s"][i % 4]));
    expect(mondayBody(summarize(many, tiles(), TZ, "last"))).toBe("Your week: 11 people came in because of 4 posts.");
    expect(mondayBody(summarize([], tiles(), TZ, "last"))).toBeNull();
  });

  it("the sample bakery's week agrees with its stickers on every day of the week", async () => {
    const r = await call("/api/sample/week");
    const d = (await r.json()) as { summary: { headline: string; ratio: string | null; receipts: { label: string; n: number }[] }; tiles: { id: string; weekPeople: number; count: number }[] };
    expect(d.summary.headline).toMatch(/^(\d+ people came in because of \d+ posts?|\d+ (people|person) said a post brought them in this week)\.$/);
    expect(d.summary.receipts).toEqual([
      { label: "Walked past", n: 6 },
      { label: "A friend told them", n: 4 },
      { label: "Found us on Google", n: 2 },
    ]);
    expect(d.summary.ratio).toMatch(/^At your counter, 1 in \d+ new customers who told us came because of a post\.$/);
    for (const t of d.tiles) expect(t.weekPeople).toBeLessThanOrEqual(t.count);
    // On every day of a week, each post's history adds up to its sticker and never comes before it was sent.
    for (let day = 0; day < 7; day++) {
      const now = new Date(Date.UTC(2026, 10, 9 + day, 16));
      const h = sampleHistory(now);
      expect(h.filter((t) => t.tileId === "sour").length).toBe(6);
      expect(h.filter((t) => t.tileId === "crois").length).toBe(4);
      for (const t of h) expect(new Date(t.at).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });
});

async function shopWithPosts(opts: { winners?: boolean } = {}) {
  const id = await makeShop();
  await addChannel(id, `ig-${id}`, "instagram");
  await addChannel(id, `fb-${id}`, "facebook");
  await addTile(id, { id: `sour-${id}`, text: "Sourdough is out of the oven.", sentAt: ago(30), channelId: `ig-${id}`, image: true });
  await env.DB.prepare(`UPDATE posts SET source_url = ?2 WHERE id = ?1`).bind(`p-sour-${id}`, `https://img.test/sour.jpg`).run();
  await addTile(id, { id: `hours-${id}`, text: "Winter hours start Monday.", sentAt: ago(50), channelId: `fb-${id}` });
  if (opts.winners === false) await env.DB.prepare(`UPDATE shops SET mark_winners = 0 WHERE id = ?1`).bind(id).run();
  return id;
}

describe("This week for a real shop (P11)", () => {
  it("counts this week's taps from the taps table and ranks the tiles", async () => {
    const id = await shopWithPosts();
    for (const d of ["a", "b", "c"]) await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: d }));
    const w = (await (await call("/api/week", { cookie: await ownerCookie(id) })).json()) as { summary: { headline: string; people: number }; tiles: { id: string; weekPeople: number }[]; channels: unknown[] };
    expect(w.summary.people).toBe(3);
    expect(w.summary.headline).toBe("3 people said a post brought them in this week.");
    expect(w.tiles[0]).toMatchObject({ id: `sour-${id}`, weekPeople: 3 });
    expect(w.channels).toHaveLength(2);
  });
});

describe("Post it again, More like this, Post this (P12)", () => {
  it("adds the post to the queue on each channel with the original image when it loads, else our full copy", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const fb = fakeBuffer({ heads: { "https://img.test/sour.jpg": 200 } });
    const r = await call(`/api/post/sour-${id}/again`, { ...json({ channels: [`ig-${id}`, `fb-${id}`] }), cookie });
    expect(await r.json()).toMatchObject({ outcome: "queued" });
    expect(fb.created).toHaveLength(2);
    expect(fb.created[0]).toMatchObject({ channelId: `ig-${id}`, text: "Sourdough is out of the oven.", mode: "addToQueue", schedulingType: "automatic", needsApproval: false, assets: [{ image: { url: "https://img.test/sour.jpg" } }] });
    expect(fb.created[0]).not.toHaveProperty("saveToDraft");
    // Buffer requires each network's metadata (found on the live account).
    expect(fb.created[0]).toMatchObject({ metadata: { instagram: { type: "post", shouldShareToFeed: true } } });
    expect(fb.created[1]).toMatchObject({ metadata: { facebook: { type: "post" } } });
    // The original no longer loads: our copy, served by the Worker at the public address.
    fb.heads["https://img.test/sour.jpg"] = 404;
    await call(`/api/post/sour-${id}/again`, { ...json({ channels: [`fb-${id}`] }), cookie });
    expect((fb.created[2] as { assets: { image: { url: string } }[] }).assets[0].image.url).toBe(`https://came-in.test/i/${id}/p-sour-${id}`);
  });

  it("on staging (BUFFER_DRAFTS) it saves drafts, so nothing is ever queued on a real channel", async () => {
    const id = await shopWithPosts();
    const fb = fakeBuffer({ heads: { "https://img.test/sour.jpg": 200 } });
    const prev = env.BUFFER_DRAFTS;
    (env as { BUFFER_DRAFTS?: string }).BUFFER_DRAFTS = "1";
    try {
      const r = await call(`/api/post/sour-${id}/again`, { ...json({ channels: [`ig-${id}`] }), cookie: await ownerCookie(id) });
      expect(await r.json()).toMatchObject({ outcome: "draft" });
      expect(fb.created[0]).toMatchObject({ saveToDraft: true });
    } finally {
      (env as { BUFFER_DRAFTS?: string }).BUFFER_DRAFTS = prev;
    }
  });

  it("an approval-required channel says so; Instagram needs a photo; a text post goes elsewhere", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    fakeBuffer({ approval: true, heads: { "https://img.test/sour.jpg": 200 } });
    expect(await (await call(`/api/post/sour-${id}/again`, { ...json({ channels: [`fb-${id}`] }), cookie })).json()).toMatchObject({ outcome: "approval" });
    const txt = (await (await call(`/api/post/hours-${id}/again`, { ...json({ channels: [`ig-${id}`] }), cookie })).json()) as { outcome: string; results: { status: string }[] };
    expect(txt.outcome).toBe("failed");
    expect(txt.results[0].status).toBe("needs_photo");
    const page = (await (await call(`/api/post/hours-${id}`, { cookie })).json()) as { channels: { service: string; needsPhoto: boolean }[] };
    expect(page.channels.find((c) => c.service === "instagram")!.needsPhoto).toBe(true);
  });

  it("a forced 429 queues the write-back, and the next tick sends it", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const fb = fakeBuffer({ status429: true, heads: { "https://img.test/sour.jpg": 200 } });
    const r = (await (await call(`/api/post/sour-${id}/again`, { ...json({ channels: [`fb-${id}`] }), cookie })).json()) as { results: { status: string }[] };
    expect(r.results[0].status).toBe("retrying");
    const job = await env.DB.prepare(`SELECT kind, done_at FROM buffer_jobs WHERE shop_id = ?1`).bind(id).first<{ kind: string; done_at: string | null }>();
    expect(job).toEqual({ kind: "post_again", done_at: null });
    // The block lifts; the next tick runs it.
    fb.status429 = false;
    await env.DB.prepare(`UPDATE buffer_rate SET blocked_until = NULL WHERE window = 'block'`).run();
    await env.DB.prepare(`UPDATE buffer_jobs SET next_at = ?2 WHERE shop_id = ?1`).bind(id, new Date(Date.now() - 1000).toISOString()).run();
    await runJobs(env, null);
    expect(fb.created.some((c) => (c as { channelId: string }).channelId === `fb-${id}`)).toBe(true);
    const done = await env.DB.prepare(`SELECT done_at, error FROM buffer_jobs WHERE shop_id = ?1`).bind(id).first<{ done_at: string | null; error: string | null }>();
    expect(done!.done_at).not.toBeNull();
    expect(done!.error).toBeNull();
  });

  it("More like this saves an Idea with the post's text, its services and an image", async () => {
    const id = await shopWithPosts();
    const fb = fakeBuffer();
    const r = await call(`/api/post/sour-${id}/idea`, { method: "POST", cookie: await ownerCookie(id) });
    expect(await r.json()).toMatchObject({ outcome: "saved" });
    expect(fb.ideas[0]).toMatchObject({ organizationId: `org-${id}`, content: { text: "Sourdough is out of the oven.", services: ["instagram"], media: [{ type: "image" }] } });
  });

  it("the sample's write-backs show as done without calling Buffer", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await call("/api/sample/post/sour/again", json({ channels: ["sample-ig"] }));
    expect(await r.json()).toMatchObject({ outcome: "queued" });
    expect(await (await call("/api/sample/post/sour/idea", { method: "POST" })).json()).toMatchObject({ outcome: "saved" });
    expect(spy.mock.calls.length).toBe(0);
  });
});

describe("the note in Buffer (P13)", () => {
  it("at the 3rd person: a note on the post, and the tile shows In Buffer; no tag is ever made or applied", async () => {
    const id = await shopWithPosts();
    const fb = fakeBuffer({ postTags: { [`p-sour-${id}`]: ["existing"] } });
    for (const d of ["a", "b", "c"]) await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: d }));
    const stub = env.SHOP_ROOM.get(env.SHOP_ROOM.idFromName(id));
    await runDurableObjectAlarm(stub);
    expect(fb.notes.filter((n) => n.postId === `p-sour-${id}`).map(({ postId, text }) => ({ postId, text }))).toEqual([{ postId: `p-sour-${id}`, text: "3 people came in because of this post. — Came In" }]);
    expect(fb.tags).toEqual([]);
    expect(fb.postTags[`p-sour-${id}`]).toEqual(["existing"]);
    expect(fb.calls.some((c) => /CameIn(Edit)?(Post)?(Create)?Tags?\b/.test(c.query))).toBe(false);
    const wall = (await (await call("/api/wall", { cookie: await ownerCookie(id) })).json()) as { tiles: { id: string; noted: boolean }[] };
    expect(wall.tiles.find((t) => t.id === `sour-${id}`)!.noted).toBe(true);
    const page = (await (await call(`/api/post/sour-${id}`, { cookie: await ownerCookie(id) })).json()) as { noteLeft: boolean };
    expect(page.noteLeft).toBe(true);
  });

  it("the tile shows nothing before the note has landed", async () => {
    const id = await shopWithPosts();
    fakeBuffer();
    for (const d of ["a", "b"]) await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: d }));
    const wall = (await (await call("/api/wall", { cookie: await ownerCookie(id) })).json()) as { tiles: { id: string; noted: boolean }[] };
    expect(wall.tiles.find((t) => t.id === `sour-${id}`)!.noted).toBe(false);
  });

  it("a tag job left over from before ends without calling Buffer", async () => {
    const id = await shopWithPosts();
    const fb = fakeBuffer();
    await env.DB.prepare(`INSERT INTO buffer_jobs (id, shop_id, kind, payload, next_at) VALUES ('old-tag', ?1, 'tag', ?2, ?3)`).bind(id, JSON.stringify({ tileId: `sour-${id}` }), new Date(Date.now() - 1000).toISOString()).run();
    await runJobs(env, id);
    expect(fb.calls).toHaveLength(0);
    const job = await env.DB.prepare(`SELECT done_at, error FROM buffer_jobs WHERE id = 'old-tag'`).first<{ done_at: string | null; error: string }>();
    expect(job).toMatchObject({ error: "tags dropped" });
    expect(job!.done_at).toBeTruthy();
  });

  it("updates the note at 10, 25, 50, 100 and every 100 after", () => {
    expect([3, 10, 25, 50, 100, 200, 300].every(isNoteStep)).toBe(true);
    expect([1, 2, 4, 9, 11, 26, 150].some(isNoteStep)).toBe(false);
    expect(noteText(10)).toBe("10 people came in because of this post. — Came In");
  });

  it("with Mark winners off, nothing is written", async () => {
    const id = await shopWithPosts({ winners: false });
    const fb = fakeBuffer();
    for (const d of ["a", "b", "c"]) await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: d }));
    await runJobs(env, id);
    expect(fb.calls).toHaveLength(0);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buffer_jobs WHERE shop_id = ?1`).bind(id).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});

describe("the share image (P14)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  it("stores the PNG in R2, serves it at the public address, and Post this uses it", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const up = await call("/api/share/square?range=this", { method: "POST", headers: { "content-type": "image/png" }, body: PNG, cookie });
    const { url } = (await up.json()) as { url: string };
    expect(url).toMatch(new RegExp(`^https://came-in.test/s/${id}/[\\w-]+-this-square-[A-Za-z0-9]{8}\\.png$`));
    const served = await call(new URL(url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    const fb = fakeBuffer();
    const r = await call("/api/week/post", { ...json({ channels: [`ig-${id}`], text: "11 of you came in because of this post this week. Thank you.", image: url }), cookie });
    expect(await r.json()).toMatchObject({ outcome: "queued" });
    expect(fb.created[0]).toMatchObject({ text: "11 of you came in because of this post this week. Thank you.", assets: [{ image: { url } }] });
  });

  it("refuses what isn't a PNG, and an image from elsewhere for Post this", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    expect((await call("/api/share/story", { method: "POST", headers: { "content-type": "image/png" }, body: "nope-not-png", cookie })).status).toBe(415);
    expect((await call("/api/week/post", { ...json({ channels: [`ig-${id}`], text: "x", image: "https://evil.test/a.png" }), cookie })).status).toBe(400);
  });
});

describe("nickname and hide from the card (P17)", () => {
  it("the bell uses the nickname, else the subject, else the first words", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    const stub = env.SHOP_ROOM.get(env.SHOP_ROOM.idFromName(id));
    const res = await stub.fetch("https://room/?device=laptop", { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket!;
    const got: { type: string; sentence?: string }[] = [];
    ws.accept();
    ws.addEventListener("message", (e) => {
      got.push(JSON.parse(e.data as string));
    });
    expect((await call(`/api/post/sour-${id}`, { ...json({ nickname: "the sourdough post" }), cookie })).status).toBe(200);
    await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "x" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(got.find((m) => m.type === "ring")!.sentence).toBe("Someone just came in because of the sourdough post.");
    await env.DB.prepare(`UPDATE tiles SET nickname = NULL, subject = 'sourdough' WHERE id = ?1`).bind(`sour-${id}`).run();
    await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "y" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(got.filter((m) => m.type === "ring")[1].sentence).toMatch(/^Someone just came in because of \w+'s sourdough post\.$/);
    ws.close();
    expect((await call(`/api/post/sour-${id}`, { ...json({ nickname: "x".repeat(25) }), cookie })).status).toBe(400);
  });

  it("a hidden tile leaves the tap page and the counter, and comes back when shown", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    await call(`/api/post/hours-${id}`, { ...json({ hidden: true }), cookie });
    expect(await (await call(`/t/${id}`)).text()).not.toContain(`hours-${id}`);
    const { url } = (await (await call("/api/counter/open", { method: "POST", cookie })).json()) as { url: string };
    expect(await (await call(url)).text()).not.toContain(`hours-${id}`);
    await call(`/api/post/hours-${id}`, { ...json({ hidden: false }), cookie });
    expect(await (await call(`/t/${id}`)).text()).toContain(`hours-${id}`);
  });

  it("the post page's counts by day and by source", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: "a" }));
    const { url } = (await (await call("/api/counter/open", { method: "POST", cookie })).json()) as { url: string };
    await call("/api/counter/tap", json({ token: url.slice(3), tile: `sour-${id}`, answer: "post", device: "tab" }));
    const p = (await (await call(`/api/post/sour-${id}`, { cookie })).json()) as { byDay: { n: number }[]; bySource: { label: string; n: number }[]; sent: string };
    expect(p.byDay.reduce((a, b) => a + b.n, 0)).toBe(2);
    expect(p.bySource).toEqual([
      { label: "From the card", n: 1 },
      { label: "At the till", n: 1 },
      { label: "Online", n: 0 },
    ]);
    expect(p.sent).toMatch(/^Sent \w+, \d+:\d\d (am|pm)$/);
  });

  it("the sample keeps its nicknames per browser", async () => {
    const first = await call("/api/sample/wall");
    const cookie = cookiesFrom(first);
    await call("/api/sample/post/sour", { ...json({ nickname: "the loaf" }), cookie });
    const w = (await (await call("/api/sample/wall", { cookie })).json()) as { tiles: { id: string; name: string }[] };
    expect(w.tiles.find((t) => t.id === "sour")!.name).toBe("the loaf");
  });
});

describe("the Monday push (P11)", () => {
  it("fires at 08:00 shop time on Monday, once, with last week's words, and opens last week", async () => {
    const id = await shopWithPosts();
    const sent: string[] = [];
    // Last week: 11 people across 2 posts, with enough answers for the full sentence.
    const lastWeek = new Date("2026-11-04T18:00:00Z");
    for (let i = 0; i < 11; i++)
      await env.DB.prepare(`INSERT INTO taps (id, shop_id, tile_id, answer, source, device_hash, rewarded, created_at) VALUES (?1, ?2, ?3, 'post', 'card', ?4, 0, ?5)`)
        .bind(`mp-${id}-${i}`, id, i % 2 ? `sour-${id}` : `hours-${id}`, `d${i}`, lastWeek.toISOString())
        .run();
    await call("/api/push/subscribe", { ...json({ device: "p", subscription: await subscription() }), cookie: await ownerCookie(id) });
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(req.url).host === "push.test") {
        bodies.push(req.url);
        return new Response(null, { status: 201 });
      }
      return new Response("no", { status: 404 });
    });
    // Sunday 8 am: nothing. Monday Nov 9, 7:45 am: nothing. 8:00 am: once. 8:15: not again.
    expect(await mondayPushes(env, new Date("2026-11-08T14:00:00Z"))).not.toContain(id);
    expect(await mondayPushes(env, new Date("2026-11-09T13:45:00Z"))).not.toContain(id);
    expect(await mondayPushes(env, new Date("2026-11-09T14:00:00Z"))).toContain(id);
    expect(await mondayPushes(env, new Date("2026-11-09T14:05:00Z"))).not.toContain(id);
    expect(bodies).toHaveLength(1);
    void sent;
  });

  it("catches up: if the 08:00 tick was missed, the first tick after it sends, once, and Tuesday does not", async () => {
    const id = await shopWithPosts();
    const lastWeek = new Date("2026-11-04T18:00:00Z");
    for (let i = 0; i < 11; i++)
      await env.DB.prepare(`INSERT INTO taps (id, shop_id, tile_id, answer, source, device_hash, rewarded, created_at) VALUES (?1, ?2, ?3, 'post', 'card', ?4, 0, ?5)`)
        .bind(`mc-${id}-${i}`, id, i % 2 ? `sour-${id}` : `hours-${id}`, `d${i}`, lastWeek.toISOString())
        .run();
    await call("/api/push/subscribe", { ...json({ device: "p2", subscription: await subscription() }), cookie: await ownerCookie(id) });
    let pushes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(req.url).host === "push.test") {
        pushes++;
        return new Response(null, { status: 201 });
      }
      return new Response("no", { status: 404 });
    });
    // 08:00 to 08:59 ticks never ran; 9:30 am Monday is the first tick.
    expect(await mondayPushes(env, new Date("2026-11-09T15:30:00Z"))).toContain(id);
    expect(await mondayPushes(env, new Date("2026-11-09T15:45:00Z"))).not.toContain(id);
    expect(await mondayPushes(env, new Date("2026-11-10T15:30:00Z"))).not.toContain(id);
    expect(pushes).toBe(1);
  });
});

async function subscription() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const auth = new Uint8Array(16);
  crypto.getRandomValues(auth);
  return { endpoint: "https://push.test/monday", keys: { p256dh: b64(raw), auth: b64(auth) } };
}


describe("per-network metadata on createPost", () => {
  it("gives each network what Buffer requires", async () => {
    const { metadataFor } = await import("../src/worker/writes");
    expect(metadataFor("instagram", "video", "t")).toEqual({ instagram: { type: "reel", shouldShareToFeed: true } });
    expect(metadataFor("googlebusiness", "image", "t")).toEqual({ google: { type: "whats_new" } });
    expect(metadataFor("youtube", "video", "A free matching game")).toEqual({ youtube: { title: "A free matching game", categoryId: "22" } });
    expect(metadataFor("instagram", "image", "t", "story")).toEqual({ instagram: { type: "story", shouldShareToFeed: true } });
    const { youtubeTitle } = await import("../src/worker/writes");
    expect(youtubeTitle("x".repeat(150), "Rye")).toHaveLength(100);
    expect(youtubeTitle("  ", "Rye & Lantern")).toBe("Rye & Lantern on Came In");
    expect(metadataFor("tiktok", "image", "t")).toEqual({ tiktok: { title: "t" } });
    expect(metadataFor("tiktok", "video", "t")).toBeNull();
  });
});


describe("Pinterest needs a board (plan 1.2)", () => {
  it("is off in the sheet and never sent", async () => {
    const id = await shopWithPosts();
    await addChannel(id, `pin-${id}`, "pinterest");
    const cookie = await ownerCookie(id);
    const page = (await (await call(`/api/post/sour-${id}`, { cookie })).json()) as { channels: { service: string; needsBoard: boolean }[] };
    expect(page.channels.find((c) => c.service === "pinterest")!.needsBoard).toBe(true);
    const fb = fakeBuffer({ heads: { "https://img.test/sour.jpg": 200 } });
    const r = (await (await call(`/api/post/sour-${id}/again`, { ...json({ channels: [`pin-${id}`] }), cookie })).json()) as { results: { status: string }[] };
    expect(r.results[0].status).toBe("needs_board");
    expect(fb.created).toHaveLength(0);
  });

  it("reuses the original post's type on its network", async () => {
    const id = await shopWithPosts();
    await env.DB.prepare(`UPDATE posts SET meta_type = 'reel' WHERE id = ?1`).bind(`p-sour-${id}`).run();
    const fb = fakeBuffer({ heads: { "https://img.test/sour.jpg": 200 } });
    await call(`/api/post/sour-${id}/again`, { ...json({ channels: [`ig-${id}`] }), cookie: await ownerCookie(id) });
    expect(fb.created[0]).toMatchObject({ metadata: { instagram: { type: "reel" } } });
  });
});

describe("check fixes on e80197b (NerdCider, The Playner's ruling)", () => {
  it("a hidden post stays on the wall and in This week, and its people still count", async () => {
    const id = await shopWithPosts();
    const cookie = await ownerCookie(id);
    for (const d of ["a", "b", "c"]) await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: d }));
    await call(`/api/post/sour-${id}`, { ...json({ hidden: true }), cookie });
    const wall = (await (await call("/api/wall", { cookie })).json()) as { tiles: { id: string; hidden: boolean }[]; countThisWeek: number };
    expect(wall.tiles.find((t) => t.id === `sour-${id}`)).toMatchObject({ hidden: true });
    expect(wall.countThisWeek).toBe(3);
    const week = (await (await call("/api/week", { cookie })).json()) as { summary: { people: number }; tiles: { id: string; hidden: boolean; weekPeople: number }[] };
    expect(week.summary.people).toBe(3);
    expect(week.tiles[0]).toMatchObject({ id: `sour-${id}`, hidden: true, weekPeople: 3 });
    expect(await (await call(`/t/${id}`)).text()).not.toContain(`sour-${id}`);
  });

  it("the sheets learn what each channel would refuse before they open", async () => {
    const id = await shopWithPosts();
    await addChannel(id, `yt-${id}`, "youtube");
    await addChannel(id, `pin-${id}`, "pinterest");
    await addChannel(id, `tt-${id}`, "tiktok");
    const cookie = await ownerCookie(id);
    fakeBuffer();
    const img = (await (await call(`/api/post/sour-${id}/targets`, { cookie })).json()) as { channels: { service: string; refusal: string | null }[] };
    const r = Object.fromEntries(img.channels.map((c) => [c.service, c.refusal]));
    expect(r).toEqual({ instagram: null, facebook: null, youtube: "video", pinterest: "board", tiktok: null });
    const text = (await (await call(`/api/post/hours-${id}/targets`, { cookie })).json()) as { channels: { service: string; refusal: string | null }[] };
    const t = Object.fromEntries(text.channels.map((c) => [c.service, c.refusal]));
    expect(t).toMatchObject({ instagram: "photo", tiktok: "photo", youtube: "video", facebook: null });
    const week = (await (await call("/api/week/targets", { cookie })).json()) as { channels: { service: string; refusal: string | null }[] };
    expect(week.channels.find((c) => c.service === "youtube")!.refusal).toBe("video");
  });

  it("a video whose source no longer loads needs the video", async () => {
    const id = await shopWithPosts();
    await addTile(id, { id: `vid-${id}`, text: "Shaping day", sentAt: ago(5), channelId: `ig-${id}` });
    await env.DB.prepare(`UPDATE posts SET kind = 'video', source_url = 'https://vid.test/gone.mp4' WHERE id = ?1`).bind(`p-vid-${id}`).run();
    fakeBuffer({ heads: { "https://vid.test/gone.mp4": 404 } });
    const r = (await (await call(`/api/post/vid-${id}/targets`, { cookie: await ownerCookie(id) })).json()) as { channels: { refusal: string | null }[] };
    expect(r.channels.every((c) => c.refusal === "video")).toBe(true);
  });

  it("the sample stores no images; no route stores one without the owner cookie", async () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect((await call("/api/sample/share/square", { method: "POST", headers: { "content-type": "image/png" }, body: PNG })).status).toBe(404);
    expect((await call("/api/share/square", { method: "POST", headers: { "content-type": "image/png" }, body: PNG })).status).toBe(401);
  });

  it("a job is claimed before it runs, so two runners can't both send it", async () => {
    const id = await shopWithPosts();
    const fb = fakeBuffer({ heads: { "https://img.test/sour.jpg": 200 } });
    const { enqueue } = await import("../src/worker/writes");
    await enqueue(env, id, "post_again", { channelId: `fb-${id}`, text: "again", assets: [] });
    await Promise.all([runJobs(env, id), runJobs(env, id)]);
    expect(fb.created).toHaveLength(1);
  });

  it("two runners making a tile's first note at once make one note", async () => {
    const id = await shopWithPosts();
    const fb = fakeBuffer();
    const { enqueue } = await import("../src/worker/writes");
    await enqueue(env, id, "note", { tileId: `sour-${id}`, people: 3 });
    await enqueue(env, id, "note", { tileId: `sour-${id}`, people: 3 });
    await Promise.all([runJobs(env, id), runJobs(env, id)]);
    await runJobs(env, id, new Date(Date.now() + 20 * 60000));
    // Count this shop's notes only: an earlier test's background job may still call the fake Buffer.
    expect(fb.notes.filter((n) => n.postId === `p-sour-${id}`)).toHaveLength(1);
  });

  it("taps that step past 3 together still tag and note", async () => {
    const id = await shopWithPosts();
    const fb = fakeBuffer();
    // Four taps land before any job runs.
    for (const d of ["a", "b", "c", "d"]) await call("/api/tap", json({ shop: id, tile: `sour-${id}`, answer: "post", source: "card", device: d }));
    await runJobs(env, id);
    expect(fb.notes.filter((n) => n.postId === `p-sour-${id}`)).toHaveLength(1);
    const { nextNoteStep } = await import("../src/worker/writes");
    expect([nextNoteStep(0), nextNoteStep(3), nextNoteStep(10), nextNoteStep(100), nextNoteStep(250)]).toEqual([3, 10, 25, 200, 300]);
  });

  it("empty Last week and This month have their own words", () => {
    expect(summarize([], tiles(), TZ, "last").headline).toBe("Nobody tapped last week.");
    expect(summarize([], tiles(), TZ, "month").headline).toBe("Nobody has tapped yet this month.");
  });
});

describe("the sample's hidden post (NerdCider, LookieBot on f9d6a5f)", () => {
  it("leaves the sample's tap page and counter for that browser, and stays for another", async () => {
    const first = await call("/api/sample/wall");
    const cookie = cookiesFrom(first);
    await call("/api/sample/post/hours", { ...json({ hidden: true }), cookie });
    expect(await (await call("/sample/t", { cookie })).text()).not.toContain('data-i="hours"');
    expect(await (await call("/sample/c", { cookie })).text()).not.toContain('data-i="hours"');
    expect(await (await call("/sample/t")).text()).toContain('data-i="hours"');
    await call("/api/sample/post/hours", { ...json({ hidden: false }), cookie });
    expect(await (await call("/sample/t", { cookie })).text()).toContain('data-i="hours"');
  });
});

describe("dead jobs (NerdCider, phase-3-tag)", () => {
  it("a note job that failed five times is dead: the next tap past the threshold queues a fresh one", async () => {
    const { enqueue, queueWinnerJobs } = await import("../src/worker/writes");
    const id = await shopWithPosts();
    fakeBuffer();
    const dead = await enqueue(env, id, "note", { tileId: `sour-${id}`, people: 3 });
    await env.DB.prepare(`UPDATE buffer_jobs SET tries = 5 WHERE id = ?1`).bind(dead).run();
    const shop = (await getShop(env, id))!;
    expect(await queueWinnerJobs(env, shop, `sour-${id}`, 3)).toBe(true);
    const live = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buffer_jobs WHERE shop_id = ?1 AND kind = 'note' AND done_at IS NULL AND tries < 5`).bind(id).first<{ n: number }>();
    expect(live!.n).toBe(1);
  });
});

describe("the stranger fixes (EaseBot, Nov 4)", () => {
  it("every post sent today says SENT TODAY (NEW on a narrow tile); only a live story is TODAY · LIVE (LIVE)", async () => {
    const { dayBadge } = await import("../src/shared/names");
    const tz = "America/Chicago";
    const now = new Date("2026-11-04T14:30:00Z");
    expect(dayBadge(new Date("2026-11-04T11:48:00Z"), now, tz, false)).toBe("SENT TODAY");
    const { dayBadgeShort } = await import("../src/shared/names");
    expect(dayBadgeShort(new Date("2026-11-04T11:48:00Z"), now, tz, false)).toBe("NEW");
    expect(dayBadgeShort(new Date("2026-11-04T14:14:00Z"), now, tz, true)).toBe("LIVE");
    expect(dayBadgeShort(new Date("2026-11-03T18:10:00Z"), now, tz, false)).toBe("TUE");
    expect(dayBadge(new Date("2026-11-04T14:14:00Z"), now, tz, true)).toBe("TODAY · LIVE");
    expect(dayBadge(new Date("2026-11-03T18:10:00Z"), now, tz, false)).toBe("TUE");
    expect(dayBadge(new Date("2026-10-27T12:55:00Z"), now, tz, false)).toBe("OCT 27");
  });

  it("the sample's wall heading and This week are one number", async () => {
    const wall = (await (await call("/api/sample/wall")).json()) as { countThisWeek: number };
    const week = (await (await call("/api/sample/week")).json()) as { summary: { people: number; posts: number }; tiles: { weekPeople: number }[] };
    expect(wall.countThisWeek).toBe(week.summary.people);
    expect(week.tiles.reduce((n, t) => n + t.weekPeople, 0)).toBe(week.summary.people);
    expect(week.tiles.filter((t) => t.weekPeople > 0).length).toBe(week.summary.posts);
  });

  it("the sample's tap page names the text-only post instead of quoting it, and its thank-you says it is a sample", async () => {
    const html = await (await call("/sample/t")).text();
    expect(html).not.toContain("Winter hours start Monday");
    expect(html).toMatch(/winter hours post/);
    expect(html).toContain("Sample thank-you. You write your own.");
  });

  it("the landing leads with the sample, explains Connect Buffer, and says EVERY WEEK", async () => {
    const html = await (await call("/")).text();
    expect(html.indexOf("Try the sample bakery")).toBeLessThan(html.indexOf('class="btn" href="/auth/start">Connect Buffer'));
    expect(html).toContain("Connect Buffer takes you to Buffer to sign in. Came In only reads your posts and channels.");
    expect(html).toContain("Every week");
    expect(html).not.toContain(">Monday<");
  });

  it("the printed card scales to fit on screen and prints at full size", async () => {
    const id = await shopWithPosts();
    const html = await (await call("/card", { cookie: await ownerCookie(id) })).text();
    expect(html).toContain("style.zoom");
    expect(html).toContain("beforeprint");
  });

  it("in print the card is exactly its page: its own size, no screen scale, no break after", async () => {
    const id = await shopWithPosts();
    for (const [size, w, h] of [["a6", "105mm", "148mm"], ["a5", "148mm", "210mm"], ["4x6", "101.6mm", "152.4mm"]] as const) {
      const html = await (await call(`/card?size=${size}`, { cookie: await ownerCookie(id) })).text();
      const print = html.slice(html.indexOf("@media print"));
      expect(print).toContain(`width:${w}!important;height:${h}!important`);
      expect(print).toContain("zoom:1!important");
      expect(print).toContain("break-after:avoid");
      expect(print).toContain("overflow:hidden!important");
    }
  });
});
