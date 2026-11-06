// look.md, Color: selected text is ink on paper, never the browser's blue, in both themes, inputs included.
// The tap page and the card are always Day, so they get the Day pair even on a dark phone.
// Usage: SHOTS=<dir> node scripts/check-selection-ink.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const DAY = { bg: "rgb(35, 31, 27)", fg: "rgb(244, 242, 237)" };
const NIGHT = { bg: "rgb(239, 234, 225)", fg: "rgb(23, 20, 15)" };
const sel = (page, css) => page.evaluate((css) => {
  const el = document.querySelector(css);
  const s = getComputedStyle(el, "::selection");
  return { bg: s.backgroundColor, fg: s.color };
}, css);
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const scheme of ["light", "dark"]) {
  const want = scheme === "light" ? DAY : NIGHT;
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme })).newPage();
  await page.goto(base + "/staging/shops");
  await page.goto(base + "/setup");
  await page.waitForSelector(".loc-row .loc-name");
  let r = await sel(page, ".loc-row .loc-name");
  ok(r.bg === want.bg && r.fg === want.fg, `${scheme} Setup text: selection ${r.bg} on ${r.fg}`);
  await page.locator(".loc-row button", { hasText: "Rename" }).first().click();
  await page.waitForSelector(".loc-row input");
  r = await sel(page, ".loc-row input");
  ok(r.bg === want.bg && r.fg === want.fg, `${scheme} Rename input: selection ${r.bg} on ${r.fg}`);
  if (process.env.SHOTS) await page.locator(".loc-row").first().screenshot({ path: `${process.env.SHOTS}/rename-selected-${scheme}.png` });
  await page.keyboard.press("Escape");
  await page.goto(base + "/");
  r = await sel(page, "body");
  ok(r.bg === want.bg && r.fg === want.fg, `${scheme} home page: selection ${r.bg} on ${r.fg}`);
  await page.goto(base + "/t/stagingone/stagingone");
  r = await sel(page, "body");
  ok(r.bg === DAY.bg && r.fg === DAY.fg, `${scheme} tap page (always Day): selection ${r.bg} on ${r.fg}`);
  await page.goto(base + "/card?l=stagingone");
  await page.waitForSelector(".card");
  r = await sel(page, ".card");
  ok(r.bg === DAY.bg && r.fg === DAY.fg, `${scheme} card (always Day): selection ${r.bg} on ${r.fg}`);
}
await browser.close();
process.exit(bad ? 1 : 0);
