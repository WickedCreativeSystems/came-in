// The counter screen (plan 3.6, look.md section 4). Always Day, server-rendered.
import { esc, jsonForScript, page, avatarHtml, AVATAR_CSS } from "./html";
import type { TapTile } from "./tap";

export interface CounterPageData {
  shop: { name: string; handle: string; avatarUrl: string | null };
  tiles: TapTile[];
  token: string;
  endpoint: string;
  owner: boolean;
  closeEndpoint: string | null;
  wallUrl: string;
  sample: boolean;
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
.t{position:relative;aspect-ratio:1;border-radius:4px;overflow:hidden;background:var(--paper-2);text-align:left;width:100%;display:block;transition:transform 120ms var(--settle)}
.t img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.t:active{transform:scale(.97)}
.bd{position:absolute;top:8px;left:8px;height:22px;padding:0 7px;border-radius:2px;background:var(--label);color:var(--label-ink);font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase;display:inline-flex;align-items:center;line-height:1}
.tx{position:absolute;inset:0;padding:38px 14px 14px;font-family:var(--fd);font-weight:700;font-size:22px;line-height:1.02;letter-spacing:-.005em;color:var(--ink);overflow:hidden;overflow-wrap:anywhere}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:4px 16px 16px;position:sticky;bottom:0;background:var(--paper)}
.row .btn{height:56px;white-space:normal;text-align:center;line-height:1.15;padding:0 8px}
.ft{padding:4px 16px 16px;font-size:13px}
.ft button{color:var(--ink-2);text-decoration:underline;font-size:13px}
.menu{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.menu[hidden]{display:none}
.ok{position:fixed;left:16px;right:16px;top:12px;z-index:5;display:flex;align-items:center;gap:12px;background:var(--label);color:var(--label-ink);border:1px solid var(--rule-2);border-radius:4px;padding:10px 14px;font-weight:600;font-size:16px;transform:translateY(-8px);opacity:0;transition:transform 260ms var(--settle),opacity 260ms var(--settle);pointer-events:none}
.ok.in{transform:none;opacity:1}
.ok.out{transform:translateY(-6px);opacity:0;transition:transform 320ms var(--fold),opacity 320ms var(--fold)}
.ok img{width:44px;height:44px;border-radius:3px;object-fit:cover;flex:none}
.strip{position:fixed;z-index:6;left:16px;right:16px;top:12px;border:1px solid var(--stamp);background:var(--stamp-tint);color:var(--stamp);border-radius:4px;padding:10px 12px;font-size:14px}
.strip[hidden]{display:none}
.gone{padding:32px 16px}
.gone h1{margin:0 0 12px;font-family:var(--fd);font-weight:700;font-size:28px;line-height:1}
@media (prefers-reduced-motion:reduce){.ok,.ok.in,.ok.out{transition:none;transform:none}.t{transition:none}.t:active{transform:none}}
`;

function tileHtml(t: TapTile, i: number): string {
  const inner = t.imageUrl ? `<img src="${esc(t.imageUrl)}" alt="" ${i < 8 ? "" : 'loading="lazy"'} decoding="async">` : `<span class="tx">${esc(t.text)}</span>`;
  return `<button class="t" data-i="${esc(t.id)}" data-n="${esc(t.name)}"${t.imageUrl ? ` data-img="${esc(t.imageUrl)}"` : ""} aria-label="${esc(t.name)}">${inner}<span class="bd">${esc(t.badge)}</span></button>`;
}

export function renderCounterPage(d: CounterPageData): string {
  const body = `<header class="hd">${avatarHtml(d.shop.name, d.shop.avatarUrl, 40)}<div><div class="nm">${esc(d.shop.name)}</div>${d.shop.handle ? `<div class="hn">@${esc(d.shop.handle)}</div>` : ""}</div><span class="eyebrow mk">Counter</span></header>
<div class="ask"><h1>What brought them in?</h1></div>
<div class="grid" id="g">${d.tiles.map(tileHtml).join("")}</div>
<div class="row"><button class="btn" data-a="walked_past" data-n="Walked past">Walked past</button><button class="btn" data-a="friend" data-n="A friend told them">A friend told them</button><button class="btn" data-a="google" data-n="Found us on Google">Found us on Google</button></div>
<div class="ft"><button id="own" aria-expanded="false">Owner</button><div class="menu" id="menu" hidden>${
    d.owner
      ? `${d.closeEndpoint ? `<button class="btn" id="cls">Close the counter on this device</button>` : ""}<a class="btn quiet" href="${esc(d.wallUrl)}">Back to the wall</a>`
      : `<a class="btn quiet" href="${esc(d.wallUrl)}">Back to the wall</a>`
  }</div></div>
<div class="ok" id="ok" role="status" aria-live="polite"></div>
<div class="strip" id="err" hidden role="alert">We couldn't reach the shop. Try again?</div>
<script type="application/json" id="cfg">${jsonForScript({ token: d.token, ep: d.endpoint, close: d.closeEndpoint, wall: d.wallUrl })}</script>`;
  return page({ title: `${d.shop.name}: counter`, css: CSS, body, script: COUNTER_SCRIPT, head: `<meta name="robots" content="noindex">` });
}

export function renderCounterClosed(): string {
  return page({
    title: "Came In: counter",
    css: CSS,
    body: `<div class="gone"><h1>This counter was closed. Open it again from Setup.</h1><a class="btn" href="/setup#counter">Open Setup</a></div>`,
    head: `<meta name="robots" content="noindex">`,
  });
}

const COUNTER_SCRIPT = `(function(){
var C=JSON.parse(document.getElementById('cfg').textContent),$=function(i){return document.getElementById(i)};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
var dev=ls('ci_device');if(!dev){var a=new Uint8Array(16);crypto.getRandomValues(a);dev=Array.from(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('');ls('ci_device',dev)}
var ok=$('ok'),err=$('err'),busy=false,t1,t2,rm=matchMedia('(prefers-reduced-motion: reduce)').matches;
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function confirm(text,img){clearTimeout(t1);clearTimeout(t2);ok.style.top=Math.max(12,Math.round($('g').getBoundingClientRect().top))+'px';ok.className='ok';ok.innerHTML=(img?'<img src="'+e(img)+'" alt="">':'')+'<span>'+e(text)+'</span>';
requestAnimationFrame(function(){requestAnimationFrame(function(){ok.classList.add('in')})});
t1=setTimeout(function(){ok.classList.add('out');t2=setTimeout(function(){ok.className='ok';ok.innerHTML='';busy=false},rm?0:320)},2000)}
function send(b,tries){fetch(C.ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),keepalive:true}).then(function(r){
if(r.status===409||r.status===410){location.reload();return}if(r.status>=500)throw 0;err.hidden=true}).catch(function(){
if(tries<5)setTimeout(function(){send(b,tries+1)},(tries+1)*2000);else err.hidden=false})}
function tap(answer,tile,label,img){if(busy)return;busy=true;
confirm(tile?'Got it. '+label+'.':'Got it. '+label+'.',img);
send({token:C.token,tile:tile,answer:answer,device:dev},0)}
$('g').addEventListener('click',function(ev){var b=ev.target.closest('.t');if(!b)return;var n=b.dataset.n;tap('post',b.dataset.i,n.charAt(0).toUpperCase()+n.slice(1),b.dataset.img||null)});
document.querySelectorAll('.row .btn').forEach(function(b){b.onclick=function(){tap(b.dataset.a,null,b.dataset.n,null)}});
$('own').onclick=function(){var m=$('menu');m.hidden=!m.hidden;this.setAttribute('aria-expanded',String(!m.hidden))};
var cls=$('cls');if(cls)cls.onclick=function(){cls.disabled=true;fetch(C.close,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:C.token}),credentials:'same-origin'}).then(function(){location.href=C.wall})};
})();`;
