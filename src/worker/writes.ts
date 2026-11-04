// Write-backs to Buffer (plan 1.2, 1.7; P12, P13). The owner's buttons call
// Buffer at once; a 429 goes to buffer_jobs and retries on the next tick.
// The note is always a job, run by the shop's ShopRoom, so a
// customer's tap never waits on Buffer.
import type { Env } from "./env";
import type { ShopRow } from "./db";
import { getShop } from "./db";
import { graphql, BufferError } from "./buffer/client";
import { CREATE_POST, CREATE_NOTE, UPDATE_NOTE, CREATE_IDEA, type UnionResult } from "./buffer/mutations";
import { uuid } from "./lib/crypto";

export type JobKind = "note" | "post_again" | "idea" | "post_share";

export interface PostTarget {
  channelId: string;
  service: string;
}

export type ChannelResult = { channelId: string; status: "queued" | "draft" | "approval" | "failed" | "needs_video" | "needs_photo" | "needs_board" | "retrying"; message?: string };

/** The note's words (look.md section 8). */
export function noteText(people: number): string {
  return `${people} people came in because of this post. — Came In`;
}

/** The counts a note is written or updated at: 3, 10, 25, 50, 100 and every 100 after (plan 1.7). */
export function nextNoteStep(written: number): number {
  for (const s of [3, 10, 25, 50, 100]) if (written < s) return s;
  return (Math.floor(written / 100) + 1) * 100;
}

export function isNoteStep(n: number): boolean {
  return n === 3 || n === 10 || n === 25 || n === 50 || (n >= 100 && n % 100 === 0);
}

/**
 * Per-network metadata Buffer requires on createPost (found on the live
 * account: "Instagram posts require a type"). Instagram, Facebook and
 * Google Business need a type; YouTube a title, and only takes video;
 * TikTok a title for photo posts.
 */
export function metadataFor(service: string, kind: "image" | "video" | "none", title: string, original?: string | null): Record<string, unknown> | null {
  const t = title.slice(0, 100);
  switch (service) {
    case "instagram":
      return { instagram: { type: original && ["post", "reel", "story"].includes(original) ? original : kind === "video" ? "reel" : "post", shouldShareToFeed: true } };
    case "facebook":
      return { facebook: { type: original && ["post", "reel", "story"].includes(original) ? original : kind === "video" ? "reel" : "post" } };
    case "googlebusiness":
      return { google: { type: original && ["whats_new", "offer", "event"].includes(original) ? original : "whats_new" } };
    case "youtube":
      return { youtube: { title: t, categoryId: "22" } };
    case "tiktok":
      return kind === "image" ? { tiktok: { title: t } } : null;
    default:
      return null;
  }
}

export type Refusal = "photo" | "video" | "board" | null;

/** What a channel would refuse, known before the press (plan 3.9). */
export function refusalFor(service: string, media: "image" | "video" | "none", videoGone = false): Refusal {
  if (service === "pinterest") return "board";
  if (media === "video" && videoGone) return "video";
  if (service === "youtube" && media !== "video") return "video";
  if ((service === "instagram" || service === "tiktok") && media === "none") return "photo";
  return null;
}

/** Post it again's channels with their reasons; a video's source is checked now. */
export async function againTargets(env: Env, shopId: string, tileId: string, channels: { id: string; name: string; service: string }[]): Promise<{ id: string; name: string; service: string; refusal: Refusal }[] | null> {
  const media = await tileMedia(env, shopId, tileId);
  if (!media) return null;
  const kind = media.imagePost ? "image" : media.videoSource ? "video" : "none";
  const videoGone = kind === "video" && !(await headOk(media.videoSource!));
  return channels.map((c) => ({ ...c, refusal: refusalFor(c.service, kind, videoGone) }));
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
  types: Record<string, string>;
  text: string;
  imagePost: { id: string; source: string | null; full: boolean } | null;
  videoSource: string | null;
}

export async function tileMedia(env: Env, shopId: string, tileId: string): Promise<TileMedia | null> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.text, p.kind, p.source_url, p.thumb_status, p.meta_type, c.service FROM posts p LEFT JOIN channels c ON c.id = p.channel_id WHERE p.tile_id = ?1 AND p.shop_id = ?2 ORDER BY length(p.text) DESC`,
  ).bind(tileId, shopId).all<{ id: string; text: string; kind: string; source_url: string | null; thumb_status: string; meta_type: string | null; service: string | null }>();
  if (!results.length) return null;
  const img = results.find((p) => p.kind === "photo");
  const vid = results.find((p) => p.kind === "video");
  let full = false;
  if (img) full = !!(await env.MEDIA.head(`full/${shopId}/${img.id}`));
  const types: Record<string, string> = {};
  for (const p of results) if (p.service && p.meta_type && !types[p.service]) types[p.service] = p.meta_type;
  return { text: results[0].text, imagePost: img ? { id: img.id, source: img.source_url, full } : null, videoSource: vid?.source_url ?? null, types };
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
  const title = youtubeTitle(text ?? media.text, shop.name);
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
    if (t.service === "pinterest") {
      out.push({ channelId: t.channelId, status: "needs_board" });
      continue;
    }
    out.push(await createOne(env, shop, "post_again", { channelId: t.channelId, text: text ?? media.text, assets, tileId, metadata: metadataFor(t.service, kind, title, media.types[t.service]) }));
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
    if (t.service === "pinterest") {
      out.push({ channelId: t.channelId, status: "needs_board" });
      continue;
    }
    out.push(await createOne(env, shop, "post_share", { channelId: t.channelId, text, assets: [{ image: { url: imageUrl } }], metadata: metadataFor(t.service, "image", youtubeTitle(text, shop.name)) }));
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

/** YouTube's title: the first 100 characters of the text, or "<shop name> on Came In" (plan 1.2). */
export function youtubeTitle(text: string, shopName: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 100) : `${shopName} on Came In`;
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
 * After a counted tap: when a tile reaches 3 people, leave a note on its post
 * (Came In never tags: Buffer refuses it on sent posts); update the note at 10, 25, 50, 100 and every 100 after
 * (plan 1.7). Returns true when there is work for the ShopRoom.
 */
export async function queueWinnerJobs(env: Env, shop: ShopRow, tileId: string, people: number): Promise<boolean> {
  if (!shop.mark_winners || people < 3) return false;
  const tile = await env.DB.prepare(`SELECT note_count FROM tiles WHERE id = ?1 AND shop_id = ?2`).bind(tileId, shop.id).first<{ note_count: number }>();
  if (!tile) return false;
  // A job that gave up (MAX_TRIES) is dead: it doesn't count, so it never blocks a fresh one.
  const pending = await env.DB.prepare(
    `SELECT MAX(CAST(json_extract(payload, '$.people') AS INTEGER)) AS people FROM buffer_jobs WHERE shop_id = ?1 AND done_at IS NULL AND tries < ?3 AND kind = 'note' AND json_extract(payload, '$.tileId') = ?2`,
  ).bind(shop.id, tileId, MAX_TRIES).first<{ people: number | null }>();
  // Taps that land together can step past a threshold; compare with the step above what's written.
  if (people < nextNoteStep(Math.max(tile.note_count, pending?.people ?? 0))) return false;
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
    // Claim the job first, so an alarm and a cron tick can't both run it.
    const claim = await env.DB.prepare(`UPDATE buffer_jobs SET next_at = ?2 WHERE id = ?1 AND done_at IS NULL AND next_at <= ?3`)
      .bind(job.id, new Date(now.getTime() + 10 * 60000).toISOString(), now.toISOString())
      .run();
    if (!claim.meta.changes) continue;
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
  // Mark winners switched off after the job was queued: nothing is written.
  // Tags were dropped (Buffer refuses them on sent posts); a leftover tag job just ends.
  if ((kind as string) === "tag") return "tags dropped";
  if (kind === "note" && !shop.mark_winners) return "mark winners off";
  const token = await shopToken(env, shop.id);
  if (!token) return "reconnect";
  switch (kind) {
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

async function noteTile(env: Env, shop: ShopRow, token: string, tileId: string, people: number): Promise<Outcome> {
  const tile = await env.DB.prepare(`SELECT note_id, note_count FROM tiles WHERE id = ?1 AND shop_id = ?2`).bind(tileId, shop.id).first<{ note_id: string | null; note_count: number }>();
  if (!tile) return "no tile";
  if (tile.note_count >= people) return "done";
  const text = noteText(people);
  // Another runner is making this tile's first note right now: try again on the next tick.
  if (tile.note_id === "making") return "retry";
  if (tile.note_id) {
    const r = await graphql<{ updateCollaborationNote: UnionResult }>(env, token, UPDATE_NOTE, { input: { noteId: tile.note_id, text } });
    if (r.data.updateCollaborationNote.__typename !== "UpdateCollaborationNoteSuccess") return r.data.updateCollaborationNote.message ?? "note not updated";
    await env.DB.prepare(`UPDATE tiles SET note_count = ?2 WHERE id = ?1`).bind(tileId, people).run();
    return "done";
  }
  const first = await env.DB.prepare(`SELECT id FROM posts WHERE tile_id = ?1 ORDER BY sent_at LIMIT 1`).bind(tileId).first<{ id: string }>();
  if (!first) return "no post";
  // One note per tile, however runners overlap: claim the tile's note before making it.
  const claim = await env.DB.prepare(`UPDATE tiles SET note_id = 'making' WHERE id = ?1 AND note_id IS NULL`).bind(tileId).run();
  if (!claim.meta.changes) return "retry";
  let r: { data: { createCollaborationNote: UnionResult & { edge?: { node: { id: string } } } } };
  try {
    r = await graphql(env, token, CREATE_NOTE, { input: { subject: { postId: first.id }, text } });
  } catch (e) {
    await env.DB.prepare(`UPDATE tiles SET note_id = NULL WHERE id = ?1 AND note_id = 'making'`).bind(tileId).run();
    throw e;
  }
  if (r.data.createCollaborationNote.__typename !== "CreateCollaborationNoteSuccess" || !r.data.createCollaborationNote.edge) {
    await env.DB.prepare(`UPDATE tiles SET note_id = NULL WHERE id = ?1 AND note_id = 'making'`).bind(tileId).run();
    return r.data.createCollaborationNote.message ?? "note not made";
  }
  await env.DB.prepare(`UPDATE tiles SET note_id = ?2, note_count = ?3 WHERE id = ?1`).bind(tileId, r.data.createCollaborationNote.edge.node.id, people).run();
  return "done";
}
