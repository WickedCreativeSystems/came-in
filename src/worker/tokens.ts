// Buffer tokens, encrypted at rest (plan 1.3). Only ShopRoom refreshes them.
import type { Env } from "./env";
import { decrypt, encrypt } from "./lib/crypto";
import type { TokenResponse } from "./buffer/client";

export async function storeTokens(env: Env, shopId: string, t: TokenResponse, previousRefresh?: string): Promise<void> {
  const refresh = t.refresh_token ?? previousRefresh;
  if (!refresh) throw new Error("Buffer sent no refresh token");
  const expires = new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO buffer_tokens (shop_id, access_token_enc, refresh_token_enc, expires_at, scope) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(shop_id) DO UPDATE SET access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
       expires_at = excluded.expires_at, scope = excluded.scope`,
  ).bind(shopId, await encrypt(t.access_token, env.TOKEN_ENC_KEY), await encrypt(refresh, env.TOKEN_ENC_KEY), expires, t.scope ?? "").run();
}

export async function loadTokens(env: Env, shopId: string): Promise<{ access: string; refresh: string; expiresAt: Date } | null> {
  const r = await env.DB.prepare(`SELECT * FROM buffer_tokens WHERE shop_id = ?1`).bind(shopId).first<{ access_token_enc: string; refresh_token_enc: string; expires_at: string }>();
  if (!r) return null;
  return {
    access: await decrypt(r.access_token_enc, env.TOKEN_ENC_KEY),
    refresh: await decrypt(r.refresh_token_enc, env.TOKEN_ENC_KEY),
    expiresAt: new Date(r.expires_at),
  };
}
