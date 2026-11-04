// The printed card (plan 3.11, look.md section 4; P8). Always Day. A6 by
// default, A5 and 4×6 in on switches. Sized in millimetres so it prints true;
// every look.md value is for A6 and scales with the paper.
import { esc, jsonForScript, page, avatarHtml, AVATAR_CSS, BELL_MONO_SVG } from "./html";

export type CardSize = "a6" | "a5" | "4x6";

export const CARD_SIZES: Record<CardSize, { label: string; w: number; h: number; page: string }> = {
  a6: { label: "A6", w: 105, h: 148, page: "105mm 148mm" },
  a5: { label: "A5", w: 148, h: 210, page: "148mm 210mm" },
  "4x6": { label: "4×6 in", w: 101.6, h: 152.4, page: "4in 6in" },
};

export function cardSize(v: string | undefined | null): CardSize {
  return v === "a5" || v === "4x6" ? v : "a6";
}

export interface CardData {
  shop: { name: string; handle: string; avatarUrl: string | null };
  qrSvg: string;
  size: CardSize;
  printedEndpoint: string;
  backUrl: string;
  sizeHref: (s: CardSize) => string;
}

// look.md section 4: the card is drawn 298 units wide, and every value is in
// those units. One unit is the card's width / 298 (A6 0.3523 mm, A5 0.4966 mm,
// 4×6 in 0.3409 mm); everything scales by it, type included.
function css(size: CardSize): string {
  const s = CARD_SIZES[size];
  const u = `calc(${s.w}mm / 298)`;
  return `${AVATAR_CSS}
:root{--u:${u}}
body{background:var(--paper-2)}
.bar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:16px 24px;background:var(--paper);border-bottom:1px solid var(--rule)}
.bar h1{margin:0 auto 0 0;font-family:var(--fd);font-weight:700;font-size:24px;line-height:1}
.sizes{display:inline-flex;gap:4px}
.sizes a{text-decoration:none;font-weight:600;font-size:14px;padding:8px 10px;border-radius:3px;color:var(--ink-2);border:1px solid var(--rule)}
.sizes a[aria-current]{color:var(--paper);background:var(--ink);border-color:var(--ink)}
.stage{padding:32px 16px 64px;display:grid;place-items:center;overflow:auto}
.note{text-align:center;color:var(--ink-2);font-size:13px;margin:0 16px 32px}
.card{width:${s.w}mm;height:${s.h}mm;background:#FFF;color:#231F1B;border-radius:3px;box-shadow:0 1px 0 rgba(0,0,0,.08),0 12px 30px -12px rgba(0,0,0,.35);padding:calc(28 * var(--u)) calc(24 * var(--u));display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;overflow:hidden}
.card .av{width:calc(48 * var(--u))!important;height:calc(48 * var(--u))!important;font-size:calc(22 * var(--u))!important;margin:0 0 calc(10 * var(--u));-webkit-print-color-adjust:exact;print-color-adjust:exact}
.card .nm{font-family:var(--fd);font-weight:700;font-size:calc(28 * var(--u));line-height:1;letter-spacing:.005em}
.card .hn{font-size:calc(12 * var(--u));line-height:1.2;color:#6E665D;margin:calc(3 * var(--u)) 0 calc(22 * var(--u))}
.card .ask{font-family:var(--fd);font-weight:700;font-size:calc(34 * var(--u));line-height:.98;letter-spacing:-.005em;margin:0 0 calc(6 * var(--u))}
.card .sub{font-size:calc(13 * var(--u));color:#6E665D;margin:0 0 calc(18 * var(--u));line-height:1.3}
.card .qr{width:calc(132 * var(--u));height:calc(132 * var(--u));border:1px solid #D8D3CA;border-radius:3px;padding:calc(6 * var(--u));background:#FFF;flex:none}
.card .qr svg{width:100%;height:100%;display:block;shape-rendering:crispEdges}
.card .ci{margin-top:auto;line-height:1;display:inline-flex;align-items:center;gap:calc(6 * var(--u));font-family:var(--fd);font-weight:800;font-size:calc(13 * var(--u));letter-spacing:.04em;text-transform:uppercase;color:#6E665D}
.card .ci svg{width:calc(14 * var(--u));height:calc(14 * var(--u))}
.card .punch{position:absolute;top:calc(12 * var(--u));left:50%;width:calc(9 * var(--u));height:calc(9 * var(--u));border-radius:50%;background:#ECE9E2;box-shadow:inset 0 1px 1px rgba(0,0,0,.15);transform:translateX(-50%)}
@page{size:${s.page};margin:0}
@media print{
  html,body{background:none!important}
  .bar,.note{display:none!important}
  .stage{padding:0;display:block}
  .card{box-shadow:none;border-radius:0;margin:0;color:#000;page-break-inside:avoid}
  .card .hn,.card .sub,.card .ci{color:#000}
  .card .qr{border-color:#000}
  .card .punch{box-shadow:none;border:.2mm solid #999;background:none}
}
`;
}

export function renderCard(d: CardData): string {
  const sizes = (Object.keys(CARD_SIZES) as CardSize[])
    .map((k) => `<a href="${esc(d.sizeHref(k))}"${k === d.size ? ' aria-current="page"' : ""}>${CARD_SIZES[k].label}</a>`)
    .join("");
  const body = `<div class="bar"><h1>Your card</h1><nav class="sizes" aria-label="Paper size">${sizes}</nav>
<button class="btn primary" id="print">Print</button><button class="btn" id="pdf">Save as PDF</button><a class="btn quiet" href="${esc(d.backUrl)}">Back</a></div>
<div class="stage"><div class="card">
<span class="punch" aria-hidden="true"></span>
${avatarHtml(d.shop.name, d.shop.avatarUrl, 48)}
<div class="nm">${esc(d.shop.name)}</div>
${d.shop.handle ? `<div class="hn">@${esc(d.shop.handle)}</div>` : `<div class="hn"></div>`}
<p class="ask">Saw us online?</p>
<p class="sub">Tap the post that brought you in.<br>Three seconds, no app.</p>
<div class="qr" aria-label="QR code for the tap page">${d.qrSvg}</div>
<div class="ci">${BELL_MONO_SVG}<span>Came In</span></div>
</div></div>
<p class="note">It brands itself from your Buffer channel. Nothing to set up. Put it where people pay.</p>
<script type="application/json" id="cfg">${jsonForScript({ ep: d.printedEndpoint })}</script>`;
  const script = `(function(){var C=JSON.parse(document.getElementById('cfg').textContent);
function go(){try{fetch(C.ep,{method:'POST',credentials:'same-origin',keepalive:true})}catch(e){}window.print()}
document.getElementById('print').onclick=go;document.getElementById('pdf').onclick=go;
// On a phone the card is wider than the screen: show it scaled to fit, and print it at full size.
var card=document.querySelector('.card');function fit(){card.style.zoom='';var w=card.getBoundingClientRect().width,a=document.documentElement.clientWidth-32;if(w>a)card.style.zoom=a/w}
fit();addEventListener('resize',fit);addEventListener('beforeprint',function(){card.style.zoom=''});addEventListener('afterprint',fit);})();`;
  return page({ title: `${d.shop.name}: your card`, css: css(d.size), body, script, head: `<meta name="robots" content="noindex">` });
}
