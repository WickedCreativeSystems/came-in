// Staging only (APP_ENV "staging"): two made-up shops in one browser, so the Locations screens
// can be looked at and checked without a second Buffer account. No Buffer sign-in is stored for
// them, so nothing here can reach Buffer, and the real shop on staging is never touched.
import type { Env } from "./env";

export const STAGING_SHOPS = [
  { id: "stagingone", name: "Eastside Bakery", handle: "eastsidebakery", org: "staging-org-1", posts: ["Fresh rye is out of the oven.", "Saturday morning buns are back.", "Closing early Sunday for a wedding."] },
  { id: "stagingtwo", name: "Harbour Cafe", handle: "harbourcafe", org: "staging-org-2", posts: ["New beans from the roaster today.", "Live music on the deck, Friday.", "Our winter menu starts Monday."] },
];

export async function seedStagingShops(env: Env): Promise<string[]> {
  if (env.APP_ENV !== "staging") return [];
  const now = Date.now();
  const iso = (h: number) => new Date(now - h * 3600000).toISOString();
  for (const s of STAGING_SHOPS) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO shops (id, buffer_account_id, buffer_org_id, name, handle, timezone, created_at) VALUES (?1, 'staging-demo', ?2, ?3, ?4, 'America/Chicago', ?5)`,
    ).bind(s.id, s.org, s.name, s.handle, iso(1)).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO channels (id, shop_id, name, display_name, service, avatar, enabled, updated_at) VALUES (?1, ?2, ?3, ?4, 'instagram', NULL, 1, ?5)`,
    ).bind(`${s.id}-ig`, s.id, s.handle, s.name, iso(1)).run();
    for (const [i, text] of s.posts.entries()) {
      const tile = `${s.id}-t${i}`;
      const sent = iso(2 + i * 20);
      await env.DB.prepare(`INSERT OR IGNORE INTO tiles (id, shop_id, text_hash, first_sent_at) VALUES (?1, ?2, ?3, ?4)`).bind(tile, s.id, `h-${tile}`, sent).run();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO posts (id, shop_id, tile_id, channel_id, text, sent_at, is_story, kind, thumb_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'text', 'missing', ?6, ?6)`,
      ).bind(`p-${tile}`, s.id, tile, `${s.id}-ig`, text, sent).run();
    }
  }
  // Eastside has had two walk-ins today, Harbour none: the two shops must not show each other's.
  for (const n of [0, 1]) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO taps (id, shop_id, tile_id, answer, source, device_hash, rewarded, created_at) VALUES (?1, 'stagingone', 'stagingone-t0', 'post', 'card', ?2, 0, ?3)`,
    ).bind(`stagingtap${n}`, `stagingdev${n}`, new Date(now - (30 + n) * 60000).toISOString()).run();
  }
  return STAGING_SHOPS.map((s) => s.id);
}
