// The staff screen, route /c (plan 3.6, look.md "The staff screen"). Always Day, server-rendered.
import { esc, jsonForScript, page, avatarHtml, AVATAR_CSS } from "./html";
import type { TapTile } from "./tap";
import { tileLabel } from "../../shared/names";

export interface CounterPageData {
  shop: { name: string; handle: string; avatarUrl: string | null };
  tiles: TapTile[];
  token: string;
  endpoint: string;
  owner: boolean;
  closeEndpoint: string | null;
  wallUrl: string;
  sample: boolean;
  /** With two or more locations, the one this screen is at. */
  locationLabel?: string | null;
}

const CSS = `${AVATAR_CSS}
body{min-height:100dvh;display:flex;flex-direction:column}
html{scrollbar-width:none}html::-webkit-scrollbar{display:none}
.hd{display:flex;align-items:center;gap:10px;padding:18px 16px 10px}
.nm{font-family:var(--fd);font-weight:700;font-size:22px;line-height:1;letter-spacing:.005em}
.hn{font-size:13px;color:var(--ink-2);line-height:1.3;margin-top:3px}
.mk{margin-left:auto}
.ask{padding:0 16px 12px}
.ask h1{margin:0;font-family:var(--fd);font-weight:700;font-size:24px;line-height:1;letter-spacing:-.005em}
.grid{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:8px;padding:0 16px 12px;align-content:start}
@media (orientation:landscape) and (min-width:700px){.grid{grid-template-columns:repeat(4,minmax(160px,1fr))}}
@media (max-width:520px){.grid{grid-template-columns:repeat(2,1fr)}}
.t{text-align:left;width:100%;display:flex;flex-direction:column;gap:6px;transition:transform 120ms var(--settle)}
.pic{position:relative;aspect-ratio:1;border-radius:4px;overflow:hidden;background:var(--paper-2);width:100%;flex:none}
.cn{font-size:13px;line-height:1.25;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.t img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.t:active{transform:scale(.97)}
.t{container-type:inline-size}
.bgs{display:none}
@container (max-width:179px){.bgl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.bgs{display:inline}}
.bd{position:absolute;top:8px;left:8px;height:22px;padding:0 7px;border-radius:2px;background:var(--label);color:var(--label-ink);font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase;display:inline-flex;align-items:center;line-height:1}
.tx{position:absolute;inset:0;padding:38px 14px 14px;font-family:var(--fd);font-weight:700;font-size:22px;line-height:1.02;letter-spacing:-.005em;color:var(--ink);overflow:hidden;overflow-wrap:anywhere}
.rw{position:sticky;bottom:0;background:var(--paper);padding:4px 16px 16px}
.or{margin:0 0 8px;font-size:14px;color:var(--ink-2)}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.t.chk .pic{box-shadow:inset 0 0 0 2px var(--ink)}
.t.chk .pic::after{content:"";position:absolute;left:50%;top:50%;width:32px;height:32px;margin:-16px 0 0 -16px;border-radius:50%;background:var(--ink) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23F4F2ED' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-7'/%3E%3C/svg%3E") center/16px no-repeat;animation:chk 200ms var(--settle) 1}
@keyframes chk{from{transform:scale(.6)}to{transform:scale(1)}}
.row .btn{height:56px;white-space:normal;text-align:center;line-height:1.15;padding:0 8px}
.ft{padding:4px 16px 16px;font-size:13px}
.ft button,.ft>a{color:var(--ink-2);text-decoration:underline;font-size:13px}
.menu{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.menu[hidden]{display:none}
.ok{position:sticky;top:0;z-index:4;margin:0 16px 12px;height:56px;display:flex;align-items:center;gap:12px;background:var(--paper-2);color:var(--ink);border:1px solid var(--rule);border-radius:3px;padding:0 12px;font-weight:600;font-size:16px;opacity:0;transform:translateY(6px);transition:transform 260ms var(--settle),opacity 260ms var(--settle)}
.ok.in{transform:none;opacity:1}
.ok.out{transform:translateY(0);opacity:0;transition:opacity 200ms var(--fold)}
.ok img{width:40px;height:40px;border-radius:3px;object-fit:cover;flex:none}
.strip{position:fixed;z-index:6;left:16px;right:16px;top:12px;border:1px solid var(--stamp);background:var(--stamp-tint);color:var(--stamp);border-radius:4px;padding:10px 12px;font-size:14px}
.strip[hidden]{display:none}
.gone{padding:32px 16px}
.gone h1{margin:0 0 12px;font-family:var(--fd);font-weight:700;font-size:28px;line-height:1}
@media (prefers-reduced-motion:reduce){.ok,.ok.in,.ok.out{transition:none;transform:none}.t.chk::after{animation:none}.t{transition:none}.t:active{transform:none}}
`;

function tileHtml(t: TapTile, i: number): string {
  const inner = t.imageUrl ? `<img src="${esc(t.imageUrl)}" alt="" ${i < 8 ? "" : 'loading="lazy"'} decoding="async">` : `<span class="tx">${esc(t.text)}</span>`;
  return `<button class="t" data-i="${esc(t.id)}" data-n="${esc(t.name)}"${t.imageUrl ? ` data-img="${esc(t.imageUrl)}"` : ""} aria-label="${esc(tileLabel(t.name))}"><span class="pic">${inner}<span class="bd"><span class="bgl">${esc(t.badge)}</span><span class="bgs" aria-hidden="true">${esc(t.badgeShort)}</span></span></span><span class="cn">${esc(tileLabel(t.name))}</span></button>`;
}

export function renderCounterPage(d: CounterPageData): string {
  const body = `<header class="hd">${avatarHtml(d.shop.name, d.shop.avatarUrl, 40)}<div><div class="nm">${esc(d.shop.name)}</div>${d.shop.handle ? `<div class="hn">@${esc(d.shop.handle)}</div>` : ""}</div><span class="eyebrow mk">Staff screen${d.locationLabel ? ` · ${esc(d.locationLabel)}` : ""}</span></header>
<div class="ask"><h1>What brought them in?</h1></div>
<div class="ok" id="ok" role="status" aria-live="polite"></div>
<div class="grid" id="g">${d.tiles.map(tileHtml).join("")}</div>
<div class="rw"><p class="or">Or, if it wasn't a post:</p><div class="row"><button class="btn" data-a="walked_past" data-n="Walked past">Walked past</button><button class="btn" data-a="friend" data-n="A friend told them">A friend told them</button><button class="btn" data-a="google" data-n="Found us on Google">Found us on Google</button></div></div>
<div class="ft">${
    d.owner
      ? `<button id="own" aria-expanded="false">Owner</button><div class="menu" id="menu" hidden>${d.closeEndpoint ? `<button class="btn" id="cls">Close the staff screen on this device</button>` : ""}<a class="btn quiet" href="${esc(d.wallUrl)}">Back to the wall</a></div>`
      : `<a href="/">Owner</a>`
  }</div>
<div class="strip" id="err" hidden role="alert">We couldn't reach the shop. Try again?</div>
<script type="application/json" id="cfg">${jsonForScript({ token: d.token, ep: d.endpoint, close: d.closeEndpoint, wall: d.wallUrl })}</script>`;
  return page({ title: `${d.shop.name}: staff screen`, css: CSS, body, script: COUNTER_SCRIPT, head: `<meta name="robots" content="noindex">` });
}

export function renderCounterClosed(): string {
  return page({
    title: "Came In: staff screen",
    css: CSS,
    body: `<div class="gone"><h1>This staff screen was closed. Open it again from Setup.</h1><a class="btn" href="/setup#staff">Open Setup</a></div>`,
    head: `<meta name="robots" content="noindex">`,
  });
}

const COUNTER_SCRIPT = `(function(){
var C=JSON.parse(document.getElementById('cfg').textContent),$=function(i){return document.getElementById(i)};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
var dev=ls('ci_device');if(!dev){var a=new Uint8Array(16);crypto.getRandomValues(a);dev=Array.from(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('');ls('ci_device',dev)}
var ok=$('ok'),err=$('err'),busy=false,t1,t2,rm=matchMedia('(prefers-reduced-motion: reduce)').matches;
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var mark=null;function confirm(text,img,tileEl){clearTimeout(t1);clearTimeout(t2);if(mark)mark.classList.remove('chk');mark=tileEl||null;if(mark)mark.classList.add('chk');ok.className='ok';ok.innerHTML=(img?'<img src="'+e(img)+'" alt="">':'')+'<span>'+e(text)+'</span>';
requestAnimationFrame(function(){requestAnimationFrame(function(){ok.classList.add('in')})});
var at=Date.now();t1=setTimeout(function(){ok.classList.add('out');if(mark){mark.classList.remove('chk');mark=null}t2=setTimeout(function(){ok.className='ok';ok.innerHTML='';setTimeout(function(){busy=false},Math.max(0,3050-(Date.now()-at)))},rm?0:200)},2000)}
function send(b,tries){fetch(C.ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),keepalive:true}).then(function(r){
if(r.status===409||r.status===410){location.reload();return}if(r.status>=500)throw 0;err.hidden=true}).catch(function(){
if(tries<5)setTimeout(function(){send(b,tries+1)},(tries+1)*2000);else err.hidden=false})}
function tap(answer,tile,label,img,el){if(busy)return;busy=true;
confirm('Got it. '+label+'.',img,el);
send({token:C.token,tile:tile,answer:answer,device:dev},0)}
$('g').addEventListener('click',function(ev){var b=ev.target.closest('.t');if(!b)return;var n=b.dataset.n;tap('post',b.dataset.i,n.charAt(0).toUpperCase()+n.slice(1),b.dataset.img||null,b)});
document.querySelectorAll('.row .btn').forEach(function(b){b.onclick=function(){tap(b.dataset.a,null,b.dataset.n,null)}});
var own=$('own');if(own)own.onclick=function(){var m=$('menu');m.hidden=!m.hidden;this.setAttribute('aria-expanded',String(!m.hidden))};
var cls=$('cls');if(cls)cls.onclick=function(){cls.disabled=true;fetch(C.close,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:C.token}),credentials:'same-origin'}).then(function(){location.href=C.wall})};
})();`;
