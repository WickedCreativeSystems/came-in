// look.md, The Today tab: at 320 the tabs are 14px with 8px gaps and the row fits its column; at 390 they're 15px.
// Usage: node scripts/check-week-tabs.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const [vw, size, gap] of [[320, "14px", "8px"], [390, "15px", "16px"]]) {
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
  ok(m.size === size, `${vw}: tabs ${m.size} (want ${size})`);
  ok(m.gap === gap, `${vw}: gaps ${m.gap} (want ${gap})`);
  ok(m.tops === 1, `${vw}: one line`);
  ok(m.lastRight <= m.colRight + 0.5, `${vw}: This month ends at ${m.lastRight.toFixed(1)}, column at ${m.colRight.toFixed(1)}`);
  ok(m.scroll <= 0, `${vw}: no sideways scroll`);
}
await browser.close();
process.exit(bad ? 1 : 0);
