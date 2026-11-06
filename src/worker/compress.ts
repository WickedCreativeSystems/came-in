// The custom domain's zone injects Cloudflare's Web Analytics beacon into every HTML page (needs.md, cf-beacon-off).
// Cache-Control: no-transform keeps it out, but it also stops Cloudflare compressing the page (PR 12: about three
// times bigger). So every HTML page says no-transform and the Worker gzips it itself. encodeBody: "manual" tells the
// runtime the body is already encoded. JS, CSS, images and API answers are left as they are: the beacon only goes into HTML.

function withNoTransform(cache: string | null): string {
  if (!cache) return "no-transform";
  return /no-transform/i.test(cache) ? cache : `${cache}, no-transform`;
}

function acceptsGzip(acceptEncoding: string | null): boolean {
  if (!acceptEncoding) return false;
  return acceptEncoding.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name !== "gzip" && name !== "*") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}

export function htmlForEdge(req: Request, res: Response): Response {
  if (!(res.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) return res;
  if (res.status === 101 || res.webSocket) return res;
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", withNoTransform(headers.get("cache-control")));
  const vary = headers.get("vary");
  if (!vary || !/accept-encoding/i.test(vary)) headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  const init = { status: res.status, statusText: res.statusText, headers };
  if (!res.body || req.method === "HEAD" || headers.has("content-encoding") || !acceptsGzip(req.headers.get("accept-encoding"))) {
    return new Response(res.body, init);
  }
  headers.set("Content-Encoding", "gzip");
  headers.delete("Content-Length");
  return new Response(res.body.pipeThrough(new CompressionStream("gzip")), { ...init, encodeBody: "manual" });
}
