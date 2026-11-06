// look.md, The Today tab: with less than 320px of row the tabs are 14px with 8px gaps (here a 351px screen or narrower),
// otherwise 15px with 16px gaps. At every width from 320 to 400 the row fits its column on one line and nothing scrolls sideways (plan section 0).
// Usage: node scripts/check-week-tabs.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const widths = [];
for (let w = 320; w <= 400; w++) widths.push(w);
for (const w of [800, 1280]) widths.push(w);
let passed = 0;
for (const path of ["/sample/week", "/week"]) {
const page = await (await browser.newContext({ viewport: { width: 320, height: 800 } })).newPage();
if (path === "/week") await page.goto(base + "/staging/shops"); // the seeded staging shop
await page.goto(base + path);
await page.waitForSelector(".range-tab");
for (const vw of widths) {
  await page.setViewportSize({ width: vw, height: 800 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await page.evaluate(() => {
    const row = document.querySelector(".range-tabs");
    const tabs = [...row.querySelectorAll(".range-tab")];
    const last = tabs[tabs.length - 1].getBoundingClientRect();
    const col = row.getBoundingClientRect(); // the row is as wide as its column
    return { rowWidth: col.width, size: getComputedStyle(tabs[0]).fontSize, gap: getComputedStyle(row).columnGap, lastRight: last.right, colRight: col.right,
      tops: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size, scroll: document.documentElement.scrollWidth - innerWidth };
  });
  const [size, gap] = m.rowWidth < 320 ? ["14px", "8px"] : ["15px", "16px"];
  const line = `${path} ${vw} (row ${m.rowWidth.toFixed(1)}px): tabs ${m.size} (want ${size}), gaps ${m.gap} (want ${gap}), ${m.tops} line, This month ends at ${m.lastRight.toFixed(1)}, column at ${m.colRight.toFixed(1)}, sideways scroll ${m.scroll}`;
  const good = m.size === size && m.gap === gap && m.tops === 1 && m.lastRight <= m.colRight + 0.5 && m.scroll <= 0;
  if (!good || [320, 340, 341, 344, 347, 348, 351, 352, 360, 390, 1280].includes(vw)) ok(good, line);
  if (good) passed++;
}
await page.context().close();
}
console.log(`${passed} of ${widths.length * 2} widths pass (both pages)`);
await browser.close();
process.exit(bad ? 1 : 0);
