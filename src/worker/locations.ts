// Locations (plan 1.3, 3.13): a shop's stores. The first takes the shop's own id, so every card
// printed before locations existed keeps working. A location is not a security boundary: whoever
// holds a shop sees all its locations. A location id is only ever accepted with its own shop's id.
import type { Env } from "./env";

export const MAX_LOCATIONS = 10;
export const NAME_MAX = 24;

export interface LocationRow {
  id: string;
  shop_id: string;
  name: string;
  position: number;
  created_at: string;
  removed_at: string | null;
}

export interface LocationInfo {
  id: string;
  name: string;
  position: number;
  first: boolean;
  /** Whether it has any taps yet: a location with taps cannot be removed. */
  hasTaps: boolean;
}

export type NameProblem = "empty" | "long" | "taken" | "cap" | "first" | "taps" | "missing";

export const PROBLEM_TEXT: Record<NameProblem, string> = {
  empty: "Give it a name.",
  long: "Use 24 characters or fewer.",
  taken: "You already have a location called {name}.",
  cap: "A shop can have up to 10 locations.",
  first: "The first location can't be removed.",
  taps: "A location with taps can't be removed.",
  missing: "That location isn't there.",
};

export function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => String.fromCharCode(97 + (b % 26))).join("");
}

/** Every shop has a first location (its own id, its own name). A shop made before this ran, or a test shop, gets it here. */
async function ensureFirst(env: Env, shopId: string): Promise<void> {
  const any = await env.DB.prepare(`SELECT 1 AS x FROM locations WHERE shop_id = ?1 LIMIT 1`).bind(shopId).first();
  if (any) return;
  const shop = await env.DB.prepare(`SELECT name FROM shops WHERE id = ?1`).bind(shopId).first<{ name: string }>();
  if (!shop) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO locations (id, shop_id, name, position, created_at) VALUES (?1, ?1, ?2, 0, ?3)`).bind(shopId, cleanName(shop.name).slice(0, NAME_MAX) || "Main", new Date().toISOString()).run();
}

/** The shop's live locations in Setup's order. */
export async function listLocations(env: Env, shopId: string): Promise<LocationInfo[]> {
  await ensureFirst(env, shopId);
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.name, l.position,
            EXISTS (SELECT 1 FROM taps t WHERE t.shop_id = l.shop_id AND t.location_id = l.id) AS has_taps
       FROM locations l WHERE l.shop_id = ?1 AND l.removed_at IS NULL ORDER BY l.position, l.created_at`,
  ).bind(shopId).all<{ id: string; name: string; position: number; has_taps: number }>();
  return results.map((r, i) => ({ id: r.id, name: r.name, position: r.position, first: i === 0, hasTaps: !!r.has_taps }));
}

export async function firstLocation(env: Env, shopId: string): Promise<LocationRow | null> {
  await ensureFirst(env, shopId);
  return env.DB.prepare(`SELECT * FROM locations WHERE shop_id = ?1 AND removed_at IS NULL ORDER BY position, created_at LIMIT 1`).bind(shopId).first<LocationRow>();
}

/** A location of this shop, removed or not; null for another shop's id (a 404 for the caller). */
export async function locationOf(env: Env, shopId: string, locationId: string): Promise<LocationRow | null> {
  if (!/^[a-z]{10}$/.test(locationId)) return null;
  return env.DB.prepare(`SELECT * FROM locations WHERE id = ?1 AND shop_id = ?2`).bind(locationId, shopId).first<LocationRow>();
}

/** The shop's first location, made when the shop is (named after it, position 0). Idempotent. */
export async function ensureFirstLocation(env: Env, shop: { id: string; name: string; created_at?: string }, name?: string): Promise<void> {
  const nm = cleanName(name ?? shop.name).slice(0, NAME_MAX) || "Main";
  await env.DB.prepare(`INSERT OR IGNORE INTO locations (id, shop_id, name, position, created_at) VALUES (?1, ?1, ?2, 0, ?3)`).bind(shop.id, nm, new Date().toISOString()).run();
}

export async function createLocation(env: Env, shopId: string, rawName: unknown): Promise<{ ok: true; location: LocationInfo } | { ok: false; problem: NameProblem }> {
  const name = cleanName(rawName);
  if (!name) return { ok: false, problem: "empty" };
  if (name.length > NAME_MAX) return { ok: false, problem: "long" };
  const existing = await listLocations(env, shopId);
  if (existing.length >= MAX_LOCATIONS) return { ok: false, problem: "cap" };
  if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase())) return { ok: false, problem: "taken" };
  const id = newId();
  const position = existing.length ? Math.max(...existing.map((l) => l.position)) + 1 : 0;
  await env.DB.prepare(`INSERT INTO locations (id, shop_id, name, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(id, shopId, name, position, new Date().toISOString()).run();
  return { ok: true, location: { id, name, position, first: existing.length === 0, hasTaps: false } };
}

export async function renameLocation(env: Env, shopId: string, locationId: string, rawName: unknown): Promise<{ ok: true } | { ok: false; problem: NameProblem }> {
  const name = cleanName(rawName);
  if (!name) return { ok: false, problem: "empty" };
  if (name.length > NAME_MAX) return { ok: false, problem: "long" };
  const all = await listLocations(env, shopId);
  const mine = all.find((l) => l.id === locationId);
  if (!mine) return { ok: false, problem: "missing" };
  if (all.some((l) => l.id !== locationId && l.name.toLowerCase() === name.toLowerCase())) return { ok: false, problem: "taken" };
  await env.DB.prepare(`UPDATE locations SET name = ?3 WHERE id = ?1 AND shop_id = ?2`).bind(locationId, shopId, name).run();
  return { ok: true };
}

/** Remove a location that is not the first and has no taps; its card then says it isn't in use. */
export async function removeLocation(env: Env, shopId: string, locationId: string): Promise<{ ok: true } | { ok: false; problem: NameProblem }> {
  const all = await listLocations(env, shopId);
  const mine = all.find((l) => l.id === locationId);
  if (!mine) return { ok: false, problem: "missing" };
  if (mine.first) return { ok: false, problem: "first" };
  if (mine.hasTaps) return { ok: false, problem: "taps" };
  // The name is freed for reuse; the row stays so the old card can say it isn't in use any more.
  await env.DB.prepare(`UPDATE locations SET removed_at = ?3, name = name || '~' || id WHERE id = ?1 AND shop_id = ?2`).bind(locationId, shopId, new Date().toISOString()).run();
  await env.DB.prepare(`UPDATE counters SET closed_at = ?3 WHERE location_id = ?1 AND shop_id = ?2 AND closed_at IS NULL`).bind(locationId, shopId, new Date().toISOString()).run();
  return { ok: true };
}
