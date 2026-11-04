// Setup's saved settings (plan 3.8; P10): one shape for a real shop and for
// the sample bakery, whose settings live per browser session (plan 1.5).
import type { Env } from "./env";
import type { ShopRow } from "./db";
import { SAMPLE_SHOP } from "../shared/sample";
import type { Theme } from "../shared/types";

export interface Settings {
  thankYou: string | null;
  reviewUrl: string | null;
  markWinners: boolean;
  theme: Theme;
  cardPrinted: boolean;
}

export const THANK_YOU_MAX = 60;

/** Accepted review links: any https:// URL on google.com, g.page or maps.app.goo.gl (plan 1.8). */
export function validReviewUrl(v: string): boolean {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  return h === "google.com" || h.endsWith(".google.com") || h === "g.page" || h === "maps.app.goo.gl" || /^(www\.)?google\.[a-z.]{2,6}$/.test(h);
}

export interface SettingsPatch {
  thankYou?: string | null;
  reviewUrl?: string | null;
  markWinners?: boolean;
  theme?: Theme;
}

export type PatchResult = { ok: true; patch: SettingsPatch } | { ok: false; field: "thankYou" | "reviewUrl" | "theme"; error: string };

export function parsePatch(body: unknown): PatchResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: SettingsPatch = {};
  if ("thankYou" in b) {
    const t = typeof b.thankYou === "string" ? b.thankYou.replace(/\s+/g, " ").trim() : "";
    if ([...t].length > THANK_YOU_MAX) return { ok: false, field: "thankYou", error: `Keep it to ${THANK_YOU_MAX} characters.` };
    patch.thankYou = t || null;
  }
  if ("reviewUrl" in b) {
    const r = typeof b.reviewUrl === "string" ? b.reviewUrl.trim() : "";
    if (r && !validReviewUrl(r)) return { ok: false, field: "reviewUrl", error: "That link doesn't look like a Google review link." };
    patch.reviewUrl = r || null;
  }
  if ("markWinners" in b) patch.markWinners = !!b.markWinners;
  if ("theme" in b) {
    if (b.theme !== "system" && b.theme !== "day" && b.theme !== "night") return { ok: false, field: "theme", error: "Unknown theme." };
    patch.theme = b.theme;
  }
  return { ok: true, patch };
}

export function shopSettings(shop: ShopRow): Settings {
  return {
    thankYou: shop.thank_you_text,
    reviewUrl: shop.review_url,
    markWinners: !!shop.mark_winners,
    theme: shop.theme,
    cardPrinted: !!(shop as ShopRow & { card_printed_at?: string | null }).card_printed_at,
  };
}

export async function saveShopSettings(env: Env, shopId: string, p: SettingsPatch): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ("thankYou" in p) (sets.push(`thank_you_text = ?${vals.length + 2}`), vals.push(p.thankYou));
  if ("reviewUrl" in p) (sets.push(`review_url = ?${vals.length + 2}`), vals.push(p.reviewUrl));
  if ("markWinners" in p) (sets.push(`mark_winners = ?${vals.length + 2}`), vals.push(p.markWinners ? 1 : 0));
  if ("theme" in p) (sets.push(`theme = ?${vals.length + 2}`), vals.push(p.theme));
  if (!sets.length) return;
  await env.DB.prepare(`UPDATE shops SET ${sets.join(", ")} WHERE id = ?1`).bind(shopId, ...vals).run();
}

// ---- The sample bakery: a few weeks in, half its checklist done (look.md section 10). ----

const SAMPLE_DEFAULTS: Record<string, string | null> = {
  thank_you: SAMPLE_SHOP.thankYouText,
  review_url: SAMPLE_SHOP.reviewUrl,
  mark_winners: "1",
  theme: "system",
  card_printed: null,
  counter_opened: "1",
};

export async function sampleSettingsRaw(env: Env, session: string): Promise<Record<string, string | null>> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM sample_settings WHERE session_id = ?1`).bind(session).all<{ key: string; value: string | null }>();
  const out = { ...SAMPLE_DEFAULTS };
  for (const r of results) out[r.key] = r.value;
  return out;
}

export async function sampleSettings(env: Env, session: string): Promise<Settings & { counterOpened: boolean }> {
  const r = await sampleSettingsRaw(env, session);
  return {
    thankYou: r.thank_you,
    reviewUrl: r.review_url,
    markWinners: r.mark_winners === "1",
    theme: (r.theme as Theme) ?? "system",
    cardPrinted: !!r.card_printed,
    counterOpened: !!r.counter_opened,
  };
}

export async function setSample(env: Env, session: string, key: string, value: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sample_settings (session_id, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(session, key, value, new Date().toISOString()).run();
}

export async function saveSampleSettings(env: Env, session: string, p: SettingsPatch): Promise<void> {
  if ("thankYou" in p) await setSample(env, session, "thank_you", p.thankYou ?? null);
  if ("reviewUrl" in p) await setSample(env, session, "review_url", p.reviewUrl ?? null);
  if ("markWinners" in p) await setSample(env, session, "mark_winners", p.markWinners ? "1" : "0");
  if ("theme" in p) await setSample(env, session, "theme", p.theme ?? "system");
}

/** Disconnect and delete everything (plan 3.8): the shop's rows and R2 objects go; a tombstone keeps the tap page's "isn't using Came In" answer. */
export async function deleteShop(env: Env, shopId: string): Promise<void> {
  const tables = ["taps", "posts", "tiles", "channels", "counters", "push_subs", "buffer_tokens", "buffer_jobs"];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE shop_id = ?1`).bind(shopId)));
  await env.DB.prepare(
    `UPDATE shops SET name = '', handle = '', avatar_key = NULL, card_channel_id = NULL, thank_you_text = NULL, review_url = NULL, deleted_at = ?2 WHERE id = ?1`,
  ).bind(shopId, new Date().toISOString()).run();
  for (const prefix of [`thumbs/${shopId}/`, `full/${shopId}/`]) {
    let cursor: string | undefined;
    do {
      const list = await env.MEDIA.list({ prefix, cursor });
      if (list.objects.length) await env.MEDIA.delete(list.objects.map((o) => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }
  await env.MEDIA.delete(`avatars/${shopId}`);
}
