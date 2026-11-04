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

/** ci_owner: shopId.issuedAt.hmac, 90 days (plan 1.5). */
export async function setOwnerCookie(c: Context<{ Bindings: Env }>, shopId: string): Promise<void> {
  const value = await sign(`${shopId}.${Date.now()}`, c.env.COOKIE_SECRET);
  setCookie(c, OWNER_COOKIE, value, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: OWNER_DAYS * 86400,
  });
}

export function clearOwnerCookie(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, OWNER_COOKIE, { path: "/" });
}

/** The signed-in shop's id, or null. */
export async function ownerShopId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const raw = getCookie(c, OWNER_COOKIE);
  const value = await verify(raw, c.env.COOKIE_SECRET);
  if (!value) return null;
  const [shopId, issued] = value.split(".");
  if (!shopId || !issued) return null;
  if (Date.now() - Number(issued) > OWNER_DAYS * 86400000) return null;
  return shopId;
}

/** ci_oauth: the PKCE verifier and state for ten minutes (plan 1.2). */
export async function setOAuthCookie(c: Context<{ Bindings: Env }>, data: { verifier: string; state: string; next?: string }): Promise<void> {
  const value = await sign(btoa(JSON.stringify({ ...data, at: Date.now() })), c.env.COOKIE_SECRET);
  setCookie(c, OAUTH_COOKIE, value, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/", maxAge: 600 });
}

export async function readOAuthCookie(c: Context<{ Bindings: Env }>): Promise<{ verifier: string; state: string; next?: string } | null> {
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
