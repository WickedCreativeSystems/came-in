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
  // Already in view with room to spare: no scroll, so it can rest higher than 16px. Otherwise it rests at 16px.
  ok(r.linkBottom <= r.barTop - 15, `${name}: Now try a tap is at least 16px clear of the bottom bar (${Math.round(r.barTop - r.linkBottom)}px)`);
  ok(r.linkTop > 0, `${name}: it is on screen`);
  const w = await page.evaluate(() => getComputedStyle(document.querySelector("p.has-hint b")).fontWeight);
  ok(w === "600", `${name}: "This browser will ring." is weight 600 (${w})`);
}
// The card's second line: two lines, no overflow, 18 units above the QR.
for (const size of ["a6", "a5", "4x6"]) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  await page.goto(base + "/sample/card?size=" + size);
  await page.waitForSelector(".card .sub");
  const r = await page.evaluate(() => {
    const card = document.querySelector(".card"), sub = document.querySelector(".card .sub"), qr = document.querySelector(".card .qr"), ci = document.querySelector(".card .ci");
    const u = parseFloat(getComputedStyle(sub).fontSize) / 12;
    const sb = sub.getBoundingClientRect(), cb = card.getBoundingClientRect(), q = qr.getBoundingClientRect(), m = ci.getBoundingClientRect();
    return { text: sub.innerText.replace(/\n/g, " | "), h: sb.height / u, gap: (q.top - sb.bottom) / u, left: sb.left - cb.left, right: cb.right - sb.right, scrollW: sub.scrollWidth, clientW: sub.clientWidth, markGap: (m.top - q.bottom) / u, over: card.scrollHeight > card.clientHeight };
  });
  ok(/^Scan, then tap the post that brought you in\. \| Three seconds, no app\.$/.test(r.text), `${size}: words (${r.text})`);
  ok(Math.abs(r.h - 31) < 1.5, `${size}: two lines, ${r.h.toFixed(1)} units tall`);
  ok(Math.abs(r.gap - 18) < 1.5, `${size}: ${r.gap.toFixed(1)} units above the QR`);
  ok(r.scrollW <= r.clientW + 1 && !r.over, `${size}: nothing overflows`);
}
await browser.close();
process.exit(bad ? 1 : 0);
