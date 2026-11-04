// The vision sort (plan 1.7; P20): once per photo post, with ANTHROPIC_API_KEY, the
// stored thumbnail and the post's words go to Claude Haiku, which sorts the picture
// (real photo, graphic, text image) and names what the post is about in one to three
// words. Without the key, or if the call fails, nothing is stored and the fallbacks hold.
import type { Env } from "./env";
import { enqueue } from "./writes";

export const VISION_MODEL = "claude-haiku-5-5";
const KINDS = ["real_photo", "graphic", "text_image"] as const;
export type VisionKind = (typeof KINDS)[number];
const MAX_IMAGE = 3 * 1024 * 1024;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function mediaType(bytes: Uint8Array, declared?: string): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return declared && /^image\/(jpeg|png|gif|webp)$/.test(declared) ? declared : null;
}

/** One to three plain words, lower case, no punctuation; null when the answer isn't one. */
export function cleanSubject(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const words = v.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return null;
  const s = words.join(" ");
  return s.length <= 24 ? s : null;
}

export function parseVision(text: string): { kind: VisionKind; subject: string | null } | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { kind?: unknown; subject?: unknown };
    const kind = KINDS.find((k) => k === j.kind);
    return kind ? { kind, subject: cleanSubject(j.subject) } : null;
  } catch {
    return null;
  }
}

/** Run the call for one post. "done" and "skip" end the job; "retry" tries again later. */
export async function classifyPost(env: Env, postId: string): Promise<"done" | "skip" | "retry"> {
  if (!env.ANTHROPIC_API_KEY) return "skip";
  const post = await env.DB.prepare(`SELECT id, shop_id, tile_id, text, kind_detail, thumb_key, thumb_status FROM posts WHERE id = ?1`).bind(postId).first<{
    id: string; shop_id: string; tile_id: string; text: string; kind_detail: string | null; thumb_key: string | null; thumb_status: string;
  }>();
  if (!post || post.kind_detail || post.thumb_status !== "ok" || !post.thumb_key) return "skip"; // never re-run
  const obj = await env.MEDIA.get(post.thumb_key);
  if (!obj) return "skip";
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const type = bytes.length && bytes.length <= MAX_IMAGE ? mediaType(bytes, obj.httpMetadata?.contentType) : null;
  if (!type) return "skip";
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: type, data: b64(bytes) } },
              {
                type: "text",
                text: `This is the picture from a small shop's social media post. Its words: "${post.text.slice(0, 400).replace(/"/g, "'")}"\n\nSort the picture: "real_photo" (a photo of a real thing or place or person), "graphic" (a drawn or designed graphic, logo or illustration), or "text_image" (mostly words on a background). Then name what the post is about in one to three plain lower-case words, like "sourdough" or "winter hours".\n\nAnswer with JSON only: {"kind":"real_photo|graphic|text_image","subject":"<1-3 words>"}`,
              },
            ],
          },
        ],
      }),
    });
  } catch {
    return "retry";
  }
  if (!res.ok) return res.status === 400 || res.status === 401 || res.status === 403 ? "skip" : "retry";
  const body = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[] } | null;
  const out = parseVision(body?.content?.find((c) => c.type === "text")?.text ?? "");
  if (!out) return "retry";
  await env.DB.batch([
    env.DB.prepare(`UPDATE posts SET kind_detail = ?2 WHERE id = ?1 AND kind_detail IS NULL`).bind(post.id, out.kind),
    ...(out.subject ? [env.DB.prepare(`UPDATE tiles SET subject = ?2 WHERE id = ?1 AND subject IS NULL`).bind(post.tile_id, out.subject)] : []),
  ]);
  return "done";
}

/**
 * Queue the sort for photo posts that have a stored picture and no job yet (a post is
 * tried once: a dead or finished job stops a second). A few per tick, so the first
 * sync's backlog trickles through. Returns how many were queued.
 */
export async function queueVision(env: Env, limit = 20): Promise<number> {
  if (!env.ANTHROPIC_API_KEY) return 0;
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.shop_id FROM posts p JOIN shops s ON s.id = p.shop_id
      WHERE p.kind = 'photo' AND p.thumb_status = 'ok' AND p.kind_detail IS NULL AND s.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM buffer_jobs j WHERE j.kind = 'vision' AND json_extract(j.payload, '$.postId') = p.id)
      ORDER BY p.sent_at DESC LIMIT ?1`,
  ).bind(limit).all<{ id: string; shop_id: string }>();
  for (const r of results) await enqueue(env, r.shop_id, "vision", { postId: r.id });
  return results.length;
}
