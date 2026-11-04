// Ring my phone (plan 1.4, 2, 3.8; P9): Web Push with VAPID, on WebCrypto.
// The tapping device never gets one; endpoints answering 404 or 410 are
// marked failed and never used again.
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import type { Env } from "./env";
import { uuid } from "./lib/crypto";

export interface PushNote {
  title: string;
  body: string;
  icon: string | null;
  url: string;
  tag?: string;
}

export interface SubRow {
  id: string;
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function pushConfigured(env: Env): boolean {
  return !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE && env.VAPID_SUBJECT);
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * The browsers' push services. Came In only ever POSTs to these, so a
 * subscription can't turn the Worker into a relay to any other host.
 */
// The one list (plan section 2, P9): exactly these hosts, https only.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge on Android, Brave, Opera
  /^android\.googleapis\.com$/, // older Chrome
  /^jmt\d+\.google\.com$/, // Chrome on the desktop, for example jmt17.google.com
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^([a-z0-9-]+\.)+push\.apple\.com$/, // Safari: web.push.apple.com and the like
  /^([a-z0-9-]+\.)+notify\.windows\.com$/, // Edge on Windows
];

export function pushHostAllowed(endpoint: string, extra: string | undefined): boolean {
  let host: string;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (PUSH_HOSTS.some((r) => r.test(host))) return true;
  return !!extra && extra.split(",").map((h) => h.trim()).includes(host);
}

export const SAMPLE_PHONES_MAX = 5;

export function parseSubscription(v: unknown, extraHosts?: string): SubscriptionInput | null {
  if (!v || typeof v !== "object") return null;
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof s.endpoint !== "string" || s.endpoint.length > 2048 || !pushHostAllowed(s.endpoint, extraHosts)) return null;
  if (typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") return null;
  if (s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

/** Send one note to each subscription. Returns the ids that failed for good (404/410). */
export async function sendAll(env: Env, subs: SubRow[], note: PushNote): Promise<{ sent: number; gone: string[] }> {
  if (!pushConfigured(env) || !subs.length) return { sent: 0, gone: [] };
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE };
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      const sub: PushSubscription = { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        const payload = await buildPushPayload({ data: note as never, options: { ttl: 3600, urgency: "high", topic: note.tag?.slice(0, 32) } }, sub, vapid);
        const res = await fetch(s.endpoint, payload as RequestInit);
        if (res.status === 404 || res.status === 410) gone.push(s.id);
        else if (res.ok) sent++;
        else console.error("push answered", res.status, new URL(s.endpoint).host);
      } catch (e) {
        console.error("push failed", (e as Error)?.message);
      }
    }),
  );
  return { sent, gone };
}

/** Push to every live subscription of a shop except the tapping device's. */
export async function pushShop(env: Env, shopId: string, note: PushNote, exceptDevice: string | null): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, device_id, endpoint, p256dh, auth FROM push_subs WHERE shop_id = ?1 AND failed_at IS NULL AND (?2 IS NULL OR device_id != ?2)`,
  ).bind(shopId, exceptDevice).all<SubRow>();
  const { sent, gone } = await sendAll(env, results, note);
  if (gone.length) {
    const now = new Date().toISOString();
    await env.DB.batch(gone.map((id) => env.DB.prepare(`UPDATE push_subs SET failed_at = ?2 WHERE id = ?1`).bind(id, now)));
  }
  return sent;
}

export async function pushSample(env: Env, session: string, note: PushNote, exceptDevice: string | null): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, device_id, endpoint, p256dh, auth FROM sample_push_subs WHERE session_id = ?1 AND failed_at IS NULL AND (?2 IS NULL OR device_id != ?2)`,
  ).bind(session, exceptDevice).all<SubRow>();
  const { sent, gone } = await sendAll(env, results, note);
  if (gone.length) {
    const now = new Date().toISOString();
    await env.DB.batch(gone.map((id) => env.DB.prepare(`UPDATE sample_push_subs SET failed_at = ?2 WHERE id = ?1`).bind(id, now)));
  }
  return sent;
}

/** One row per endpoint; a phone that subscribes again replaces its old row. */
export async function saveShopSub(env: Env, shopId: string, device: string, sub: SubscriptionInput, ua: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO push_subs (id, shop_id, device_id, endpoint, p256dh, auth, ua, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(endpoint) DO UPDATE SET shop_id = excluded.shop_id, device_id = excluded.device_id, p256dh = excluded.p256dh,
       auth = excluded.auth, ua = excluded.ua, failed_at = NULL`,
  ).bind(uuid(), shopId, device, sub.endpoint, sub.keys.p256dh, sub.keys.auth, ua?.slice(0, 200) ?? null, new Date().toISOString()).run();
}

export async function saveSampleSub(env: Env, session: string, device: string, sub: SubscriptionInput): Promise<void> {
  await env.DB.prepare(`DELETE FROM sample_push_subs WHERE endpoint = ?1`).bind(sub.endpoint).run();
  // At most five phones per sample browser; the oldest gives way.
  await env.DB.prepare(
    `DELETE FROM sample_push_subs WHERE session_id = ?1 AND id NOT IN (SELECT id FROM sample_push_subs WHERE session_id = ?1 ORDER BY created_at DESC LIMIT ?2)`,
  ).bind(session, SAMPLE_PHONES_MAX - 1).run();
  await env.DB.prepare(
    `INSERT INTO sample_push_subs (id, session_id, device_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(uuid(), session, device, sub.endpoint, sub.keys.p256dh, sub.keys.auth, new Date().toISOString()).run();
}
