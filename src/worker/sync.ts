// Reading the shop's Buffer: channels, sent posts, tiles and images (plan 1.6).
import type { Env } from "./env";
import type { ShopRow } from "./db";
import { graphql } from "./buffer/client";
import { CHANNELS, SENT_POSTS, type BufferChannel, type BufferPost, type PostsPage } from "./buffer/queries";
import { textHash, uuid } from "./lib/crypto";

const IMAGE_CAP = 5 * 1024 * 1024; // 5 MB (plan 1.6)
const FETCH_TIMEOUT = 10_000;
export const PAGE_SIZE = 100;
export const FIRST_SYNC_DAYS = 60;

/** Default card channel: first Instagram, else Facebook, else Google Business, else the first (plan 3.3). */
export function defaultCardChannel(channels: { id: string; service: string }[]): string | null {
  for (const svc of ["instagram", "facebook", "googlebusiness"]) {
    const c = channels.find((x) => x.service === svc);
    if (c) return c.id;
  }
  return channels[0]?.id ?? null;
}

export async function syncChannels(env: Env, shop: ShopRow, token: string): Promise<BufferChannel[]> {
  const { data } = await graphql<{ channels: BufferChannel[] }>(env, token, CHANNELS, { organizationId: shop.buffer_org_id });
  const channels = data.channels.filter((c) => !c.isDisconnected);
  const now = new Date().toISOString();
  if (channels.length) {
    await env.DB.batch(
      channels.map((c) =>
        env.DB.prepare(
          `INSERT INTO channels (id, shop_id, name, display_name, service, avatar, external_link, timezone, enabled, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, display_name = excluded.display_name, service = excluded.service,
             avatar = excluded.avatar, external_link = excluded.external_link, timezone = excluded.timezone, updated_at = excluded.updated_at`,
        ).bind(c.id, shop.id, c.name, c.displayName, c.service, c.avatar, c.externalLink, c.timezone, now),
      ),
    );
  }
  if (!shop.card_channel_id || !channels.some((c) => c.id === shop.card_channel_id)) {
    const card = defaultCardChannel(channels);
    if (card) await setCardChannel(env, shop, card, channels);
  } else {
    // Keep the name and handle in step with Buffer.
    await setCardChannel(env, shop, shop.card_channel_id, channels);
  }
  return channels;
}

/** The card and the tap page use this channel's name and logo (plan 3.3). Handle = the channel's `name`. */
export async function setCardChannel(env: Env, shop: ShopRow, channelId: string, channels?: BufferChannel[]): Promise<void> {
  let ch: { name: string; display_name?: string | null; displayName?: string | null; avatar: string | null } | null =
    channels?.find((c) => c.id === channelId) ?? null;
  if (!ch) ch = await env.DB.prepare(`SELECT name, display_name, avatar FROM channels WHERE id = ?1 AND shop_id = ?2`).bind(channelId, shop.id).first();
  if (!ch) return;
  const displayName = ("displayName" in ch ? ch.displayName : ch.display_name) || ch.name;
  let avatarKey = shop.avatar_key;
  if (ch.avatar) {
    const key = `avatars/${shop.id}`;
    const ok = await copyImage(env, ch.avatar, key);
    avatarKey = ok ? key : null;
  }
  await env.DB.prepare(`UPDATE shops SET card_channel_id = ?2, name = ?3, handle = ?4, avatar_key = ?5 WHERE id = ?1`)
    .bind(shop.id, channelId, displayName, ch.name.replace(/^@/, ""), avatarKey)
    .run();
}

export async function enabledChannelIds(env: Env, shopId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT id FROM channels WHERE shop_id = ?1 AND enabled = 1`).bind(shopId).all<{ id: string }>();
  return results.map((r) => r.id);
}

export interface PageResult {
  upserted: number;
  newPosts: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

/** One page of sent posts since `since`, upserted with their images. */
export async function syncPostsPage(env: Env, shop: ShopRow, token: string, since: Date, cursor: string | null, first = PAGE_SIZE): Promise<PageResult> {
  const channelIds = await enabledChannelIds(env, shop.id);
  if (!channelIds.length) return { upserted: 0, newPosts: 0, hasNextPage: false, endCursor: null };
  const { data } = await graphql<PostsPage>(env, token, SENT_POSTS, {
    organizationId: shop.buffer_org_id,
    channelIds,
    since: since.toISOString(),
    after: cursor,
    first,
  });
  let newPosts = 0;
  const posts = data.posts.edges.map((e) => e.node);
  for (const post of posts) {
    if (await upsertPost(env, shop, post)) newPosts++;
  }
  // Images after the rows, so a slow image never blocks the wall.
  await Promise.all(posts.map((p) => fetchImages(env, shop, p).catch(() => undefined)));
  return { upserted: posts.length, newPosts, hasNextPage: data.posts.pageInfo.hasNextPage, endCursor: data.posts.pageInfo.endCursor };
}

export function postKind(post: Pick<BufferPost, "assets" | "text">): "photo" | "video" | "text" | "link" {
  if (post.assets?.some((a) => a.type === "image" || a.__typename === "ImageAsset")) return "photo";
  if (post.assets?.some((a) => a.type === "video" || a.__typename === "VideoAsset")) return "video";
  if (/https?:\/\/\S+/.test(post.text ?? "")) return "link";
  return "text";
}

export function isStory(post: Pick<BufferPost, "metadata">): boolean {
  return post.metadata?.type === "story";
}

/** Insert or update one post and give it a tile. Returns true if the post is new. */
export async function upsertPost(env: Env, shop: ShopRow, post: BufferPost): Promise<boolean> {
  const sentAt = post.sentAt ?? post.dueAt;
  if (!sentAt) return false;
  const now = new Date().toISOString();
  const kind = postKind(post);
  const story = isStory(post) ? 1 : 0;
  const imageAsset = post.assets?.find((a) => a.type === "image" || a.__typename === "ImageAsset");
  const anyAsset = imageAsset ?? post.assets?.[0];
  const sourceUrl = anyAsset?.source ?? null;

  const existing = await env.DB.prepare(`SELECT tile_id FROM posts WHERE id = ?1`).bind(post.id).first<{ tile_id: string }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE posts SET text = ?2, sent_at = ?3, external_link = ?4, is_story = ?5, kind = ?6, source_url = ?7, channel_id = ?8, updated_at = ?9 WHERE id = ?1`,
    ).bind(post.id, post.text ?? "", sentAt, post.externalLink, story, kind, sourceUrl, post.channelId, now).run();
    return false;
  }
  const tileId = await findOrMakeTile(env, shop, post.text ?? "", sentAt);
  await env.DB.prepare(
    `INSERT INTO posts (id, shop_id, tile_id, channel_id, text, sent_at, external_link, is_story, kind, thumb_status, source_url, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
  ).bind(post.id, shop.id, tileId, post.channelId, post.text ?? "", sentAt, post.externalLink, story, kind, anyAsset ? "pending" : "missing", sourceUrl, now).run();
  return true;
}

/**
 * One tile per post across channels (plan 1.3): same text_hash and
 * first_sent_at within 2 hours, else a new tile. Image-only posts with empty
 * text never merge.
 */
export async function findOrMakeTile(env: Env, shop: ShopRow, text: string, sentAt: string): Promise<string> {
  const hasText = text.replace(/https?:\/\/\S+/gi, "").trim().length > 0;
  const hash = hasText ? await textHash(text) : `empty:${uuid()}`;
  if (hasText) {
    const t = new Date(sentAt).getTime();
    const lo = new Date(t - 2 * 3600000).toISOString();
    const hi = new Date(t + 2 * 3600000).toISOString();
    const match = await env.DB.prepare(
      `SELECT id, first_sent_at FROM tiles WHERE shop_id = ?1 AND text_hash = ?2 AND first_sent_at BETWEEN ?3 AND ?4 ORDER BY first_sent_at LIMIT 1`,
    ).bind(shop.id, hash, lo, hi).first<{ id: string; first_sent_at: string }>();
    if (match) {
      if (sentAt < match.first_sent_at) await env.DB.prepare(`UPDATE tiles SET first_sent_at = ?2 WHERE id = ?1`).bind(match.id, sentAt).run();
      return match.id;
    }
  }
  const id = uuid();
  await env.DB.prepare(`INSERT INTO tiles (id, shop_id, text_hash, first_sent_at) VALUES (?1, ?2, ?3, ?4)`).bind(id, shop.id, hash, sentAt).run();
  return id;
}

/** Copy an image URL into R2. False when it fails, is too big or is not an image. */
export async function copyImage(env: Env, url: string, key: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "image/*" } });
    if (!res.ok || !res.body) return false;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return false;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > IMAGE_CAP) return false;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > IMAGE_CAP || buf.byteLength === 0) return false;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Thumbnail for the tile; the full image too, for a re-post (plan 1.6). */
export async function fetchImages(env: Env, shop: ShopRow, post: BufferPost): Promise<void> {
  const row = await env.DB.prepare(`SELECT thumb_status FROM posts WHERE id = ?1`).bind(post.id).first<{ thumb_status: string }>();
  if (!row || row.thumb_status === "ok") return;
  const asset = post.assets?.find((a) => a.type === "image" || a.__typename === "ImageAsset") ?? post.assets?.find((a) => a.type === "video" || a.__typename === "VideoAsset");
  if (!asset) {
    await env.DB.prepare(`UPDATE posts SET thumb_status = 'missing' WHERE id = ?1`).bind(post.id).run();
    return;
  }
  const thumbKey = `thumbs/${shop.id}/${post.id}`;
  const isImage = asset.type === "image" || asset.__typename === "ImageAsset";
  let ok = asset.thumbnail ? await copyImage(env, asset.thumbnail, thumbKey) : false;
  if (!ok && isImage && asset.source) ok = await copyImage(env, asset.source, thumbKey);
  if (ok && isImage && asset.source) await copyImage(env, asset.source, `full/${shop.id}/${post.id}`);
  await env.DB.prepare(`UPDATE posts SET thumb_status = ?2, thumb_key = ?3 WHERE id = ?1`).bind(post.id, ok ? "ok" : "missing", ok ? thumbKey : null).run();
}

/** Daily: try missing images again for posts under 3 days old (plan 1.6). */
export async function retryMissingImages(env: Env, token: (shopId: string) => Promise<string | null>): Promise<number> {
  // The asset URLs are on the post; re-reading one post from Buffer per retry
  // would spend rate. Instead retry from the stored source URL.
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, shop_id, source_url FROM posts WHERE thumb_status = 'missing' AND source_url IS NOT NULL AND created_at >= ?1 LIMIT 50`,
  ).bind(since).all<{ id: string; shop_id: string; source_url: string }>();
  let fixed = 0;
  for (const r of results) {
    const key = `thumbs/${r.shop_id}/${r.id}`;
    if (await copyImage(env, r.source_url, key)) {
      await env.DB.prepare(`UPDATE posts SET thumb_status = 'ok', thumb_key = ?2 WHERE id = ?1`).bind(r.id, key).run();
      fixed++;
    }
  }
  void token;
  return fixed;
}
