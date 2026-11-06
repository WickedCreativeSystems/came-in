// Round seven changes (plan 1.7, 3.9, 3.11): the ratio line when every counter tap names a post, the day line,
// Post it again starting only on the post's own channels, and the two-location card.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { makeShop, addChannel, addTile, call, ownerCookie, fakeBuffer } from "./helpers";
import sheetsSrc from "../src/app/ui/Sheets.tsx?raw";
import { againNote } from "../src/app/lib/lines";
import { ratioLine } from "../src/shared/week";

afterEach(() => vi.restoreAllMocks());

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
type T = { id: string; service: string; refusal: string | null; original: boolean };

describe("1.7 the ratio line when every counter tap names a post", () => {
  it("says every new customer, not 1 in 1, and still needs ten answers", () => {
    const every = "At your counter, every new customer who told us came because of a post.";
    expect(ratioLine(10, 10)).toBe(every);
    expect(ratioLine(23, 23)).toBe(every);
    expect(ratioLine(9, 9)).toBeNull();
    expect(ratioLine(12, 11)).toBe("At your counter, 11 in 12 new customers who told us came because of a post.");
  });
});

describe("3.9 Post it again starts on the post's own channels", () => {
  async function shop() {
    const id = await makeShop();
    await addChannel(id, `ig-${id}`, "instagram");
    await addChannel(id, `fb-${id}`, "facebook");
    await addChannel(id, `g-${id}`, "googlebusiness");
    await addTile(id, { id: `sour-${id}`, text: "Sourdough is out of the oven.", sentAt: ago(30), channelId: `ig-${id}`, image: true });
    await env.DB.prepare(`UPDATE posts SET source_url = ?2 WHERE id = ?1`).bind(`p-sour-${id}`, "https://img.test/sour.jpg").run();
    return id;
  }
  const targets = async (id: string) => ((await (await call(`/api/post/sour-${id}/targets`, { cookie: await ownerCookie(id) })).json()) as { channels: T[] }).channels;

  it("marks the channel the post went out on, and no other", async () => {
    const id = await shop();
    fakeBuffer({ heads: { "https://img.test/sour.jpg": 200 } });
    const by = Object.fromEntries((await targets(id)).map((c) => [c.service, c.original]));
    expect(by).toEqual({ instagram: true, facebook: false, googlebusiness: false });
  });

  it("marks every channel the same post went out on", async () => {
    const id = await shop();
    await env.DB.prepare(`INSERT INTO posts (id, shop_id, tile_id, channel_id, text, sent_at, kind, thumb_status, created_at, updated_at) SELECT 'p2-' || ?1, shop_id, tile_id, ?2, text, sent_at, kind, thumb_status, created_at, updated_at FROM posts WHERE id = ?3`).bind(id, `fb-${id}`, `p-sour-${id}`).run();
    fakeBuffer({ heads: { "https://img.test/sour.jpg": 200 } });
    const by = Object.fromEntries((await targets(id)).map((c) => [c.service, c.original]));
    expect(by).toEqual({ instagram: true, facebook: true, googlebusiness: false });
  });

  it("a channel the shop turned off in Setup is not in the list", async () => {
    const id = await shop();
    await env.DB.prepare(`UPDATE channels SET enabled = 0 WHERE id = ?1`).bind(`ig-${id}`).run();
    fakeBuffer({ heads: { "https://img.test/sour.jpg": 200 } });
    const list = await targets(id);
    expect(list.map((c) => c.service).sort()).toEqual(["facebook", "googlebusiness"]);
    expect(list.some((c) => c.original)).toBe(false);
  });

  it("the sample marks the channels each sample post went out on", async () => {
    const r = (await (await call("/api/sample/post/sour/targets")).json()) as { channels: T[] };
    expect(Object.fromEntries(r.channels.map((c) => [c.service, c.original]))).toEqual({ instagram: true, facebook: true, googlebusiness: false });
    const h = (await (await call("/api/sample/post/hours/targets")).json()) as { channels: T[] };
    expect(Object.fromEntries(h.channels.map((c) => [c.service, c.original]))).toEqual({ instagram: false, facebook: true, googlebusiness: true });
  });

  it("Post this (3.7) does not mark any channel; its toggles keep starting on", async () => {
    expect(sheetsSrc).toMatch(/function PostThisReady[\s\S]*?useState\(\(\) => new Set\(channels\.filter\(\(c\) => !blocked\(c\)\)/);
    expect(sheetsSrc).toMatch(/function PostAgainReady[\s\S]*?useState\(\(\) => new Set\(channels\.filter\(\(c\) => c\.original && !blocked\(c\)\)/);
  });
});

describe("3.9 the line when the post's own channels can't take it", () => {
  const ch = (service: string, original: boolean, refusal: string | null = null) => ({ id: service, name: service, service, original, refusal });
  it("shows nothing when an own channel can take it", () => {
    expect(againNote([ch("instagram", true), ch("facebook", false)])).toBeNull();
  });
  it("own channels refused, another could take it", () => {
    expect(againNote([ch("instagram", true, "photo"), ch("facebook", false)])).toBe("This post's own channels can't take it right now. Pick another, or check Setup.");
  });
  it("own channels gone (disconnected), another could take it", () => {
    expect(againNote([ch("facebook", false)])).toBe("This post's own channels can't take it right now. Pick another, or check Setup.");
  });
  it("no channel at all can take it", () => {
    expect(againNote([ch("instagram", true, "photo"), ch("youtube", false, "video")])).toBe("No channel can take this post right now. Check Setup.");
    expect(againNote([])).toBe("No channel can take this post right now. Check Setup.");
  });
});

describe("3.11 the two-location card", () => {
  it("name: Libre Franklin 600, 12 units, 3 under the handle; 9 units under the second line", async () => {
    const card = (await import("../src/worker/render/card.ts?raw")).default as string;
    expect(card).toMatch(/\.card \.loc\{font-family:var\(--ft\);font-size:calc\(12 \* var\(--u\)\);line-height:1\.2;font-weight:600;[^}]*margin:calc\(3 \* var\(--u\)\) 0 calc\(22 \* var\(--u\)\)\}/);
    expect(card).toContain(".card .hn.tight{margin-bottom:0}");
    expect(card).toContain(".card.two .sub{margin-bottom:calc(9 * var(--u))}");
    // The stack grows by 8.4 units, taken from the bottom padding (28 to 19.6), so the mark keeps its place under the QR.
    expect(card).toContain(".card.two{padding-bottom:calc(19.6 * var(--u))}");
    expect(card).toContain('class="card${d.locationName ? " two" : ""}"');
    // A one-location card keeps its 18 units.
    expect(card).toMatch(/\.card \.sub\{[^}]*margin:0 0 calc\(18 \* var\(--u\)\)/);
  });
});
