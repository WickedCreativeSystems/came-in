// Plan 3.7: This week's tile buttons are named by the words that show, then the post (label in name).
// Usage: node scripts/check-button-names.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const [vw, again, more] of [[320, "Post again", "More like it"], [390, "Post again", "More like it"], [1280, "Post it again", "More like this"]]) {
  const page = await (await browser.newContext({ viewport: { width: vw, height: 900 } })).newPage();
  await page.goto(base + "/sample/week");
  await page.waitForSelector(".week-tile");
  const tiles = await page.locator(".week-tile").count();
  const names = await page.locator(".week-tile .tile-action").evaluateAll((bs) => bs.map((b) => ({ shown: b.innerText.trim() })));
  const a = page.getByRole("button", { name: new RegExp(`^${again}: .+ post$`) });
  const m = page.getByRole("button", { name: new RegExp(`^${more}: .+ post$`) });
  ok(await a.count() === tiles, `${vw}: ${await a.count()} of ${tiles} "${again}: …" names (first: "${await a.first().evaluate((b) => b.textContent.replace(/\s+/g, " ").trim())}")`);
  ok(await m.count() === tiles, `${vw}: ${await m.count()} of ${tiles} "${more}: …" names`);
  ok(names.every((n) => n.shown === again || n.shown === more || n.shown === "Show it again" || !n.shown.includes(":")), `${vw}: the post's name doesn't show (${[...new Set(names.map((n) => n.shown))].join(", ")})`);
  // voice control: "tap Post again" finds the button by the words it sees
  ok(await page.getByRole("button", { name: again }).count() >= tiles, `${vw}: "${again}" matches by its visible words`);
  // and the sheet still opens from it
  await a.first().click();
  ok(await page.waitForSelector(".sheet-panel", { timeout: 4000 }).then(() => true).catch(() => false), `${vw}: ${again} opens the sheet`);
}
await browser.close();
process.exit(bad ? 1 : 0);
