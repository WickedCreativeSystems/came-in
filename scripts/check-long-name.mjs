// A 24-character one-word location name on staging's seeded two-location shop (plan 3.11, section 0; look.md
// "A long location name never widens a screen"). Renames Harbour Road for the run and always names it back.
// Usage: node scripts/check-long-name.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
const W = "W".repeat(24), LOC = "stagingloc", BACK = "Harbour Road";
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const shot = (n) => (process.env.SHOTS ? `${process.env.SHOTS}/${n}.png` : null);
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(base + "/staging/shops");
const rename = (name) => page.evaluate(async ([id, name]) => (await fetch(`/api/shop/locations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })).status, [LOC, name]);
ok((await rename(W)) === 200, "renamed Harbour Road to 24 Ws for the run");
try {
  await page.goto(base + "/setup");
  await page.waitForSelector("main");
  await page.waitForTimeout(1200);
  // A staff screen at the renamed location (opening one is what Setup's button does).
  const staff = await page.evaluate(async (loc) => (await (await fetch("/api/counter/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ location: loc }) })).json()).url || null, LOC);
  const pages = [["Wall", "/wall", ".loc-tabs"], ["This week", "/week", ".week-tile"], ["A post", "/post/stagingone-t1", ".receipt"], ["Card", `/card?l=${LOC}`, ".card"], ["Tap page", `/t/stagingone/${LOC}`, "body"], ["Setup", "/setup", "main"]];
  if (staff) pages.push(["Staff screen", staff, "body"]);
  for (const vw of [320, 390]) {
    await page.setViewportSize({ width: vw, height: 844 });
    for (const [name, path, sel] of pages) {
      await page.goto(base + path);
      await page.waitForSelector(sel);
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, text: document.body.innerText.includes("WWWWWWWWWW") }));
      ok(r.sw <= vw, `${vw} ${name}: no sideways scroll (${r.sw}px)${r.text ? "" : " [name not on this screen]"}`);
      if (name === "Wall" || name === "Card") {
        const c = await page.evaluate(() => [...document.querySelectorAll(".loc-chip, .locs a")].map((x) => { const t = x.querySelector("span") || x; return { w: x.getBoundingClientRect().width, cut: t.scrollWidth > t.clientWidth, ell: getComputedStyle(t).textOverflow, long: x.textContent.includes("WWWW") }; }));
        const l = c.find((x) => x.long);
        ok(l && l.w <= 220.5 && l.cut && l.ell === "ellipsis", `${vw} ${name}: the long chip is ${l ? Math.round(l.w) : "?"}px and ends in an ellipsis`);
      }
      if (name === "This week") {
        const t = await page.evaluate(() => {
          const tiles = [...document.querySelectorAll(".week-tile")].map((x) => x.getBoundingClientRect().width);
          const caps = [...document.querySelectorAll(".by-loc")].map((p) => ({ lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)), counts: [...p.querySelectorAll(".n")].every((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && b.right <= p.getBoundingClientRect().right + 0.5 && b.bottom <= p.getBoundingClientRect().bottom + 0.5; }), text: p.innerText }));
          return { tiles, caps };
        });
        const want = (vw - 32 - 8) / 2;
        ok(t.tiles.length > 0 && t.tiles.every((w) => Math.abs(w - want) < 1.5), `${vw} This week: tiles ${[...new Set(t.tiles.map(Math.round))].join(", ")}px (want ${want})`);
        ok(t.caps.length > 0 && t.caps.every((c) => c.lines <= 2 && c.counts), `${vw} This week: captions at most two lines, every count shown (${t.caps.map((c) => c.lines + " line" + (c.lines > 1 ? "s" : "") + ": " + c.text.replace(/\n/g, " ")).join(" | ")})`);
      }
      if (name === "A post") {
        const p = await page.evaluate(() => [...document.querySelectorAll(".receipt li")].filter((li) => li.textContent.includes("WWWW")).map((li) => { const n = li.querySelector(".num").getBoundingClientRect(), s = li.querySelector("span"); return { right: n.right, cut: s.scrollWidth > s.clientWidth }; }));
        ok(p.length === 1 && p[0].right <= vw - 15 && p[0].cut, `${vw} A post: Where they came in shows the count (right edge ${p[0] ? Math.round(p[0].right) : "?"}) and cuts the name`);
      }
      if (shot("x")) await page.screenshot({ path: shot(`long-${vw}-${name.replace(/ /g, "-")}`), fullPage: true });
    }
  }
} finally {
  await page.goto(base + "/wall");
  ok((await rename(BACK)) === 200, "named it back to Harbour Road");
}
await browser.close();
process.exit(bad ? 1 : 0);
