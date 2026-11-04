// One door to Buffer. Every call parses the ratelimit headers into
// buffer_rate, counts toward buffer_calls_daily, and respects blocked_until
// (plan 1.2, "Rate limits"). Nothing a customer does ever reaches this file.
import type { Env } from "../env";
import { bufferApiUrl, bufferAuthUrl } from "../env";

export class BufferError extends Error {
  constructor(
    message: string,
    public kind: "rate_limited" | "unauthorized" | "graphql" | "network" | "blocked",
    public retryAfterSeconds?: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface RateWindow {
  window: string; // "15m" | "24h" | "30d"
  remaining: number | null;
  quota: number | null;
  resetAt: string | null;
}

/**
 * Parse `ratelimit: "15m"; r=134; t=423, "24h"; r=437; t=38498, ...` and
 * `ratelimit-policy: "15m"; q=150; w=900; ..., ...` (checked live, plan 9).
 */
export function parseRateHeaders(ratelimit: string | null, policy: string | null, now = new Date()): RateWindow[] {
  const windows = new Map<string, RateWindow>();
  const parse = (h: string | null) =>
    (h ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((item) => {
        const parts = item.split(";").map((p) => p.trim());
        const name = parts[0]?.replace(/^"|"$/g, "") ?? "";
        const kv: Record<string, string> = {};
        for (const p of parts.slice(1)) {
          const [k, v] = p.split("=");
          if (k && v !== undefined) kv[k.trim()] = v.trim();
        }
        return { name, kv };
      });
  for (const { name, kv } of parse(ratelimit)) {
    if (!name) continue;
    const w = windows.get(name) ?? { window: name, remaining: null, quota: null, resetAt: null };
    if (kv.r !== undefined) w.remaining = Number(kv.r);
    if (kv.t !== undefined) w.resetAt = new Date(now.getTime() + Number(kv.t) * 1000).toISOString();
    windows.set(name, w);
  }
  for (const { name, kv } of parse(policy)) {
    if (!name) continue;
    const w = windows.get(name) ?? { window: name, remaining: null, quota: null, resetAt: null };
    if (kv.q !== undefined) w.quota = Number(kv.q);
    windows.set(name, w);
  }
  return [...windows.values()];
}

export async function recordRate(env: Env, windows: RateWindow[]): Promise<void> {
  if (!windows.length) return;
  const stmts = windows.map((w) =>
    env.DB.prepare(
      `INSERT INTO buffer_rate (window, remaining, quota, reset_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(window) DO UPDATE SET remaining = excluded.remaining,
         quota = COALESCE(excluded.quota, buffer_rate.quota), reset_at = excluded.reset_at`,
    ).bind(w.window, w.remaining, w.quota, w.resetAt),
  );
  await env.DB.batch(stmts);
}

export async function countCall(env: Env, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO buffer_calls_daily (day, count) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1`,
  ).bind(day).run();
}

export async function countRefresh(env: Env, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO buffer_calls_daily (day, count, token_refreshes) VALUES (?1, 0, 1) ON CONFLICT(day) DO UPDATE SET token_refreshes = token_refreshes + 1`,
  ).bind(day).run();
}

export async function setBlocked(env: Env, until: Date): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO buffer_rate (window, blocked_until) VALUES ('block', ?1)
     ON CONFLICT(window) DO UPDATE SET blocked_until = excluded.blocked_until`,
  ).bind(until.toISOString()).run();
}

/** When Buffer may be called again, or null if now. */
export async function blockedUntil(env: Env): Promise<Date | null> {
  const row = await env.DB.prepare(`SELECT blocked_until FROM buffer_rate WHERE window = 'block'`).first<{ blocked_until: string | null }>();
  if (!row?.blocked_until) return null;
  const until = new Date(row.blocked_until);
  return until.getTime() > Date.now() ? until : null;
}

/** True when any window has under 10% of its quota left (plan 1.2). */
export async function nearLimit(env: Env): Promise<boolean> {
  const { results } = await env.DB.prepare(`SELECT window, remaining, quota FROM buffer_rate WHERE window != 'block'`).all<{ window: string; remaining: number | null; quota: number | null }>();
  return results.some((w) => w.remaining !== null && w.quota !== null && w.quota > 0 && w.remaining < w.quota * 0.1);
}

export interface GraphQLResult<T> {
  data: T;
  rate: RateWindow[];
}

/** POST a GraphQL query with a bearer token. Throws BufferError. */
export async function graphql<T>(env: Env, accessToken: string, query: string, variables: Record<string, unknown>, opts: { skipBlockCheck?: boolean } = {}): Promise<GraphQLResult<T>> {
  if (!opts.skipBlockCheck) {
    const until = await blockedUntil(env);
    if (until) throw new BufferError(`Buffer is rate limited until ${until.toISOString()}`, "blocked", Math.ceil((until.getTime() - Date.now()) / 1000));
  }
  let res: Response;
  try {
    res = await fetch(bufferApiUrl(env), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new BufferError(`Buffer unreachable: ${(e as Error).message}`, "network");
  }
  await countCall(env);
  const rate = parseRateHeaders(res.headers.get("ratelimit"), res.headers.get("ratelimit-policy"));
  await recordRate(env, rate);

  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    let until: Date;
    if (ra > 0) until = new Date(Date.now() + ra * 1000);
    else {
      // The named window's end, else 15 minutes.
      let body: { window?: string } = {};
      try {
        body = (await res.json()) as { window?: string };
      } catch {}
      const w = rate.find((x) => x.window === body.window) ?? rate.find((x) => x.remaining === 0);
      until = w?.resetAt ? new Date(w.resetAt) : new Date(Date.now() + 15 * 60000);
    }
    await setBlocked(env, until);
    throw new BufferError("Buffer rate limit hit", "rate_limited", Math.ceil((until.getTime() - Date.now()) / 1000));
  }
  if (res.status === 401) throw new BufferError("Buffer token rejected", "unauthorized");
  if (!res.ok) throw new BufferError(`Buffer answered ${res.status}`, "network", undefined, await res.text().catch(() => ""));
  const json = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
  if (json.errors?.length) {
    const codes = json.errors.map((e) => e.extensions?.code ?? "");
    if (codes.some((c) => /UNAUTH|FORBIDDEN|AUTHENTICATION/i.test(c))) throw new BufferError(json.errors[0].message, "unauthorized", undefined, json.errors);
    if (!json.data) throw new BufferError(json.errors.map((e) => e.message).join("; "), "graphql", undefined, json.errors);
  }
  return { data: json.data as T, rate };
}

// ---- OAuth (plan 1.2) ----

export const SCOPES = ["account:read", "posts:read", "posts:write", "ideas:write", "notes:write", "offline_access"];

export function authorizeUrl(env: Env, params: { redirectUri: string; state: string; codeChallenge: string }): string {
  const u = new URL("/auth", bufferAuthUrl(env));
  u.searchParams.set("client_id", env.BUFFER_CLIENT_ID);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge", params.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

async function tokenPost(env: Env, form: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(new URL("/token", bufferAuthUrl(env)), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    throw new BufferError(`Buffer auth unreachable: ${(e as Error).message}`, "network");
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const kind = body.error === "invalid_grant" ? "unauthorized" : "network";
    throw new BufferError(body.error_description || body.error || `token endpoint answered ${res.status}`, kind, undefined, body);
  }
  return body;
}

export function exchangeCode(env: Env, params: { code: string; redirectUri: string; verifier: string }): Promise<TokenResponse> {
  return tokenPost(env, {
    grant_type: "authorization_code",
    client_id: env.BUFFER_CLIENT_ID,
    client_secret: env.BUFFER_CLIENT_SECRET,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
  });
}

export async function refreshToken(env: Env, refresh: string): Promise<TokenResponse> {
  await countRefresh(env);
  return tokenPost(env, {
    grant_type: "refresh_token",
    client_id: env.BUFFER_CLIENT_ID,
    client_secret: env.BUFFER_CLIENT_SECRET,
    refresh_token: refresh,
  });
}
