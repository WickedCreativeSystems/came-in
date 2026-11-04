import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env";
import { sign, verify } from "./crypto";

export const OWNER_COOKIE = "ci_owner";
export const OAUTH_COOKIE = "ci_oauth";
export const SAMPLE_COOKIE = "ci_sample";
const OWNER_DAYS = 90;

function secure(c: Context<{ Bindings: Env }>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export const MAX_SHOPS = 10;

/**
 * ci_owner: `current.issuedAt.shopA,shopB,...` and an HMAC over the whole value, 90 days
 * (plan 1.5). One browser can hold several shops (Locations); `current` is always in the list.
 * An older cookie, `shopId.issuedAt`, is read as a list of one.
 */
async function writeOwner(c: Context<{ Bindings: Env }>, current: string, shops: string[]): Promise<void> {
  const list = [current, ...shops.filter((s) => s !== current)].slice(0, MAX_SHOPS);
  const value = await sign(`${current}.${Date.now()}.${list.join(",")}`, c.env.COOKIE_SECRET);
  setCookie(c, OWNER_COOKIE, value, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: OWNER_DAYS * 86400,
  });
}

/** Sign this browser in to a shop, keeping the others it already holds (at most 10). */
export async function setOwnerCookie(c: Context<{ Bindings: Env }>, shopId: string, opts: { keep?: boolean } = {}): Promise<void> {
  const held = opts.keep === false ? [] : (await ownerState(c))?.shops ?? [];
  await writeOwner(c, shopId, [...held, shopId]);
}

export function clearOwnerCookie(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, OWNER_COOKIE, { path: "/" });
}

/** The current shop and every shop this browser holds, or null when signed out. */
export async function ownerState(c: Context<{ Bindings: Env }>): Promise<{ current: string; shops: string[] } | null> {
  const raw = getCookie(c, OWNER_COOKIE);
  const value = await verify(raw, c.env.COOKIE_SECRET);
  if (!value) return null;
  const [current, issued, list] = value.split(".");
  if (!current || !issued) return null;
  if (Date.now() - Number(issued) > OWNER_DAYS * 86400000) return null;
  const shops = list ? list.split(",").filter(Boolean) : [current];
  if (!shops.includes(current)) return null;
  return { current, shops: shops.slice(0, MAX_SHOPS) };
}

/** The signed-in (current) shop's id, or null. */
export async function ownerShopId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  return (await ownerState(c))?.current ?? null;
}

/** Switch the current shop. Only a shop already in the signed list is accepted; anything else changes nothing. */
export async function switchOwnerShop(c: Context<{ Bindings: Env }>, shopId: string): Promise<boolean> {
  const st = await ownerState(c);
  if (!st || !st.shops.includes(shopId)) return false;
  await writeOwner(c, shopId, st.shops);
  return true;
}

/** A shop was deleted: drop it from the list and move to another, or sign out when none is left. */
export async function dropOwnerShop(c: Context<{ Bindings: Env }>, shopId: string): Promise<boolean> {
  const st = await ownerState(c);
  const rest = (st?.shops ?? []).filter((s) => s !== shopId);
  if (!rest.length) {
    clearOwnerCookie(c);
    return false;
  }
  await writeOwner(c, rest[0], rest);
  return true;
}

/** ci_oauth: the PKCE verifier and state for ten minutes (plan 1.2). */
export async function setOAuthCookie(c: Context<{ Bindings: Env }>, data: { verifier: string; state: string; next?: string; add?: boolean }): Promise<void> {
  const value = await sign(btoa(JSON.stringify({ ...data, at: Date.now() })), c.env.COOKIE_SECRET);
  setCookie(c, OAUTH_COOKIE, value, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/", maxAge: 600 });
}

export async function readOAuthCookie(c: Context<{ Bindings: Env }>): Promise<{ verifier: string; state: string; next?: string; add?: boolean } | null> {
  const value = await verify(getCookie(c, OAUTH_COOKIE), c.env.COOKIE_SECRET);
  if (!value) return null;
  try {
    const data = JSON.parse(atob(value));
    if (Date.now() - data.at > 600000) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearOAuthCookie(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, OAUTH_COOKIE, { path: "/" });
}

/** ci_sample: a random session id for the sample bakery (plan 1.5). Set on first use. */
export function sampleSession(c: Context<{ Bindings: Env }>, makeId: () => string): string {
  let id = getCookie(c, SAMPLE_COOKIE);
  if (!id || !/^[A-Za-z0-9]{16,64}$/.test(id)) {
    id = makeId();
    setCookie(c, SAMPLE_COOKIE, id, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/", maxAge: 7 * 86400 });
  }
  return id;
}
