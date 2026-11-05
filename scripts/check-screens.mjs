// Looks at every owner screen in a real browser, at phone and desktop width, and fails when the
// first-paint frame is still on the page or the header isn't at the top (EaseBot/LookieBot, Nov 5).
// Usage: node scripts/check-screens.mjs https://came-in-staging.<subdomain>.workers.dev
// It needs Playwright (npx playwright install chromium). The shop screens use /staging/shops, which
// exists only on staging; the sample screens work anywhere.
import { chromium } from "playwright";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) {
  console.error("Give the base URL.");
  process.exit(2);
}
const sample = ["/sample", "/sample/week", "/sample/post/sour", "/sample/setup", "/sample/setup/add"];
const shop = ["/wall", "/week", "/week?range=today", "/post/stagingone-t0", "/setup", "/setup/add"];
let bad = 0;
const browser = await chromium.launch();
for (const width of [360, 1280]) {
  for (const [label, paths, enter] of [["sample", sample, null], ["shop", shop, "/staging/shops"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    if (enter) {
      const r = await page.goto(base + enter);
      if (!r || r.status() >= 400) {
        console.log(`skip ${label} screens: ${enter} is not on this server`);
        await ctx.close();
        continue;
      }
    }
    for (const p of paths) {
      await page.goto(base + p);
      await page.waitForSelector("header.sign", { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => ({
        frame: document.querySelectorAll(".sk-g, .sk-h").length,
        top: document.querySelector("header.sign")?.getBoundingClientRect().top ?? null,
        wide: document.documentElement.scrollWidth > innerWidth,
      }));
      const ok = r.frame === 0 && r.top === 0 && !r.wide;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "FAIL"} ${width}px ${p}  frame=${r.frame} headerTop=${r.top} sideways=${r.wide}`);
    }
    await ctx.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
