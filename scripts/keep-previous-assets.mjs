// A visit that spans a deploy can ask for the page's old hashed files (the page it holds names them),
// and each deploy used to remove them. This copies the live build's script and stylesheet into the new
// build before it is deployed, so an old page still finds its files for one more deploy.
// Usage: node scripts/keep-previous-assets.mjs <live origin> [dist/client]
// It never overwrites a file of the new build, and it never fails the deploy.
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const origin = (process.argv[2] || "").replace(/\/$/, "");
const dist = process.argv[3] || "dist/client";
if (!origin) {
  console.error("Give the live origin.");
  process.exit(0);
}
try {
  const html = await (await fetch(`${origin}/sample`, { headers: { "cache-control": "no-cache" } })).text();
  const names = [...new Set([...html.matchAll(/\/assets\/([A-Za-z0-9._-]+\.(?:js|css))/g)].map((m) => m[1]))].slice(0, 10);
  await mkdir(path.join(dist, "assets"), { recursive: true });
  let kept = 0;
  for (const name of names) {
    const target = path.join(dist, "assets", name);
    const exists = await access(target).then(() => true, () => false);
    if (exists) continue;
    const res = await fetch(`${origin}/assets/${name}`);
    if (!res.ok) continue;
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    kept++;
  }
  console.log(`kept ${kept} file(s) from the live build: ${names.join(", ") || "none"}`);
} catch (e) {
  console.log("could not keep the previous build's files:", e instanceof Error ? e.message : e);
}
