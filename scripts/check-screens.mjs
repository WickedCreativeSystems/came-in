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
const sample = ["/sample/t", "/sample/c", "/sample", "/sample/week", "/sample/post/sour", "/sample/setup", "/sample/setup/add"];
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
        // Each day badge shows one text and exposes one text to a screen reader (EaseBot, Nov 5).
        twoBadges: [...document.querySelectorAll(".bd, .tile .day")].filter((e) => {
          const spans = [...e.querySelectorAll("span")].filter((x) => x.children.length === 0);
          const shown = spans.filter((x) => getComputedStyle(x).display !== "none" && x.getBoundingClientRect().width > 2 && x.getBoundingClientRect().height > 2 && x.textContent.trim());
          const exposed = spans.filter((x) => !x.closest("[aria-hidden=true]") && getComputedStyle(x).display !== "none" && x.textContent.trim());
          return shown.length > 1 || exposed.length > 1;
        }).length,
      }));
      const ok = r.frame === 0 && r.top === 0 && !r.wide && r.twoBadges === 0;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "FAIL"} ${width}px ${p}  frame=${r.frame} headerTop=${r.top} sideways=${r.wide} doubleBadges=${r.twoBadges}`);
    }
    await ctx.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
