// The counter (plan 1.5, 3.6; P7): the shop's own phone or tablet, staff tap
// what brought the customer in. No cookie; the token in the URL is the key.
import type { Env } from "./env";
import { liveShop, tileById, tileText, type ShopRow } from "./db";
import { deviceHash, randomToken, uuid } from "./lib/crypto";
import { postName } from "../shared/names";
import { ringMessage } from "./taps";
import type { RingMessage, TapAnswer } from "../shared/types";

export interface CounterRow {
  token: string;
  shop_id: string;
  created_at: string;
  closed_at: string | null;
}

export async function openCounter(env: Env, shopId: string): Promise<string> {
  const token = randomToken(32);
  await env.DB.prepare(`INSERT INTO counters (token, shop_id, created_at) VALUES (?1, ?2, ?3)`).bind(token, shopId, new Date().toISOString()).run();
  return token;
}

export async function getCounter(env: Env, token: string): Promise<CounterRow | null> {
  if (!/^[A-Za-z0-9]{32}$/.test(token)) return null;
  return env.DB.prepare(`SELECT * FROM counters WHERE token = ?1`).bind(token).first<CounterRow>();
}

export async function closeCounter(env: Env, shopId: string, token: string): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE counters SET closed_at = ?3 WHERE token = ?1 AND shop_id = ?2 AND closed_at IS NULL`).bind(token, shopId, new Date().toISOString()).run();
  return (r.meta.changes ?? 0) > 0;
}

export interface CounterTapInput {
  token: string;
  tile: string | null;
  answer: TapAnswer;
  device: string;
}

export function parseCounterTap(body: unknown): CounterTapInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const token = typeof b.token === "string" ? b.token : "";
  const answer = b.answer === "post" || b.answer === "walked_past" || b.answer === "friend" || b.answer === "google" ? b.answer : null;
  const tile = typeof b.tile === "string" && b.tile ? b.tile : null;
  const device = typeof b.device === "string" ? b.device.slice(0, 64) : "";
  if (!token || !answer || !device) return null;
  if ((answer === "post") !== !!tile) return null;
  return { token, tile, answer, device };
}

export type CounterOutcome =
  | { status: 200; body: { ok: true; counted: boolean; name: string | null }; ring?: { message: RingMessage; exceptDevice: string; shop: ShopRow } }
  | { status: 400 | 404 | 409 | 410; body: { ok: false; error: string } };

/**
 * One counter tap. The counter has no per-device limit, only one tap per
 * 3 seconds (plan 1.3). No reward, no sound on this device (plan 3.6).
 */
export async function recordCounterTap(env: Env, input: CounterTapInput, now = new Date()): Promise<CounterOutcome> {
  const counter = await getCounter(env, input.token);
  if (!counter) return { status: 404, body: { ok: false, error: "no such counter" } };
  if (counter.closed_at) return { status: 409, body: { ok: false, error: "closed" } };
  const shop = await liveShop(env, counter.shop_id);
  if (!shop) return { status: 410, body: { ok: false, error: "gone" } };
  let name: string | null = null;
  let imageUrl: string | null = null;
  if (input.tile) {
    const tile = await tileById(env, shop.id, input.tile);
    if (!tile) return { status: 404, body: { ok: false, error: "no such post" } };
    const t = await tileText(env, tile.id);
    name = postName({ firstSentAt: tile.first_sent_at, nickname: tile.nickname, subject: tile.subject, text: t.text, hasImage: t.hasImage }, now, shop.timezone);
    imageUrl = t.thumbPost ? `/i/${shop.id}/${encodeURIComponent(t.thumbPost)}` : null;
  }
  const device = await deviceHash(`counter:${counter.token}`, shop.id);
  const last = await env.DB.prepare(`SELECT created_at FROM taps WHERE shop_id = ?1 AND device_hash = ?2 ORDER BY created_at DESC LIMIT 1`).bind(shop.id, device).first<{ created_at: string }>();
  if (last && now.getTime() - new Date(last.created_at).getTime() < 3000) return { status: 200, body: { ok: true, counted: false, name } };
  await env.DB.prepare(`INSERT INTO taps (id, shop_id, tile_id, answer, source, device_hash, rewarded, created_at) VALUES (?1, ?2, ?3, ?4, 'counter', ?5, 0, ?6)`)
    .bind(uuid(), shop.id, input.tile, input.answer, device, now.toISOString())
    .run();
  if (input.answer !== "post" || !input.tile || !name) return { status: 200, body: { ok: true, counted: true, name } };
  const message = await ringMessage(env, shop, input.tile, name, imageUrl, "counter", now);
  return { status: 200, body: { ok: true, counted: true, name }, ring: { message, exceptDevice: input.device, shop } };
}
