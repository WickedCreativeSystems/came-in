// The sample's ring changes (plan 3.10, P6) in a real browser.
// Usage: node scripts/check-sample-ring.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const [name, vp] of [["computer", { width: 1280, height: 900 }], ["phone", { width: 390, height: 800 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  for (const path of ["/sample", "/sample/week", "/sample/setup"]) {
    await page.goto(base + path);
    await page.waitForSelector(".strip");
    const t = await page.locator(".strip").first().innerText();
    ok(t.includes("Tap a post and this wall rings."), `${name} ${path}: strip says this wall rings`);
  }
  await page.goto(base + "/sample");
  await page.waitForSelector("a.btn:has-text('Open the tap page')");
  const url = page.url();
  await page.click("a.btn:has-text('Open the tap page')");
  await page.waitForTimeout(600);
  ok(page.url() === url, `${name}: Open the tap page leaves the wall in view`);
  if (name === "computer") {
    const f = page.frameLocator(".phone-wrap iframe.screen");
    const tile = f.locator(".t").first();
    await tile.waitFor();
    const focused = await tile.evaluate((el) => el === el.ownerDocument.activeElement);
    ok(focused, "computer: the frame's first tile has focus");
    const ring = await tile.evaluate((el) => { const s = getComputedStyle(el); return s.outlineStyle + " " + s.outlineWidth; });
    ok(/solid 2px/.test(ring), `computer: the tile shows the 2px focus ring (${ring})`);
    await page.screenshot({ path: process.env.SHOT || "/tmp/sample-ring-computer.png" });
  } else {
    ok(await page.locator(".sheet iframe").count() === 1, "phone: the Try a tap sheet is open");
  }
  // Ring my phone in the sample.
  await page.goto(base + "/sample/setup");
  const btn = page.locator("button:has-text('Ring my phone')").first();
  await btn.click();
  await page.waitForTimeout(800);
  const body = await page.locator("body").innerText();
  ok(body.includes("This browser will ring. In your own shop, this button makes your phone ring.") || body.includes("Notifications are blocked"), `${name}: Ring my phone result line`);
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
