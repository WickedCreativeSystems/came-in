// Write-backs to Buffer (plan 1.2, 1.7; P12, P13). The owner's buttons call
// Buffer at once; a 429 goes to buffer_jobs and retries on the next tick.
// The tag and the note are always jobs, run by the shop's ShopRoom, so a
// customer's tap never waits on Buffer.
import type { Env } from "./env";
import type { ShopRow } from "./db";
import { getShop } from "./db";
import { graphql, BufferError } from "./buffer/client";
import { CREATE_POST, EDIT_POST_TAGS, POST_TAGS, TAGS, CREATE_TAG, CREATE_NOTE, UPDATE_NOTE, CREATE_IDEA, TAG_NAME, TAG_COLOR, type UnionResult } from "./buffer/mutations";
import { uuid } from "./lib/crypto";

export type JobKind = "tag" | "note" | "post_again" | "idea" | "post_share";

export interface PostTarget {
  channelId: string;
  service: string;
}

export type ChannelResult = { channelId: string; status: "queued" | "draft" | "approval" | "failed" | "needs_video" | "needs_photo" | "retrying"; message?: string };

/** The note's words (look.md section 8). */
export function noteText(people: number): string {
  return `${people} people came in because of this post. — Came In`;
}

/** The counts a note is written or updated at: 3, 10, 25, 50, 100 and every 100 after (plan 1.7). */
export function isNoteStep(n: number): boolean {
  return n === 3 || n === 10 || n === 25 || n === 50 || (n >= 100 && n % 100 === 0);
}

/**
 * Per-network metadata Buffer requires on createPost (found on the live
 * account: "Instagram posts require a type"). Instagram, Facebook and
 * Google Business need a type; YouTube a title, and only takes video;
 * TikTok a title for photo posts.
 */
export function metadataFor(service: string, kind: "image" | "video" | "none", title: string): Record<string, unknown> | null {
  const t = title.slice(0, 100);
  switch (service) {
    case "instagram":
      return { instagram: { type: kind === "video" ? "reel" : "post", shouldShareToFeed: true } };
    case "facebook":
      return { facebook: { type: kind === "video" ? "reel" : "post" } };
    case "googlebusiness":
      return { google: { type: "whats_new" } };
    case "youtube":
      return { youtube: { title: t, categoryId: "22" } };
    case "tiktok":
      return kind === "image" ? { tiktok: { title: t } } : null;
    default:
      return null;
  }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

interface TileMedia {
  text: string;
  imagePost: { id: string; source: string | null; full: boolean } | null;
  videoSource: string | null;
}

export async function tileMedia(env: Env, shopId: string, tileId: string): Promise<TileMedia | null> {
  const { results } = await env.DB.prepare(`SELECT id, text, kind, source_url, thumb_status FROM posts WHERE tile_id = ?1 AND shop_id = ?2 ORDER BY length(text) DESC`).bind(tileId, shopId).all<{ id: string; text: string; kind: string; source_url: string | null; thumb_status: string }>();
  if (!results.length) return null;
  const img = results.find((p) => p.kind === "photo");
  const vid = results.find((p) => p.kind === "video");
  let full = false;
  if (img) full = !!(await env.MEDIA.head(`full/${shopId}/${img.id}`));
  return { text: results[0].text, imagePost: img ? { id: img.id, source: img.source_url, full } : null, videoSource: vid?.source_url ?? null };
}

/**
 * Post it again, one createPost per channel (plan 1.2): the image from the
 * original source if a HEAD succeeds now, else our full-size copy; a video
 * from its source, else that channel is marked "needs the video".
 */
export async function postAgain(env: Env, shop: ShopRow, tileId: string, targets: PostTarget[], text: string | null, publicOrigin: string): Promise<ChannelResult[]> {
  const media = await tileMedia(env, shop.id, tileId);
  if (!media) return targets.map((t) => ({ channelId: t.channelId, status: "failed" }));
  let image: string | null = null;
  if (media.imagePost) {
    if (media.imagePost.source && (await headOk(media.imagePost.source))) image = media.imagePost.source;
    else image = `${publicOrigin}/i/${shop.id}/${encodeURIComponent(media.imagePost.id)}${media.imagePost.full ? "/full" : ""}`;
  }
  let video: string | null = null;
  if (!image && media.videoSource && (await headOk(media.videoSource))) video = media.videoSource;
  const assets = image ? [{ image: { url: image } }] : video ? [{ video: { url: video } }] : [];
  const out: ChannelResult[] = [];
  const kind = image ? "image" : video ? "video" : "none";
  const title = firstLineOf(text ?? media.text);
  for (const t of targets) {
    if (!image && media.videoSource && !video) {
      out.push({ channelId: t.channelId, status: "needs_video" });
      continue;
    }
    if ((t.service === "instagram" || t.service === "tiktok") && !assets.length) {
      out.push({ channelId: t.channelId, status: "needs_photo" });
      continue;
    }
    if (t.service === "youtube" && kind !== "video") {
      out.push({ channelId: t.channelId, status: "needs_video" });
      continue;
    }
    out.push(await createOne(env, shop, "post_again", { channelId: t.channelId, text: text ?? media.text, assets, tileId, metadata: metadataFor(t.service, kind, title) }));
  }
  return out;
}

/** Post this: the share image to each chosen channel (plan 3.7, P14). */
export async function postShare(env: Env, shop: ShopRow, targets: PostTarget[], text: string, imageUrl: string): Promise<ChannelResult[]> {
  const out: ChannelResult[] = [];
  for (const t of targets) {
    if (t.service === "youtube") {
      out.push({ channelId: t.channelId, status: "needs_video" });
      continue;
    }
    out.push(await createOne(env, shop, "post_share", { channelId: t.channelId, text, assets: [{ image: { url: imageUrl } }], metadata: metadataFor(t.service, "image", firstLineOf(text)) }));
  }
  return out;
}

interface CreatePayload {
  channelId: string;
  text: string;
  assets: unknown[];
  tileId?: string;
  metadata?: Record<string, unknown> | null;
}

function firstLineOf(text: string): string {
  return (text.split(/\r?\n/).find((l) => l.trim()) ?? "").trim() || "Came In";
}

async function createOne(env: Env, shop: ShopRow, kind: "post_again" | "post_share", p: CreatePayload, token?: string | null): Promise<ChannelResult> {
  const t = token ?? (await shopToken(env, shop.id));
  if (!t) return { channelId: p.channelId, status: "failed", message: "reconnect" };
  const drafts = env.BUFFER_DRAFTS === "1";
  const input: Record<string, unknown> = {
    channelId: p.channelId,
    text: p.text,
    mode: "addToQueue",
    schedulingType: "automatic",
    needsApproval: false,
    assets: p.assets,
  };
  if (p.metadata) input.metadata = p.metadata;
  if (drafts) input.saveToDraft = true;
  try {
    const { data } = await graphql<{ createPost: UnionResult & { post?: { id: string; status: string } } }>(env, t, CREATE_POST, { input });
    const r = data.createPost;
    if (r.__typename !== "PostActionSuccess" || !r.post) return { channelId: p.channelId, status: "failed", message: r.message };
    if (r.post.status === "needs_approval") return { channelId: p.channelId, status: "approval" };
    if (r.post.status === "draft") return { channelId: p.channelId, status: drafts ? "draft" : "approval" };
    return { channelId: p.channelId, status: "queued" };
  } catch (e) {
    if (e instanceof BufferError && (e.kind === "rate_limited" || e.kind === "blocked")) {
      await enqueue(env, shop.id, kind, p, (e.retryAfterSeconds ?? 900) * 1000);
      return { channelId: p.channelId, status: "retrying" };
    }
    return { channelId: p.channelId, status: "failed", message: (e as Error).message };
  }
}

/** More like this: the post as a Buffer Idea, which never publishes (plan 1.2). */
export async function moreLikeThis(env: Env, shop: ShopRow, tileId: string, services: string[], publicOrigin: string, title: string): Promise<"saved" | "retrying" | "failed"> {
  const media = await tileMedia(env, shop.id, tileId);
  if (!media) return "failed";
  const t = await shopToken(env, shop.id);
  if (!t) return "failed";
  // Video isn't accepted in ideas through the public API: the thumbnail goes as an image.
  const thumbPost = media.imagePost?.id ?? (await env.DB.prepare(`SELECT id FROM posts WHERE tile_id = ?1 AND thumb_status = 'ok' LIMIT 1`).bind(tileId).first<{ id: string }>())?.id;
  const media_ = thumbPost ? [{ url: `${publicOrigin}/i/${shop.id}/${encodeURIComponent(thumbPost)}${media.imagePost?.full ? "/full" : ""}`, type: "image" }] : [];
  const input = { organizationId: shop.buffer_org_id, content: { title, text: media.text, media: media_, services } };
  try {
    const { data } = await graphql<{ createIdea: UnionResult }>(env, t, CREATE_IDEA, { input });
    return data.createIdea.__typename === "Idea" || data.createIdea.__typename === "IdeaResponse" ? "saved" : "failed";
  } catch (e) {
    if (e instanceof BufferError && (e.kind === "rate_limited" || e.kind === "blocked")) {
      await enqueue(env, shop.id, "idea", { input }, (e.retryAfterSeconds ?? 900) * 1000);
      return "retrying";
    }
    return "failed";
  }
}

// ---- jobs ----

let tokenFor: (env: Env, shopId: string) => Promise<string | null> = async (env, shopId) => {
  const room = env.SHOP_ROOM.get(env.SHOP_ROOM.idFromName(shopId));
  return room.getToken(shopId);
};
export function setTokenSource(f: typeof tokenFor): void {
  tokenFor = f;
}
async function shopToken(env: Env, shopId: string): Promise<string | null> {
  return tokenFor(env, shopId);
}

export async function enqueue(env: Env, shopId: string, kind: JobKind, payload: unknown, delayMs = 0): Promise<string> {
  const id = uuid();
  await env.DB.prepare(`INSERT INTO buffer_jobs (id, shop_id, kind, payload, tries, next_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)`)
    .bind(id, shopId, kind, JSON.stringify(payload), new Date(Date.now() + delayMs).toISOString())
    .run();
  return id;
}

/**
 * After a counted tap: when a tile reaches 3 people, tag each of its posts
 * and leave a note; update the note at 10, 25, 50, 100 and every 100 after
 * (plan 1.7). Returns true when there is work for the ShopRoom.
 */
export async function queueWinnerJobs(env: Env, shop: ShopRow, tileId: string, people: number): Promise<boolean> {
  if (!shop.mark_winners || !isNoteStep(people)) return false;
  if (people === 3) await enqueue(env, shop.id, "tag", { tileId });
  // A note job that finds the note already at this count is a no-op, so a repeat is harmless.
  await enqueue(env, shop.id, "note", { tileId, people });
  return true;
}

const MAX_TRIES = 5;

/** Run this shop's due jobs (or every shop's, with no id). Returns how many finished. */
export async function runJobs(env: Env, shopId: string | null, now = new Date()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM buffer_jobs WHERE done_at IS NULL AND next_at <= ?1 AND tries < ?2 ${shopId ? "AND shop_id = ?3" : ""} ORDER BY next_at LIMIT 25`,
  ).bind(now.toISOString(), MAX_TRIES, ...(shopId ? [shopId] : [])).all<{ id: string; shop_id: string; kind: JobKind; payload: string; tries: number }>();
  let done = 0;
  for (const job of results) {
    const shop = await getShop(env, job.shop_id);
    if (!shop || shop.deleted_at) {
      await finish(env, job.id, "shop gone");
      continue;
    }
    try {
      const outcome = await runJob(env, shop, job.kind, JSON.parse(job.payload));
      if (outcome === "retry") await retry(env, job.id, job.tries, 15 * 60000);
      else {
        await finish(env, job.id, outcome === "done" ? null : outcome);
        done++;
      }
    } catch (e) {
      if (e instanceof BufferError && (e.kind === "rate_limited" || e.kind === "blocked")) {
        await retry(env, job.id, job.tries, (e.retryAfterSeconds ?? 900) * 1000, false);
        break; // nothing calls Buffer until the block lifts
      }
      await retry(env, job.id, job.tries, 60000 * 2 ** job.tries, true, (e as Error).message);
    }
  }
  return done;
}

async function finish(env: Env, id: string, error: string | null): Promise<void> {
  await env.DB.prepare(`UPDATE buffer_jobs SET done_at = ?2, error = ?3 WHERE id = ?1`).bind(id, new Date().toISOString(), error).run();
}

async function retry(env: Env, id: string, tries: number, delayMs: number, countTry = true, error?: string): Promise<void> {
  await env.DB.prepare(`UPDATE buffer_jobs SET tries = ?2, next_at = ?3, error = ?4 WHERE id = ?1`)
    .bind(id, countTry ? tries + 1 : tries, new Date(Date.now() + delayMs).toISOString(), error ?? null)
    .run();
}

type Outcome = "done" | "retry" | string;

async function runJob(env: Env, shop: ShopRow, kind: JobKind, p: Record<string, unknown>): Promise<Outcome> {
  const token = await shopToken(env, shop.id);
  if (!token) return "reconnect";
  switch (kind) {
    case "tag":
      return tagTile(env, shop, token, String(p.tileId));
    case "note":
      return noteTile(env, shop, token, String(p.tileId), Number(p.people));
    case "post_again":
    case "post_share": {
      const r = await createOne(env, shop, kind, p as unknown as CreatePayload, token);
      return r.status === "retrying" ? "retry" : r.status === "failed" ? r.message ?? "failed" : "done";
    }
    case "idea": {
      const { data } = await graphql<{ createIdea: UnionResult }>(env, token, CREATE_IDEA, p);
      return data.createIdea.__typename === "Idea" || data.createIdea.__typename === "IdeaResponse" ? "done" : data.createIdea.message ?? "failed";
    }
  }
}

/** The shop's "Came in" tag: found or made once; a refusal turns tagging silently off (plan 1.2). */
async function ensureTag(env: Env, shop: ShopRow, token: string): Promise<string | null> {
  if (shop.tag_state === "off") return null;
  if (shop.tag_state === "ok" && shop.tag_id) return shop.tag_id;
  const { data } = await graphql<{ tagsV2: { edges: { node: { id: string; name: string; isLocked: boolean } }[] } }>(env, token, TAGS, { organizationId: shop.buffer_org_id });
  let id = data.tagsV2.edges.map((e) => e.node).find((t) => t.name === TAG_NAME)?.id ?? null;
  if (!id) {
    const r = await graphql<{ createTag: UnionResult & { tag?: { id: string } } }>(env, token, CREATE_TAG, { input: { organizationId: shop.buffer_org_id, tag: { name: TAG_NAME, color: TAG_COLOR } } });
    id = r.data.createTag.__typename === "TagActionSuccess" ? r.data.createTag.tag?.id ?? null : null;
  }
  await env.DB.prepare(`UPDATE shops SET tag_id = ?2, tag_state = ?3 WHERE id = ?1`).bind(shop.id, id, id ? "ok" : "off").run();
  return id;
}

async function tagTile(env: Env, shop: ShopRow, token: string, tileId: string): Promise<Outcome> {
  let tag: string | null;
  try {
    tag = await ensureTag(env, shop, token);
  } catch (e) {
    if (e instanceof BufferError && e.kind === "graphql") {
      // Free plans allow 3 tags: if Buffer won't make it, tagging is silently off for this shop.
      await env.DB.prepare(`UPDATE shops SET tag_state = 'off' WHERE id = ?1`).bind(shop.id).run();
      return "tag refused";
    }
    throw e;
  }
  if (!tag) return "tagging off";
  const { results } = await env.DB.prepare(`SELECT id FROM posts WHERE tile_id = ?1 AND shop_id = ?2`).bind(tileId, shop.id).all<{ id: string }>();
  let tagged = 0;
  for (const post of results) {
    const { data } = await graphql<{ post: { tags: { id: string }[] } }>(env, token, POST_TAGS, { id: post.id });
    const existing = data.post.tags.map((t) => t.id);
    if (existing.includes(tag)) {
      tagged++;
      continue;
    }
    // Keep the post's existing tags (plan 1.2).
    const r = await graphql<{ editPost: UnionResult }>(env, token, EDIT_POST_TAGS, { input: { id: post.id, tagIds: [...existing, tag] } });
    if (r.data.editPost.__typename === "PostActionSuccess") tagged++;
  }
  if (tagged) await env.DB.prepare(`UPDATE tiles SET tagged_at = ?2 WHERE id = ?1`).bind(tileId, new Date().toISOString()).run();
  return tagged ? "done" : "not tagged";
}

async function noteTile(env: Env, shop: ShopRow, token: string, tileId: string, people: number): Promise<Outcome> {
  const tile = await env.DB.prepare(`SELECT note_id, note_count FROM tiles WHERE id = ?1 AND shop_id = ?2`).bind(tileId, shop.id).first<{ note_id: string | null; note_count: number }>();
  if (!tile) return "no tile";
  if (tile.note_count >= people) return "done";
  const text = noteText(people);
  if (tile.note_id) {
    const r = await graphql<{ updateCollaborationNote: UnionResult }>(env, token, UPDATE_NOTE, { input: { noteId: tile.note_id, text } });
    if (r.data.updateCollaborationNote.__typename !== "UpdateCollaborationNoteSuccess") return r.data.updateCollaborationNote.message ?? "note not updated";
    await env.DB.prepare(`UPDATE tiles SET note_count = ?2 WHERE id = ?1`).bind(tileId, people).run();
    return "done";
  }
  const first = await env.DB.prepare(`SELECT id FROM posts WHERE tile_id = ?1 ORDER BY sent_at LIMIT 1`).bind(tileId).first<{ id: string }>();
  if (!first) return "no post";
  const r = await graphql<{ createCollaborationNote: UnionResult & { edge?: { node: { id: string } } } }>(env, token, CREATE_NOTE, { input: { subject: { postId: first.id }, text } });
  if (r.data.createCollaborationNote.__typename !== "CreateCollaborationNoteSuccess" || !r.data.createCollaborationNote.edge) return r.data.createCollaborationNote.message ?? "note not made";
  await env.DB.prepare(`UPDATE tiles SET note_id = ?2, note_count = ?3 WHERE id = ?1`).bind(tileId, r.data.createCollaborationNote.edge.node.id, people).run();
  return "done";
}
