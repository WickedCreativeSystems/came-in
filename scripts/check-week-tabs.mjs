// look.md, The Today tab: up to 359px the tabs are 14px with 8px gaps, from 360 they're 15px with 16px; at every width
// from 320 to 400 the row fits its column on one line and nothing scrolls sideways (plan section 0).
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
for (const [vw, size, gap] of widths.map((w) => (w <= 359 ? [w, "14px", "8px"] : [w, "15px", "16px"]))) {
  const page = await (await browser.newContext({ viewport: { width: vw, height: 800 } })).newPage();
  await page.goto(base + "/sample/week");
  await page.waitForSelector(".range-tab");
  const m = await page.evaluate(() => {
    const row = document.querySelector(".range-tabs");
    const tabs = [...row.querySelectorAll(".range-tab")];
    const last = tabs[tabs.length - 1].getBoundingClientRect();
    const col = row.getBoundingClientRect(); // the row is as wide as its column
    return { size: getComputedStyle(tabs[0]).fontSize, gap: getComputedStyle(row).columnGap, lastRight: last.right, colRight: col.right,
      tops: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size, scroll: document.documentElement.scrollWidth - innerWidth };
  });
  const line = `${vw}: tabs ${m.size} (want ${size}), gaps ${m.gap} (want ${gap}), ${m.tops} line, This month ends at ${m.lastRight.toFixed(1)}, column at ${m.colRight.toFixed(1)}, sideways scroll ${m.scroll}`;
  const good = m.size === size && m.gap === gap && m.tops === 1 && m.lastRight <= m.colRight + 0.5 && m.scroll <= 0;
  if (!good || [320, 340, 341, 344, 347, 348, 359, 360, 390, 1280].includes(vw)) ok(good, line);
  if (good) passed++;
  await page.context().close();
}
console.log(`${passed} of ${widths.length} widths pass`);
await browser.close();
process.exit(bad ? 1 : 0);
