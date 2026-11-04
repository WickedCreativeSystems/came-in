// P2: channels and first sync. P3: the wall's data. Plan 1.3 tile rule, 1.6 images and polling.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { getShop, wallTiles } from "../src/worker/db";
import { syncChannels, syncPostsPage, defaultCardChannel, postKind } from "../src/worker/sync";
import { pollIsDue, pollShop } from "../src/worker/poll";
import { makeShop, addChannel, fakeBuffer, post, call, ownerCookie, PNG } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();

describe("channels (plan 3.3)", () => {
  it("the card defaults to Instagram, else Facebook, else Google Business, else the first", () => {
    expect(defaultCardChannel([{ id: "a", service: "tiktok" }, { id: "b", service: "facebook" }, { id: "c", service: "instagram" }])).toBe("c");
    expect(defaultCardChannel([{ id: "a", service: "tiktok" }, { id: "b", service: "facebook" }])).toBe("b");
    expect(defaultCardChannel([{ id: "a", service: "tiktok" }, { id: "g", service: "googlebusiness" }])).toBe("g");
    expect(defaultCardChannel([{ id: "a", service: "tiktok" }])).toBe("a");
  });
  it("reads channels, picks the card channel and takes its name, handle and logo", async () => {
    const id = await makeShop();
    fakeBuffer({
      channels: [
        { id: "ch-yt", name: "ryeyt", displayName: "Rye YT", service: "youtube", type: "channel", avatar: null, externalLink: null, timezone: null, isDisconnected: false },
        { id: "ch-ig", name: "ryeandlantern", displayName: "Rye & Lantern", service: "instagram", type: "business", avatar: "https://img.test/av.png", externalLink: null, timezone: null, isDisconnected: false },
        { id: "ch-gone", name: "old", displayName: null, service: "facebook", type: "page", avatar: null, externalLink: null, timezone: null, isDisconnected: true },
      ],
      images: { "https://img.test/av.png": { type: "image/png", body: PNG } },
    });
    await syncChannels(env, (await getShop(env, id))!, "tok");
    const shop = (await getShop(env, id))!;
    expect(shop.card_channel_id).toBe("ch-ig");
    expect(shop.name).toBe("Rye & Lantern");
    expect(shop.handle).toBe("ryeandlantern");
    expect(shop.avatar_key).toBe(`avatars/${id}`);
    expect(await env.MEDIA.get(`avatars/${id}`)).not.toBeNull();
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM channels WHERE shop_id = ?1`).bind(id).first<{ n: number }>();
    expect(n!.n).toBe(2); // the disconnected channel is left out
  });
});

describe("first sync (P2)", () => {
  it("stores enabled channels' sent posts, merges tiles by the 1.3 rule, copies thumbnails or marks them missing", async () => {
    const id = await makeShop();
    await addChannel(id, "ig", "instagram");
    await addChannel(id, "fb", "facebook");
    await addChannel(id, "off", "tiktok", 0);
    fakeBuffer({
      posts: [
        post({ id: "1", channelId: "ig", text: "Sourdough is out of the oven. https://rye.test", sentAt: ago(30), assets: [{ __typename: "ImageAsset", id: "a1", mimeType: "image/jpeg", type: "image", source: "https://img.test/full1.jpg", thumbnail: "https://img.test/thumb1.jpg" }] }),
        // Same words on Facebook, 40 minutes later, URL differs and spacing differs: one tile.
        post({ id: "2", channelId: "fb", channelService: "facebook", text: "sourdough  is out of the OVEN. https://other.test", sentAt: ago(29.3), metadata: { __typename: "FacebookPostMetadata", type: "post" } }),
        // Same words three days later: a new tile.
        post({ id: "3", channelId: "ig", text: "Sourdough is out of the oven.", sentAt: ago(5) }),
        // Two image-only posts with empty text never merge.
        post({ id: "4", channelId: "ig", text: "", sentAt: ago(10), assets: [{ __typename: "ImageAsset", id: "a4", mimeType: "image/jpeg", type: "image", source: "https://img.test/broken.jpg", thumbnail: "https://img.test/broken.jpg" }] }),
        post({ id: "5", channelId: "fb", channelService: "facebook", text: "", sentAt: ago(10) }),
        // A story.
        post({ id: "6", channelId: "ig", text: "Fudge today", sentAt: ago(2), metadata: { __typename: "InstagramPostMetadata", type: "story" } }),
        // A disabled channel's post is never read.
        post({ id: "7", channelId: "off", text: "tiktok", sentAt: ago(1) }),
        // Older than 60 days: not read.
        post({ id: "8", channelId: "ig", text: "old", sentAt: ago(61 * 24) }),
      ],
      images: { "https://img.test/thumb1.jpg": { type: "image/jpeg", body: PNG }, "https://img.test/full1.jpg": { type: "image/jpeg", body: PNG }, "https://img.test/broken.jpg": 404 },
    });
    const shop = (await getShop(env, id))!;
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await syncPostsPage(env, shop, "tok", new Date(Date.now() - 60 * 86400000), cursor, 3);
      cursor = r.hasNextPage ? r.endCursor : null;
      pages++;
    } while (cursor);
    expect(pages).toBe(2);
    const posts = await env.DB.prepare(`SELECT id, tile_id, thumb_status, is_story, kind FROM posts WHERE shop_id = ?1 ORDER BY id`).bind(id).all<{ id: string; tile_id: string; thumb_status: string; is_story: number; kind: string }>();
    const byId = Object.fromEntries(posts.results.map((p) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(byId["1"].tile_id).toBe(byId["2"].tile_id);
    expect(byId["3"].tile_id).not.toBe(byId["1"].tile_id);
    expect(byId["4"].tile_id).not.toBe(byId["5"].tile_id);
    expect(byId["1"].thumb_status).toBe("ok");
    expect(byId["4"].thumb_status).toBe("missing");
    expect(byId["6"].is_story).toBe(1);
    expect(byId["1"].kind).toBe("photo");
    expect(await env.MEDIA.get(`thumbs/${id}/1`)).not.toBeNull();
    expect(await env.MEDIA.get(`full/${id}/1`)).not.toBeNull();

    // The wall: newest first, the merged tile carries both channels' marks, the story is live.
    const tiles = await wallTiles(env, shop);
    expect(tiles).toHaveLength(5);
    expect(tiles[0].isLive).toBe(true);
    const merged = tiles.find((t) => t.id === byId["1"].tile_id)!;
    expect(merged.services.sort()).toEqual(["facebook", "instagram"]);
    expect(merged.imageUrl).toBe(`/i/${id}/1`);
    expect(merged.count).toBe(0);
  });

  it("runs page by page on the ShopRoom's alarms and tells the first-run screen", async () => {
    const id = await makeShop();
    fakeBuffer({
      channels: [{ id: `c-${id}`, name: "h", displayName: "H", service: "instagram", type: "business", avatar: null, externalLink: null, timezone: null, isDisconnected: false }],
      posts: Array.from({ length: 150 }, (_, i) => post({ id: `${id}-${i}`, channelId: `c-${id}`, text: `post ${i}`, sentAt: ago(i + 1) })),
    });
    const stub = env.SHOP_ROOM.get(env.SHOP_ROOM.idFromName(id));
    await stub.startSync(id);
    for (let i = 0; i < 10 && (await stub.syncStatus()).running; i++) await runDurableObjectAlarm(stub);
    expect((await stub.syncStatus()).running).toBe(false);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM posts WHERE shop_id = ?1`).bind(id).first<{ n: number }>();
    expect(n!.n).toBe(150);
    const s = await getShop(env, id);
    expect(s!.last_polled_at).not.toBeNull();
  });

  it("a shop with no sent posts shows the empty wall", async () => {
    const id = await makeShop();
    await addChannel(id, `e-${id}`, "instagram");
    const res = await call("/api/wall", { cookie: await ownerCookie(id) });
    const data = (await res.json()) as { tiles: unknown[] };
    expect(data.tiles).toEqual([]);
  });

  it("post kinds", () => {
    expect(postKind({ text: "hi", assets: [] })).toBe("text");
    expect(postKind({ text: "see https://x.test", assets: [] })).toBe("link");
    expect(postKind({ text: "", assets: [{ __typename: "VideoAsset", type: "video" } as never] })).toBe("video");
  });
});

describe("polling (plan 1.2, 1.6)", () => {
  const tz = "America/Chicago";
  const noon = new Date("2026-11-05T18:00:00Z"); // noon in Chicago
  const night = new Date("2026-11-05T09:00:00Z"); // 3 am
  const awake = new Date(noon.getTime() + 3600000).toISOString();
  it("every 15 minutes while awake in opening hours", () => {
    expect(pollIsDue({ awake_until: awake, last_polled_at: new Date(noon.getTime() - 15 * 60000).toISOString(), polls_quiet: 0, timezone: tz }, noon)).toBe(true);
    expect(pollIsDue({ awake_until: awake, last_polled_at: new Date(noon.getTime() - 5 * 60000).toISOString(), polls_quiet: 0, timezone: tz }, noon)).toBe(false);
  });
  it("every 30 minutes after two quiet polls", () => {
    expect(pollIsDue({ awake_until: awake, last_polled_at: new Date(noon.getTime() - 15 * 60000).toISOString(), polls_quiet: 2, timezone: tz }, noon)).toBe(false);
    expect(pollIsDue({ awake_until: awake, last_polled_at: new Date(noon.getTime() - 30 * 60000).toISOString(), polls_quiet: 2, timezone: tz }, noon)).toBe(true);
  });
  it("hourly otherwise: asleep, or outside 06:00 to 22:00", () => {
    expect(pollIsDue({ awake_until: null, last_polled_at: new Date(noon.getTime() - 30 * 60000).toISOString(), polls_quiet: 0, timezone: tz }, noon)).toBe(false);
    expect(pollIsDue({ awake_until: awake, last_polled_at: new Date(night.getTime() - 30 * 60000).toISOString(), polls_quiet: 0, timezone: tz }, night)).toBe(false);
    expect(pollIsDue({ awake_until: null, last_polled_at: new Date(noon.getTime() - 61 * 60000).toISOString(), polls_quiet: 0, timezone: tz }, noon)).toBe(true);
  });
  it("a poll reads posts since last_polled_at − 48 h and counts quiet polls", async () => {
    const id = await makeShop();
    await env.DB.prepare(`UPDATE shops SET last_polled_at = ?2 WHERE id = ?1`).bind(id, ago(1)).run();
    await addChannel(id, `pc-${id}`, "instagram");
    const fb = fakeBuffer({ posts: [post({ id: `pp-${id}`, channelId: `pc-${id}`, text: "new", sentAt: ago(0.5) })] });
    const deps = { token: async () => "tok", notify: async () => {}, syncRunning: async () => false };
    expect(await pollShop(env, (await getShop(env, id))!, deps)).toBe(1);
    const since = new Date(String(fb.calls.at(-1)!.variables.since)).getTime();
    expect(Math.abs(since - (Date.now() - 49 * 3600000))).toBeLessThan(60000);
    expect(await pollShop(env, (await getShop(env, id))!, deps)).toBe(0);
    expect((await getShop(env, id))!.polls_quiet).toBe(1);
  });
  it("Refresh runs once per 60 s per shop", async () => {
    const id = await makeShop();
    await addChannel(id, `rc-${id}`, "instagram");
    fakeBuffer();
    const cookie = await ownerCookie(id);
    const a = (await (await call("/api/refresh", { method: "POST", cookie })).json()) as { waited: boolean };
    expect(a.waited).toBe(false);
    const b = (await (await call("/api/refresh", { method: "POST", cookie })).json()) as { waited: boolean };
    expect(b.waited).toBe(true);
  });
});
