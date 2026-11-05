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
  // Eastside Bakery has two locations (its own, and Harbour Road); Harbour Cafe has one. Eastside has had
  // walk-ins at both and one online today, Harbour none: the shops must not show each other's, and the
  // location tabs must add up.
  const nm = (id: string) => STAGING_SHOPS.find((x) => x.id === id)!.name;
  for (const [i, s] of STAGING_SHOPS.entries()) {
    await env.DB.prepare(`INSERT OR IGNORE INTO locations (id, shop_id, name, position, created_at) VALUES (?1, ?1, ?2, 0, ?3)`).bind(s.id, i === 0 ? "Eastside" : nm(s.id).slice(0, 24), iso(1)).run();
  }
  // Staging was seeded before locations existed: the migration named Eastside's first one after the shop.
  await env.DB.prepare(`UPDATE locations SET name = 'Eastside' WHERE id = 'stagingone' AND name = 'Eastside Bakery'`).run();
  // The first seed used an id one letter too long; move anything on it to the right one.
  await env.DB.prepare(`UPDATE taps SET location_id = 'stagingloc' WHERE location_id = 'stagingloca'`).run();
  await env.DB.prepare(`DELETE FROM locations WHERE id = 'stagingloca'`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO locations (id, shop_id, name, position, created_at) VALUES ('stagingloc', 'stagingone', 'Harbour Road', 1, ?1)`).bind(iso(1)).run();
  const taps: [string, string | null, string, number][] = [
    ["stagingtap0", "stagingone", "card", 30],
    ["stagingtap1", "stagingone", "card", 31],
    ["stagingtap2", "stagingloc", "card", 40],
    ["stagingtap3", "stagingloc", "counter", 41],
    ["stagingtap4", "stagingloc", "card", 42],
    ["stagingtap5", null, "online", 50],
  ];
  for (const [id, loc, source, mins] of taps) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO taps (id, shop_id, location_id, tile_id, answer, source, device_hash, rewarded, created_at) VALUES (?1, 'stagingone', ?2, ?3, 'post', ?4, ?5, 0, ?6)`,
    ).bind(id, loc, id === "stagingtap5" ? "stagingone-t1" : "stagingone-t0", source, `dev-${id}`, new Date(now - mins * 60000).toISOString()).run();
  }
  return STAGING_SHOPS.map((s) => s.id);
}
