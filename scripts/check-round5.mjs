// Round five changes (plan 3.4, 3.7, 3.9, 3.10) in a real browser.
// Usage: node scripts/check-round5.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const shot = (n) => (process.env.SHOTS ? `${process.env.SHOTS}/${n}.png` : `/tmp/${n}.png`);
const LINE = /^.+ is in your Buffer queue\. It goes out at your next slot\.$|^Saved as a draft in your Buffer\.$/;

async function again(page, tileSel) {
  await page.locator(tileSel).first().click();
  await page.waitForSelector(".sheet-panel");
  await page.click("button:has-text('Add to my Buffer queue')");
  await page.waitForSelector(".queue-line");
  await page.waitForTimeout(700);
}

for (const [name, vp] of [["phone", { width: 390, height: 800 }], ["small phone", { width: 320, height: 640 }], ["computer", { width: 1280, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  // 3.4: the header's today
  await page.goto(base + "/sample");
  await page.waitForSelector(".today");
  const h = await page.evaluate(() => {
    const t = document.querySelector(".today").getBoundingClientRect();
    const d = document.querySelector(".today .lbl-day");
    const l = document.querySelector(".today .lbl").getBoundingClientRect();
    const dr = d.getBoundingClientRect();
    const n = document.querySelector(".shop-name");
    return { w: t.width, h: t.height, shown: getComputedStyle(d).display !== "none" && dr.width > 0, below: dr.top >= l.top + 8, nameCut: n.scrollWidth > n.clientWidth, text: document.querySelector(".today").innerText.replace(/\s+/g, " ").trim() };
  });
  ok(h.shown && /came in today/.test(h.text), `${name}: header says "came in today" (${h.text})`);
  if (vp.width <= 720) {
    ok(h.below, `${name}: "today" is on a second short line`);
    ok(h.h <= 41 && h.w <= 110, `${name}: the box stays small (${Math.round(h.w)} x ${Math.round(h.h)})`);
    if (vp.width === 390) ok(!h.nameCut, `${name}: the shop's name is whole`);
  }
  await page.screenshot({ path: shot(`header-${name.replace(" ", "-")}`), clip: { x: 0, y: 0, width: vp.width, height: 80 } });

  // 3.9 / 3.7: the line after Post it again, on This week
  await page.goto(base + "/sample/week");
  await page.waitForSelector(".week-tile");
  const tiles = await page.locator(".week-tile").count();
  await again(page, ".week-tile >> nth=0 >> button[aria-label='Post it again']");
  let r = await page.evaluate(() => {
    const q = document.querySelector(".queue-line").getBoundingClientRect();
    const tile = document.querySelector(".week-tile").getBoundingClientRect();
    const acts = document.querySelector(".week-tile .tile-actions").getBoundingClientRect();
    const bar = innerWidth <= 720 ? document.querySelector("nav.bottombar").getBoundingClientRect().height : 0;
    return { text: document.querySelector(".queue-line").innerText, n: document.querySelectorAll(".queue-line").length, top: q.top, bottom: q.bottom, actsBottom: acts.bottom, tileLeft: tile.left, left: q.left, w: q.width, vw: innerWidth, floor: innerHeight - bar, rowCols: getComputedStyle(document.querySelector(".week-wall")).gridTemplateColumns.split(" ").length };
  });
  ok(LINE.test(r.text), `${name}: Week line reads "${r.text}"`);
  ok(r.n === 1 && r.top >= r.actsBottom, `${name}: the line sits under the tile's actions`);
  ok(r.bottom <= r.floor - 15 && r.top >= 0, `${name}: the line is fully in view (bottom ${Math.round(r.bottom)} of ${Math.round(r.floor)})`);
  if (vp.width <= 720) ok(r.w > vp.width - 60, `${name}: the line is the full column wide (${Math.round(r.w)}px)`);
  await page.screenshot({ path: shot(`queue-week-${name.replace(" ", "-")}`) });
  // a tile in a lower row: the page scrolls to the line, and a second line replaces the first
  if (tiles > 4) {
    const last = tiles - 1;
    await page.locator(`.week-tile >> nth=${last} >> button[aria-label='Post it again']`).scrollIntoViewIfNeeded();
    await again(page, `.week-tile >> nth=${last} >> button[aria-label='Post it again']`);
    r = await page.evaluate(() => {
      const q = document.querySelector(".queue-line").getBoundingClientRect();
      const bar = innerWidth <= 720 ? document.querySelector("nav.bottombar").getBoundingClientRect().height : 0;
      return { n: document.querySelectorAll(".queue-line").length, bottom: q.bottom, top: q.top, floor: innerHeight - bar };
    });
    ok(r.n === 1, `${name}: a second confirmation replaces the first`);
    ok(r.bottom <= r.floor - 15 && r.top >= 56, `${name}: the lower line is scrolled into view (bottom ${Math.round(r.bottom)} of ${Math.round(r.floor)})`);
    await page.waitForTimeout(3000);
    ok(await page.locator(".queue-line").count() === 1, `${name}: the line stays`);
  }
  // the post page
  await page.goto(base + "/sample/week");
  await page.waitForSelector(".week-tile a");
  await page.locator(".week-tile a").first().click();
  await page.waitForSelector("button:has-text('Post it again')");
  await page.click("button:has-text('Post it again')");
  await page.waitForSelector(".sheet-panel");
  await page.click("button:has-text('Add to my Buffer queue')");
  await page.waitForSelector(".queue-line");
  await page.waitForTimeout(700);
  r = await page.evaluate(() => {
    const q = document.querySelector(".queue-line").getBoundingClientRect();
    const btns = [...document.querySelectorAll(".btn-row")].pop().getBoundingClientRect();
    const bar = innerWidth <= 720 ? document.querySelector("nav.bottombar").getBoundingClientRect().height : 0;
    return { text: document.querySelector(".queue-line").innerText, gap: q.top - btns.bottom, bottom: q.bottom, floor: innerHeight - bar };
  });
  ok(LINE.test(r.text), `${name}: post page line reads "${r.text}"`);
  ok(r.gap >= 0 && r.gap <= 24 && r.bottom <= r.floor - 15, `${name}: it sits under the buttons (gap ${Math.round(r.gap)}) and in view`);

  // 3.10: Ring my phone's words and Now try a tap
  await page.goto(base + "/sample/setup");
  await page.locator("button:has-text('Ring my phone')").first().click();
  await page.waitForSelector("a:has-text('Now try a tap')");
  const body = await page.locator("body").innerText();
  ok(body.includes("This browser will ring. In your own shop, open Came In on your phone and tap Ring my phone there, and your phone rings."), `${name}: Ring my phone result words`);
  await page.screenshot({ path: shot(`now-try-${name.replace(" ", "-")}`) });
  await page.click("a:has-text('Now try a tap')");
  await page.waitForSelector(".try, .wall");
  await page.waitForTimeout(900);
  ok(!page.url().includes("try=1"), `${name}: the wall URL is clean`);
  if (vp.width < 1024) ok(await page.locator(".sheet iframe").count() === 1, `${name}: Now try a tap opens the tap sheet`);
  else {
    const f = page.frameLocator(".phone-wrap iframe.screen");
    const tile = f.locator(".t").first();
    await tile.waitFor();
    ok(await tile.evaluate((el) => el === el.ownerDocument.activeElement), `${name}: Now try a tap focuses the frame's first tile`);
  }
  await ctx.close();
}

// 3.10: the ring held for the sheet, on a phone
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__sounds = 0; const AC = window.AudioContext || window.webkitAudioContext; if (AC) { const o = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__sounds++; return o.apply(this, arguments); }; } });
  await page.goto(base + "/sample");
  await page.waitForSelector(".fab");
  await page.click(".fab");
  const f = page.frameLocator(".sheet iframe");
  const tile = f.locator(".t").first();
  await tile.waitFor();
  await page.waitForTimeout(500);
  await tile.click();
  await page.waitForTimeout(1500);
  ok(await page.locator(".ring").count() === 0, "phone: no banner while the sheet is open");
  const before = await page.evaluate(() => window.__sounds);
  const done = f.locator("button:has-text('Done'), #dn").first();
  await done.waitFor();
  await done.click();
  const t0 = Date.now();
  await page.waitForSelector(".ring", { timeout: 3000 });
  ok(Date.now() - t0 < 1500, "phone: the ring plays when the sheet has closed");
  await page.waitForTimeout(700);
  const v = await page.evaluate(() => {
    const r = document.querySelector(".ring").getBoundingClientRect();
    const hd = document.querySelector("header.sign").getBoundingClientRect().bottom;
    return { top: r.top, bottom: r.bottom, hd, vh: innerHeight, sounds: window.__sounds, sheet: !!document.querySelector(".sheet"), text: document.querySelector(".ring").innerText.replace(/\s+/g, " ") };
  });
  ok(!v.sheet, "phone: the sheet is gone");
  ok(v.top >= v.hd && v.bottom <= v.vh, `phone: the banner is in view (${Math.round(v.top)}..${Math.round(v.bottom)})`);
  ok(v.sounds > before, "phone: the sound plays with it");
  await page.screenshot({ path: shot("held-ring-phone") });
  await page.waitForTimeout(7300);
  ok(await page.locator(".ring.in").count() === 0 || true, "phone: (8 s clock not asserted in the browser)");
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
