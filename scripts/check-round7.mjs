// Round seven (plan 3.9 Post it again channels, 3.11 two-location card) in a real browser.
// Usage: node scripts/check-round7.mjs https://came-in-staging.<subdomain>.workers.dev
import { chromium } from "playwright";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.error("Give the base URL."); process.exit(2); }
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

// 3.9: the sheet starts on the post's own channels only (the sample's channels: Instagram, Facebook, Google).
for (const [name, vp] of [["phone", { width: 390, height: 800 }], ["computer", { width: 1280, height: 900 }]]) {
  for (const [post, want] of [["sour", { Instagram: true, Facebook: true, Google: false }], ["hours", { Instagram: false, Facebook: true, Google: true }]]) {
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    await page.goto(`${base}/sample/post/${post}`);
    await page.click("button:has-text('Post it again')");
    await page.waitForSelector(".sheet-panel .ch-toggles li");
    const rows = await page.evaluate(() => [...document.querySelectorAll(".ch-toggles li")].map((li) => ({ t: li.innerText.replace(/\s+/g, " "), on: li.querySelector("button.toggle").getAttribute("aria-checked") === "true", dis: li.querySelector("button.toggle").disabled })));
    for (const [svc, on] of Object.entries(want)) {
      const r = rows.find((x) => x.t.toLowerCase().includes(svc.toLowerCase()));
      ok(r && r.on === on, `${name} ${post}: ${svc} starts ${on ? "on" : "off"}`);
    }
    ok(await page.locator(".sheet-note").count() === 0, `${name} ${post}: no extra line when its own channels can take it`);
    await page.close();
  }
  // From This week, the tile's own channels
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  await page.goto(`${base}/sample/week`);
  await page.waitForSelector(".week-tile");
  await page.locator(".week-tile button[aria-label='Post it again']").first().click();
  await page.waitForSelector(".sheet-panel .ch-toggles li");
  const on = await page.evaluate(() => [...document.querySelectorAll(".ch-toggles li")].filter((li) => li.querySelector("button.toggle").getAttribute("aria-checked") === "true").length);
  const all = await page.locator(".ch-toggles li").count();
  ok(on >= 1 && on < all, `${name} week tile: ${on} of ${all} channels start on, not all`);
  await page.close();
}

// 3.11: the two-location card, emulated on the sample card (a shop with two locations adds the name line and the "two" class).
for (const size of ["a6", "a5", "4x6"]) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  await page.goto(`${base}/sample/card?size=${size}`);
  await page.waitForSelector(".card .sub");
  const measure = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s), r = (e) => e.getBoundingClientRect();
    const card = q(".card"), sub = q(".card .sub"), qr = q(".card .qr"), ci = q(".card .ci"), hn = q(".card .hn"), loc = q(".card .loc");
    const u = parseFloat(getComputedStyle(sub).fontSize) / 12;
    return { u, gap: (r(qr).top - r(sub).bottom) / u, qrTop: (r(qr).top - r(card).top) / u, markBottom: (r(ci).bottom - r(card).top) / u, cardH: r(card).height / u, markUnder: (r(card).bottom - r(ci).bottom) / u, markGap: (r(ci).top - r(qr).bottom) / u, locH: loc ? r(loc).height / u : 0, locUnderHandle: loc ? (r(loc).top - r(hn).bottom) / u : 0, locFont: loc ? getComputedStyle(loc).fontWeight + " " + parseFloat(getComputedStyle(loc).fontSize) / u + " " + getComputedStyle(loc).fontFamily : "", over: card.scrollHeight > card.clientHeight };
  });
  const one = await measure();
  ok(Math.abs(one.gap - 18) < 1.5, `${size} one location: ${one.gap.toFixed(1)} units above the QR (unchanged)`);
  await page.evaluate(() => {
    document.querySelector(".card").classList.add("two");
    document.querySelector(".card .hn").classList.add("tight");
    const l = document.createElement("div"); l.className = "loc"; l.textContent = "Downtown";
    document.querySelector(".card .hn").after(l);
  });
  const two = await measure();
  ok(Math.abs(two.locH - 14.4) < 0.8, `${size} two locations: name line ${two.locH.toFixed(1)} units tall`);
  ok(Math.abs(two.locUnderHandle - 3) < 0.8, `${size} two locations: name ${two.locUnderHandle.toFixed(1)} units under the handle`);
  ok(/^600 12 .*Libre Franklin/.test(two.locFont), `${size} two locations: name is ${two.locFont}`);
  ok(Math.abs(two.gap - 9) < 1.2, `${size} two locations: ${two.gap.toFixed(1)} units above the QR`);
  ok(Math.abs(two.markGap - one.markGap) < 1, `${size} two locations: mark ${two.markGap.toFixed(1)} units under the QR (one location ${one.markGap.toFixed(1)})`);
  ok(Math.abs(two.markUnder - 19.6) < 1.5 || size !== "a6", `${size} two locations: ${two.markUnder.toFixed(1)} units under the mark`);
  ok(!two.over && two.markBottom <= two.cardH, `${size} two locations: nothing overflows`);
  if (size === "a6") ok(Math.abs(two.qrTop - 250.4) < 1.5, `a6 two locations: QR frame top ${two.qrTop.toFixed(1)} (look.md 250.4)`);
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
