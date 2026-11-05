// The counter (plan 1.5, 3.6; P7): the shop's own phone or tablet, staff tap
// what brought the customer in. No cookie; the token in the URL is the key.
import type { Env } from "./env";
import { liveShop, tileOnGrid, tileText, type ShopRow } from "./db";
import { deviceHash, randomToken, uuid } from "./lib/crypto";
import { postName } from "../shared/names";
import { ringMessage } from "./taps";
import type { RingMessage, TapAnswer, UndoMessage } from "../shared/types";

export interface CounterRow {
  token: string;
  shop_id: string;
  location_id: string | null;
  created_at: string;
  closed_at: string | null;
}

export async function openCounter(env: Env, shopId: string, locationId: string): Promise<string> {
  const token = randomToken(32);
  await env.DB.prepare(`INSERT INTO counters (token, shop_id, location_id, created_at) VALUES (?1, ?2, ?3, ?4)`).bind(token, shopId, locationId, new Date().toISOString()).run();
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
  | { status: 200; body: { ok: true; counted: boolean; name: string | null; id?: string }; ring?: { message: RingMessage; exceptDevice: string; shop: ShopRow } }
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
    const tile = await tileOnGrid(env, shop.id, input.tile, now);
    if (!tile) return { status: 404, body: { ok: false, error: "no such post" } };
    const t = await tileText(env, tile.id);
    name = postName({ firstSentAt: tile.first_sent_at, nickname: tile.nickname, subject: tile.subject, text: t.text, hasImage: t.hasImage }, now, shop.timezone);
    imageUrl = t.thumbPost ? `/i/${shop.id}/${encodeURIComponent(t.thumbPost)}` : null;
  }
  const device = await deviceHash(`counter:${counter.token}`, shop.id);
  // One statement, so two taps at the same instant can't both pass the 3-second rule.
  const since = new Date(now.getTime() - 3000).toISOString();
  const tapId = uuid();
  const ins = await env.DB.prepare(
    `INSERT INTO taps (id, shop_id, location_id, tile_id, answer, source, device_hash, rewarded, created_at)
     SELECT ?1, ?2, ?8, ?3, ?4, 'counter', ?5, 0, ?6
      WHERE NOT EXISTS (SELECT 1 FROM taps WHERE shop_id = ?2 AND device_hash = ?5 AND created_at > ?7)`,
  ).bind(tapId, shop.id, input.tile, input.answer, device, now.toISOString(), since, counter.location_id ?? shop.id).run();
  if (!ins.meta.changes) return { status: 200, body: { ok: true, counted: false, name } };
  if (input.answer !== "post" || !input.tile || !name) return { status: 200, body: { ok: true, counted: true, name, id: tapId } };
  const message = await ringMessage(env, shop, input.tile, name, imageUrl, "counter", now, counter.location_id ?? shop.id);
  return { status: 200, body: { ok: true, counted: true, name, id: tapId }, ring: { message, exceptDevice: input.device, shop } };
}

/** How long after a tap the staff screen may take it back (plan 3.6). */
export const UNDO_WINDOW_MS = 60_000;

export type UndoOutcome =
  | { status: 200; body: { ok: true }; undo: { message: UndoMessage; shopId: string } }
  | { status: 404 | 409 | 410; body: { ok: false; error: string } };

/**
 * Take back one tap from the staff screen that made it (plan 3.6, P7). Only that counter's newest
 * tap, within 60 s. Another counter's or shop's tap id is a 404; an older tap is "too late" (410).
 */
export async function undoCounterTap(env: Env, token: string, tapId: string, now = new Date()): Promise<UndoOutcome> {
  const counter = await getCounter(env, token);
  if (!counter) return { status: 404, body: { ok: false, error: "no such counter" } };
  if (counter.closed_at) return { status: 409, body: { ok: false, error: "closed" } };
  const shop = await liveShop(env, counter.shop_id);
  if (!shop) return { status: 410, body: { ok: false, error: "gone" } };
  const device = await deviceHash(`counter:${counter.token}`, shop.id);
  const tap = await env.DB.prepare(`SELECT id, tile_id, location_id, created_at FROM taps WHERE id = ?1 AND shop_id = ?2 AND device_hash = ?3 AND source = 'counter'`)
    .bind(tapId, shop.id, device)
    .first<{ id: string; tile_id: string | null; location_id: string | null; created_at: string }>();
  if (!tap) return { status: 404, body: { ok: false, error: "no such tap" } };
  const newest = await env.DB.prepare(`SELECT id FROM taps WHERE shop_id = ?1 AND device_hash = ?2 ORDER BY created_at DESC, id DESC LIMIT 1`).bind(shop.id, device).first<{ id: string }>();
  if (newest?.id !== tap.id || now.getTime() - new Date(tap.created_at).getTime() > UNDO_WINDOW_MS) return { status: 410, body: { ok: false, error: "too late" } };
  const del = await env.DB.prepare(`DELETE FROM taps WHERE id = ?1 AND shop_id = ?2`).bind(tap.id, shop.id).run();
  if (!del.meta.changes) return { status: 404, body: { ok: false, error: "no such tap" } };
  return { status: 200, body: { ok: true }, undo: { shopId: shop.id, message: { type: "undo", tapId: tap.id, tileId: tap.tile_id, locationId: tap.location_id } } };
}
