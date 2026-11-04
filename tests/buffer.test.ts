// Plan 1.2: OAuth, tokens, rate headers. P1: tokens in D1 are ciphertext.
import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { parseRateHeaders, graphql, BufferError, blockedUntil } from "../src/worker/buffer/client";
import { encrypt, decrypt, codeChallenge } from "../src/worker/lib/crypto";
import { call, cookiesFrom, fakeBuffer, RATE_HEADERS } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("rate-limit headers (plan 1.2, section 9)", () => {
  it("parses ratelimit and ratelimit-policy per named window", () => {
    const now = new Date("2026-11-03T20:00:00Z");
    const w = parseRateHeaders(RATE_HEADERS.ratelimit, RATE_HEADERS["ratelimit-policy"], now);
    const m = Object.fromEntries(w.map((x) => [x.window, x]));
    expect(m["15m"]).toMatchObject({ remaining: 134, quota: 150 });
    expect(m["24h"]).toMatchObject({ remaining: 437, quota: 600 });
    expect(m["30d"]).toMatchObject({ remaining: 1131, quota: 3000 });
    expect(m["15m"].resetAt).toBe(new Date(now.getTime() + 423000).toISOString());
  });
  it("stores buffer_rate and counts the call on every Buffer response", async () => {
    fakeBuffer();
    await graphql(env, "tok", "query CameInAccount { account { id } }", {});
    const r = await env.DB.prepare(`SELECT remaining, quota FROM buffer_rate WHERE window = '24h'`).first<{ remaining: number; quota: number }>();
    expect(r).toEqual({ remaining: 437, quota: 600 });
    const d = await env.DB.prepare(`SELECT count FROM buffer_calls_daily`).first<{ count: number }>();
    expect(d!.count).toBeGreaterThanOrEqual(1);
  });
  it("a 429 sets blocked_until from Retry-After and nothing calls Buffer until then", async () => {
    const fb = fakeBuffer({ status429: true });
    await expect(graphql(env, "tok", "query CameInAccount { account { id } }", {})).rejects.toMatchObject({ kind: "rate_limited" });
    const until = await blockedUntil(env);
    expect(until).not.toBeNull();
    expect(until!.getTime()).toBeGreaterThan(Date.now() + 100000);
    const before = fb.calls.length;
    await expect(graphql(env, "tok", "query CameInAccount { account { id } }", {})).rejects.toBeInstanceOf(BufferError);
    expect(fb.calls.length).toBe(before);
  });
});

describe("tokens at rest (P1)", () => {
  it("round-trips AES-GCM and never stores plain text", async () => {
    const c = await encrypt("secret-token", env.TOKEN_ENC_KEY);
    expect(c).not.toContain("secret-token");
    expect(await decrypt(c, env.TOKEN_ENC_KEY)).toBe("secret-token");
  });
});

describe("connect Buffer (P1, plan 1.2)", () => {
  it("/auth/start redirects to Buffer with PKCE S256, the scopes and prompt=consent, and sets ci_oauth", async () => {
    const res = await call("/auth/start");
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://buffer-auth.test/auth");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("response_type")).toBe("code");
    expect(to.searchParams.get("prompt")).toBe("consent");
    expect(to.searchParams.get("scope")).toBe("account:read posts:read posts:write ideas:write notes:write offline_access");
    expect(to.searchParams.get("redirect_uri")).toBe("https://came-in.test/auth/callback");
    expect(to.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("ci_oauth=") && /HttpOnly/i.test(c))).toBe(true);
  });

  it("one organization: consent lands on first run, ci_owner is set, tokens in D1 are ciphertext", async () => {
    const fb = fakeBuffer();
    const start = await call("/auth/start");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await call(`/auth/callback?code=good&state=${state}`, { cookie: cookiesFrom(start) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/setup/channels");
    const owner = res.headers.getSetCookie().find((c) => c.startsWith("ci_owner="))!;
    expect(owner).toMatch(/HttpOnly/i);
    expect(owner).toMatch(/Secure/i);
    expect(owner).toMatch(/SameSite=Lax/i);
    expect(owner).toMatch(/Max-Age=7776000/);
    // The code exchange sent the PKCE verifier matching the challenge.
    const form = fb.tokenCalls[0];
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_secret")).toBe("test-secret");
    const challenge = new URL(start.headers.get("location")!).searchParams.get("code_challenge");
    expect(await codeChallenge(form.get("code_verifier")!)).toBe(challenge);
    const shop = await env.DB.prepare(`SELECT id FROM shops WHERE buffer_account_id = 'acct-1' AND buffer_org_id = 'org-1'`).first<{ id: string }>();
    expect(shop!.id).toMatch(/^[a-z]{10}$/);
    const tok = await env.DB.prepare(`SELECT access_token_enc, refresh_token_enc FROM buffer_tokens WHERE shop_id = ?1`).bind(shop!.id).first<{ access_token_enc: string; refresh_token_enc: string }>();
    expect(tok!.access_token_enc).not.toContain("at-1");
    expect(tok!.refresh_token_enc).not.toContain("rt-1");
    expect(await decrypt(tok!.access_token_enc, env.TOKEN_ENC_KEY)).toBe("at-1");
  });

  it("refused consent shows the landing strip: No problem. Nothing was connected.", async () => {
    const res = await call("/auth/callback?error=access_denied&state=x");
    expect(res.headers.get("location")).toBe("/?error=denied");
    const page = await (await call("/?error=denied")).text();
    expect(page).toContain("No problem. Nothing was connected.");
  });

  it("a failed exchange shows: Buffer didn't finish connecting. Try again.", async () => {
    fakeBuffer();
    const start = await call("/auth/start");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await call(`/auth/callback?code=bad&state=${state}`, { cookie: cookiesFrom(start) });
    expect(res.headers.get("location")).toBe("/?error=exchange");
    expect(await (await call("/?error=exchange")).text()).toContain("Buffer didn't finish connecting. Try again.");
  });

  it("a wrong state is refused", async () => {
    fakeBuffer();
    const start = await call("/auth/start");
    const res = await call(`/auth/callback?code=good&state=wrong`, { cookie: cookiesFrom(start) });
    expect(res.headers.get("location")).toBe("/?error=exchange");
  });

  it("several organizations ask Which shop?", async () => {
    fakeBuffer({ account: { id: "acct-2", name: "O", timezone: "America/Chicago", organizations: [{ id: "o-a", name: "Shop A" }, { id: "o-b", name: "Shop B" }] } });
    const start = await call("/auth/start");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cb = await call(`/auth/callback?code=good&state=${state}`, { cookie: cookiesFrom(start) });
    expect(cb.headers.get("location")).toBe("/setup/org");
    const pending = cookiesFrom(cb);
    const orgs = (await (await call("/api/orgs", { cookie: pending })).json()) as { orgs: { name: string }[] };
    expect(orgs.orgs.map((o) => o.name)).toEqual(["Shop A", "Shop B"]);
    const pick = await call("/api/setup/org", { method: "POST", cookie: pending, headers: { "content-type": "application/json" }, body: JSON.stringify({ org: "o-b" }) });
    expect(((await pick.json()) as { next: string }).next).toBe("/setup/channels");
    expect(pick.headers.getSetCookie().some((c) => c.startsWith("ci_owner="))).toBe(true);
  });
});
