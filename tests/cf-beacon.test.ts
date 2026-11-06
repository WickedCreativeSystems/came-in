// needs.md cf-beacon-off: every HTML page says no-transform (so the zone injects no beacon) and is gzipped by the
// Worker itself (so it stays small). Nothing else is touched.
import { describe, it, expect } from "vitest";
import { call } from "./helpers";

async function gunzip(res: Response): Promise<string> {
  const plain = res.body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(plain).text();
}

describe("cf-beacon-off: HTML pages are no-transform and gzipped by the Worker", () => {
  for (const path of ["/", "/privacy", "/sample", "/sample/t", "/sample/card"]) {
    it(`${path} with gzip accepted comes back gzipped, no-transform, Vary: Accept-Encoding`, async () => {
      const res = await call(path, { headers: { "accept-encoding": "gzip, deflate, br, zstd", accept: "text/html" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      expect(res.headers.get("cache-control")).toMatch(/no-transform/);
      expect(res.headers.get("content-encoding")).toBe("gzip");
      expect(res.headers.get("vary")).toMatch(/accept-encoding/i);
      expect(res.headers.get("content-length")).toBeNull();
      const html = await gunzip(res);
      expect(html.toLowerCase()).toContain("<html");
    });
  }

  it("keeps what a page already said about caching, and adds no-transform", async () => {
    const res = await call("/sample", { headers: { "accept-encoding": "gzip" } });
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
  });

  it("without gzip accepted, the page is plain but still no-transform", async () => {
    for (const ae of [undefined, "identity", "gzip;q=0, br"]) {
      const res = await call("/privacy", ae ? { headers: { "accept-encoding": ae } } : {});
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("cache-control")).toMatch(/no-transform/);
      expect((await res.text()).toLowerCase()).toContain("<html");
    }
  });

  it("the sample session cookie still comes with the gzipped app page", async () => {
    const res = await call("/sample", { headers: { "accept-encoding": "gzip" } });
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("assets, API answers and plain text are left alone", async () => {
    const page = await gunzip(await call("/sample", { headers: { "accept-encoding": "gzip" } }));
    const js = page.match(/\/assets\/[^"]+\.js/)?.[0];
    expect(js).toBeTruthy();
    const a = await call(js!, { headers: { "accept-encoding": "gzip" } });
    expect(a.status).toBe(200);
    expect(a.headers.get("content-encoding")).toBeNull();
    expect(a.headers.get("cache-control") ?? "").not.toMatch(/no-transform/);
    const api = await call("/api/sample/wall", { headers: { "accept-encoding": "gzip" } });
    expect(api.headers.get("content-encoding")).toBeNull();
    expect(api.headers.get("cache-control") ?? "").not.toMatch(/no-transform/);
    const nf = await call("/no-such-thing", { headers: { "accept-encoding": "gzip" } });
    expect(nf.status).toBe(404);
    expect(nf.headers.get("content-encoding")).toBeNull();
  });
});
