// Round six: on a phone, Setup's Ring my phone result and Now try a tap end up clear of the bottom bar.
// Usage: node scripts/check-round6.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const [name, vp] of [["phone", { width: 390, height: 844 }], ["small phone", { width: 320, height: 640 }]]) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  await page.goto(base + "/sample/setup");
  await page.getByRole("button", { name: /ring my phone/i }).first().waitFor();
  await page.getByRole("button", { name: /ring my phone/i }).first().click();
  await page.waitForSelector(".now-try");
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const link = document.querySelector(".now-try").getBoundingClientRect();
    const bar = document.querySelector("nav.bottombar").getBoundingClientRect();
    return { linkBottom: link.bottom, linkTop: link.top, barTop: bar.top };
  });
  ok(r.linkBottom <= r.barTop - 15 && r.linkBottom >= r.barTop - 17, `${name}: Now try a tap rests 16px above the bottom bar (${Math.round(r.barTop - r.linkBottom)}px)`);
  ok(r.linkTop > 0, `${name}: it is on screen`);
}
await browser.close();
process.exit(bad ? 1 : 0);
