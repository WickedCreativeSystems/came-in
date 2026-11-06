// look.md, Setup LOCATIONS: Rename opens a 40px input, focused, with the name selected; Esc closes it unchanged.
// Usage: node scripts/check-rename-select.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const vw of [390, 1280]) {
  const page = await (await browser.newContext({ viewport: { width: vw, height: 844 } })).newPage();
  await page.goto(base + "/staging/shops");
  await page.goto(base + "/setup");
  await page.waitForSelector(".loc-row .loc-name");
  const name = (await page.locator(".loc-row .loc-name").first().textContent()).trim();
  await page.locator(".loc-row button", { hasText: "Rename" }).first().click();
  await page.waitForSelector(".loc-row input");
  const r = await page.evaluate(() => { const el = document.activeElement; return { input: el?.tagName === "INPUT", value: el?.value, s: el?.selectionStart, e: el?.selectionEnd, h: el?.getBoundingClientRect().height }; });
  ok(r.input && r.value === name, `${vw}: Rename's input is focused and holds "${r.value}"`);
  ok(r.s === 0 && r.e === name.length, `${vw}: the whole name is selected (${r.s}–${r.e} of ${name.length})`);
  ok(Math.round(r.h) === 40, `${vw}: the input is ${r.h}px tall`);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".loc-row input", { state: "detached" });
  ok((await page.locator(".loc-row .loc-name").first().textContent()).trim() === name, `${vw}: Esc closes it, name unchanged`);
}
await browser.close();
process.exit(bad ? 1 : 0);
