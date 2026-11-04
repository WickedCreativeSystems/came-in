// A tap (plan 1.3, 1.4, 3.5). A tap never calls Buffer.
import type { Env } from "./env";
import { liveShop, tileOnGrid, tileText, tileCount, tappedToday, postCounts, type ShopRow } from "./db";
import { deviceHash, uuid } from "./lib/crypto";
import { postName, bellSentence, whereLine } from "../shared/names";
import type { TapAnswer, TapResponse, RingMessage } from "../shared/types";

export interface TapInput {
  shop: string;
  tile: string | null;
  answer: TapAnswer;
  source: "card" | "online";
  device: string;
}

export function parseTapInput(body: unknown): TapInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const shop = typeof b.shop === "string" ? b.shop : "";
  const device = typeof b.device === "string" ? b.device.slice(0, 64) : "";
  const answer = b.answer === "post" || b.answer === "walked_past" ? b.answer : null;
  const source = b.source === "online" ? "online" : b.source === "card" ? "card" : null;
  const tile = typeof b.tile === "string" && b.tile ? b.tile : null;
  if (!/^[a-z]{10}$/.test(shop) || !device || !answer || !source) return null;
  if (answer === "post" && !tile) return null;
  if (answer !== "post" && tile) return null;
  return { shop, tile, answer, source, device };
}

export type TapOutcome = { status: 200; body: TapResponse; ring?: { message: RingMessage; exceptDevice: string } } | { status: 400 | 404 | 410; body: TapResponse };

const EMPTY: TapResponse = { ok: false, counted: false, again: false, name: null, ticket: null, reviewUrl: null };

/** Record one tap. One counted tap per device per shop per day (plan 1.3). */
export async function recordTap(env: Env, input: TapInput, now = new Date()): Promise<TapOutcome> {
  const shop = await liveShop(env, input.shop);
  if (!shop) return { status: 410, body: { ...EMPTY, error: "gone" } };
  let name: string | null = null;
  let imageUrl: string | null = null;
  if (input.tile) {
    const tile = await tileOnGrid(env, shop.id, input.tile, now);
    if (!tile) return { status: 404, body: { ...EMPTY, error: "no such post" } };
    const t = await tileText(env, tile.id);
    name = postName({ firstSentAt: tile.first_sent_at, nickname: tile.nickname, subject: tile.subject, text: t.text, hasImage: t.hasImage }, now, shop.timezone);
    imageUrl = t.thumbPost ? `/i/${shop.id}/${encodeURIComponent(t.thumbPost)}` : null;
  }
  const device = await deviceHash(input.device, shop.id);
  const reviewUrl = shop.review_url;
  if (await tappedToday(env, shop, device, now)) {
    return { status: 200, body: { ok: true, counted: false, again: true, name, ticket: null, reviewUrl } };
  }
  const rewarded = shop.thank_you_text ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO taps (id, shop_id, tile_id, answer, source, device_hash, rewarded, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(uuid(), shop.id, input.tile, input.answer, input.source, device, rewarded, now.toISOString()).run();

  const body: TapResponse = {
    ok: true,
    counted: true,
    again: false,
    name,
    ticket: shop.thank_you_text ? { text: shop.thank_you_text, at: now.toISOString() } : null,
    reviewUrl,
  };
  // "I didn't see a post" never rings the bell (plan 3.5).
  if (input.answer !== "post" || !input.tile || !name) return { status: 200, body };
  const ring = await ringMessage(env, shop, input.tile, name, imageUrl, input.source, now);
  return { status: 200, body, ring: { message: ring, exceptDevice: input.device } };
}

export async function ringMessage(env: Env, shop: ShopRow, tileId: string, name: string, imageUrl: string | null, source: "card" | "online" | "counter", now: Date): Promise<RingMessage> {
  const [count, counts] = await Promise.all([tileCount(env, tileId), postCounts(env, shop, now)]);
  return {
    type: "ring",
    tileId,
    sentence: bellSentence(name),
    where: whereLine(source),
    count,
    countToday: counts.today,
    imageUrl,
    at: now.toISOString(),
  };
}
