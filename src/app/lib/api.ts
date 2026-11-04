export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body?.error ?? status));
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const opts: RequestInit = { credentials: "same-origin", ...init };
  if (init?.json !== undefined) {
    opts.method = opts.method ?? "POST";
    opts.headers = { "content-type": "application/json", ...(init.headers ?? {}) };
    opts.body = JSON.stringify(init.json);
  }
  const res = await fetch(path, opts);
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
