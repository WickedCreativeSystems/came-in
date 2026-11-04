import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import worker from "../src/worker/index";
import { storeTokens } from "../src/worker/tokens";
import type { BufferPost } from "../src/worker/buffer/queries";

export const ORIGIN = "https://came-in.test";

export async function call(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  const req = new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init, headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
}

let shopCounter = 0;
export function testShopId(): string {
  shopCounter++;
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let n = shopCounter + Math.floor(Math.random() * 1e6);
  let s = "";
  for (let i = 0; i < 10; i++) {
    s += letters[n % 26];
    n = Math.floor(n / 26) + i * 7;
  }
  return s;
}

export async function makeShop(opts: { id?: string; tz?: string; thankYou?: string | null; review?: string | null } = {}): Promise<string> {
  const id = opts.id ?? testShopId();
  await env.DB.prepare(
    `INSERT INTO shops (id, buffer_account_id, buffer_org_id, name, handle, timezone, thank_you_text, review_url, created_at)
     VALUES (?1, ?2, ?3, 'Test Bakery', 'testbakery', ?4, ?5, ?6, ?7)`,
  ).bind(id, `acct-${id}`, `org-${id}`, opts.tz ?? "America/Chicago", opts.thankYou ?? null, opts.review ?? null, new Date().toISOString()).run();
  await storeTokens(env, id, { access_token: `access-${id}`, refresh_token: `refresh-${id}`, expires_in: 3600 });
  return id;
}

export async function addChannel(shopId: string, id: string, service: string, enabled = 1): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO channels (id, shop_id, name, display_name, service, avatar, enabled, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)`,
  ).bind(id, shopId, `${service}-handle`, `Test ${service}`, service, enabled, new Date().toISOString()).run();
}

export async function addTile(shopId: string, opts: { id: string; text: string; sentAt: string; channelId: string; story?: boolean; image?: boolean }): Promise<void> {
  await env.DB.prepare(`INSERT INTO tiles (id, shop_id, text_hash, first_sent_at) VALUES (?1, ?2, ?3, ?4)`).bind(opts.id, shopId, `h-${opts.id}`, opts.sentAt).run();
  await env.DB.prepare(
    `INSERT INTO posts (id, shop_id, tile_id, channel_id, text, sent_at, is_story, kind, thumb_status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
  ).bind(`p-${opts.id}`, shopId, opts.id, opts.channelId, opts.text, opts.sentAt, opts.story ? 1 : 0, opts.image ? "photo" : "text", opts.image ? "ok" : "missing", new Date().toISOString()).run();
}

export async function ownerCookie(shopId: string): Promise<string> {
  const { sign } = await import("../src/worker/lib/crypto");
  return `ci_owner=${await sign(`${shopId}.${Date.now()}`, env.COOKIE_SECRET)}`;
}

export function post(over: Partial<BufferPost> & { id: string; channelId: string }): BufferPost {
  return {
    text: "",
    status: "sent",
    sentAt: new Date().toISOString(),
    dueAt: null,
    channelService: "instagram",
    externalLink: `https://instagram.com/p/${over.id}`,
    via: "buffer",
    metadata: { __typename: "InstagramPostMetadata", type: "post" },
    assets: [],
    ...over,
  };
}

export const RATE_HEADERS = {
  ratelimit: `"15m"; r=134; t=423, "24h"; r=437; t=38498, "30d"; r=1131; t=963745`,
  "ratelimit-policy": `"15m"; q=150; w=900; pk=abc, "24h"; q=600; w=86400; pk=def, "30d"; q=3000; w=2592000; pk=ghi`,
};

export interface FakeBuffer {
  posts: BufferPost[];
  channels: { id: string; name: string; displayName: string | null; service: string; type: string; avatar: string | null; externalLink: string | null; timezone: string | null; isDisconnected: boolean }[];
  account: { id: string; name: string; timezone: string; organizations: { id: string; name: string }[] };
  calls: { query: string; variables: Record<string, unknown> }[];
  tokenCalls: URLSearchParams[];
  status429?: boolean;
  images: Record<string, { type: string; body: Uint8Array<ArrayBuffer> } | number>;
  /** Write-back switches. */
  tagLimit?: boolean;
  tags: { id: string; name: string }[];
  postTags: Record<string, string[]>;
  approval?: boolean;
  notes: { id: string; postId: string | null; text: string }[];
  ideas: unknown[];
  created: Record<string, unknown>[];
  heads: Record<string, number>;
}

/** Stand in for Buffer, its auth server and image hosts, at the fetch layer. */
export function fakeBuffer(over: Partial<FakeBuffer> = {}): FakeBuffer {
  const fb: FakeBuffer = {
    posts: [],
    channels: [],
    account: { id: "acct-1", name: "Owner", timezone: "America/Chicago", organizations: [{ id: "org-1", name: "Rye Test" }] },
    calls: [],
    tokenCalls: [],
    images: {},
    tags: [],
    postTags: {},
    notes: [],
    ideas: [],
    created: [],
    heads: {},
    ...over,
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    if (url.host === "buffer-auth.test" && url.pathname === "/token") {
      const form = new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer()));
      fb.tokenCalls.push(form);
      if (form.get("code") === "bad") return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: "at-" + fb.tokenCalls.length, refresh_token: "rt-" + fb.tokenCalls.length, expires_in: 3600, scope: "posts:read" });
    }
    if (url.host === "buffer-api.test") {
      const body = (await req.json()) as { query: string; variables: Record<string, unknown> };
      fb.calls.push(body);
      if (fb.status429) return new Response(JSON.stringify({ code: "RATE_LIMIT_EXCEEDED", window: "15m" }), { status: 429, headers: { "retry-after": "120", ...RATE_HEADERS } });
      const h = { "content-type": "application/json", ...RATE_HEADERS };
      if (body.query.includes("CameInAccount")) return new Response(JSON.stringify({ data: { account: fb.account } }), { headers: h });
      if (body.query.includes("CameInChannels")) return new Response(JSON.stringify({ data: { channels: fb.channels } }), { headers: h });
      const v = body.variables as Record<string, any>;
      const ok = (data: unknown) => new Response(JSON.stringify({ data }), { headers: h });
      if (body.query.includes("CameInCreatePost")) {
        fb.created.push(v.input);
        const status = v.input.saveToDraft ? "draft" : fb.approval ? "needs_approval" : "scheduled";
        return ok({ createPost: { __typename: "PostActionSuccess", post: { id: `new-${fb.created.length}`, status } } });
      }
      if (body.query.includes("CameInPostTags")) return ok({ post: { id: v.id, tags: (fb.postTags[v.id] ?? []).map((id) => ({ id, name: id })) } });
      if (body.query.includes("CameInEditPostTags")) {
        fb.postTags[v.input.id] = v.input.tagIds;
        return ok({ editPost: { __typename: "PostActionSuccess", post: { id: v.input.id, tags: v.input.tagIds.map((id: string) => ({ id })) } } });
      }
      if (body.query.includes("CameInTags")) return ok({ tagsV2: { edges: fb.tags.map((t) => ({ node: { ...t, color: "#000000", isLocked: false } })) } });
      if (body.query.includes("CameInCreateTag")) {
        if (fb.tagLimit || fb.tags.length >= 3) return ok({ createTag: { __typename: "LimitReachedError", message: "Your plan allows 3 tags." } });
        const tag = { id: `tag-${fb.tags.length + 1}`, name: v.input.tag.name };
        fb.tags.push(tag);
        return ok({ createTag: { __typename: "TagActionSuccess", tag } });
      }
      if (body.query.includes("CameInCreateNote")) {
        const note = { id: `note-${fb.notes.length + 1}`, postId: v.input.subject.postId, text: v.input.text };
        fb.notes.push(note);
        return ok({ createCollaborationNote: { __typename: "CreateCollaborationNoteSuccess", edge: { node: { id: note.id } } } });
      }
      if (body.query.includes("CameInUpdateNote")) {
        const note = fb.notes.find((n) => n.id === v.input.noteId);
        if (note) note.text = v.input.text;
        return ok({ updateCollaborationNote: { __typename: "UpdateCollaborationNoteSuccess", note: { id: v.input.noteId } } });
      }
      if (body.query.includes("CameInCreateIdea")) {
        fb.ideas.push(v.input);
        return ok({ createIdea: { __typename: "Idea", id: `idea-${fb.ideas.length}` } });
      }
      if (body.query.includes("CameInSentPosts")) {
        const since = body.variables.since ? new Date(String(body.variables.since)).getTime() : 0;
        const ids = (body.variables.channelIds as string[]) ?? [];
        const all = fb.posts.filter((p) => ids.includes(p.channelId) && new Date(p.sentAt!).getTime() >= since);
        const first = Number(body.variables.first ?? 100);
        const start = body.variables.after ? Number(body.variables.after) : 0;
        const page = all.slice(start, start + first);
        const end = start + page.length;
        return new Response(JSON.stringify({ data: { posts: { edges: page.map((node) => ({ node })), pageInfo: { hasNextPage: end < all.length, endCursor: String(end) } } } }), { headers: h });
      }
      return new Response(JSON.stringify({ errors: [{ message: "unknown query" }] }), { headers: h });
    }
    if (req.method === "HEAD") return new Response(null, { status: fb.heads[req.url] ?? 404 });
    const img = fb.images[req.url];
    if (typeof img === "number") return new Response("no", { status: img });
    if (img) return new Response(img.body, { headers: { "content-type": img.type, "content-length": String(img.body.byteLength) } });
    return new Response("not found", { status: 404 });
  });
  return fb;
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
