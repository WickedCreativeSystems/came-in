// The tap page (plan 3.5, look.md sections 4, 5, 6 and 9). Server-rendered,
// always Day, inline CSS and one small script, under 30 KB before images.
// The tap is answered on the phone before the network replies.
import { tileLabel } from "../../shared/names";
import { esc, jsonForScript, page, avatarHtml, initials, AVATAR_CSS, BELL_MONO_SVG } from "./html";

export interface TapTile {
  id: string;
  name: string; // "Tuesday's sourdough post"
  imageUrl: string | null;
  text: string; // first line, for text tiles
  badge: string; // "TUE", "OCT 28", "SENT TODAY"
  badgeShort: string; // on a tile under 180px: "NEW", "LIVE"
  live: boolean;
}

export interface TapPageData {
  mode: "shop" | "sample" | "embed";
  shop: { id: string; name: string; handle: string; avatarUrl: string | null; timezone: string };
  story: TapTile | null;
  tiles: TapTile[];
  thankYou: string | null;
  reviewUrl: string | null;
  tapEndpoint: string;
  source: "card" | "online" | "sample";
  deviceKey: string; // localStorage key for the device id
  showHeader: boolean;
}

const CSS = `${AVATAR_CSS}
body{min-height:100dvh;display:flex;flex-direction:column}
html,.th{scrollbar-width:none}html::-webkit-scrollbar,.th::-webkit-scrollbar{display:none}
.hd{display:flex;align-items:center;gap:10px;padding:18px 16px 10px}
.nm{font-family:var(--fd);font-weight:700;font-size:22px;line-height:1;letter-spacing:.005em}
.hn{font-size:13px;color:var(--ink-2);line-height:1.3;margin-top:3px}
.ask{padding:0 16px 12px}
.ask h1{margin:0;font-family:var(--fd);font-weight:700;font-size:28px;line-height:1;letter-spacing:-.005em}
.ask p{margin:4px 0 0;font-size:14px;color:var(--ink-2);line-height:1.4}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 10px 12px;flex:1;align-content:start}
.t{position:relative;aspect-ratio:1;border-radius:4px;overflow:hidden;background:var(--paper-2);text-align:left;width:100%;display:block;transition:transform 320ms var(--settle),opacity 200ms var(--settle)}
.t img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.t.st{grid-column:span 2;aspect-ratio:16/9}
.t:active{transform:scale(.97)}
.bd{position:absolute;top:8px;left:8px;height:20px;padding:0 6px;border-radius:2px;background:var(--label);color:var(--label-ink);font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;display:inline-flex;align-items:center;line-height:1}
.bd.lv{background:var(--brass)}
.t{container-type:inline-size}
.bs{display:none}
@container (max-width:179px){.bl{display:none}.bs{display:inline}}
.tx{position:absolute;inset:0;padding:34px 12px 12px;font-family:var(--fd);font-weight:700;font-size:19px;line-height:1.02;letter-spacing:-.005em;color:var(--ink);overflow:hidden;overflow-wrap:anywhere}
.picked .t{opacity:.35}
.picked .t.on{opacity:1;transform:scale(1.04);z-index:1}
.none{position:sticky;bottom:0;padding:8px 10px;background:var(--paper)}
.none .btn{width:100%;height:44px}
.ft{padding:10px 16px 14px;font-size:11px;line-height:1.3;color:var(--ink-3);display:flex;justify-content:space-between;align-items:center;gap:12px}
.ci{display:inline-flex;align-items:center;gap:5px;font-family:var(--fd);font-weight:800;font-size:13px;letter-spacing:.04em;color:var(--ink-2);white-space:nowrap}
.ci svg{width:13px;height:13px}
.th{position:fixed;inset:0;z-index:5;background:var(--paper);display:flex;flex-direction:column;transform:translateY(100%);transition:transform 320ms var(--settle);overflow:auto}
.th.in{transform:none}
.th[hidden]{display:none}
html.emb body{min-height:0}
html.emb .ph{height:160px;min-height:0}
html.emb .th{position:static;inset:auto;transform:none;transition:none;min-height:320px;overflow:visible}
html.emb #pg.away{display:none}
.ph{height:46%;min-height:180px;position:relative;overflow:hidden;background:var(--paper-2);flex:none}
.ph img{width:100%;height:100%;object-fit:cover}
.ph .tx{font-size:28px;padding:18px}
.bo{padding:16px;flex:1;display:flex;flex-direction:column;gap:12px;max-width:520px;width:100%;margin:0 auto}
.th h2{margin:0;font-family:var(--fd);font-weight:700;font-size:30px;line-height:1;letter-spacing:-.005em}
.th p{margin:0;font-size:14px;color:var(--ink-2);line-height:1.4}
.plain .bo{justify-content:center}
.tk{margin-top:auto;background:var(--label);color:var(--label-ink);border-radius:4px;padding:12px 14px;box-shadow:0 0 0 1px rgba(35,31,27,.12);-webkit-mask:radial-gradient(circle at 0 50%,transparent 7px,#000 7.5px),radial-gradient(circle at 100% 50%,transparent 7px,#000 7.5px);-webkit-mask-composite:source-in;mask:radial-gradient(circle at 0 50%,transparent 7px,#000 7.5px),radial-gradient(circle at 100% 50%,transparent 7px,#000 7.5px);mask-composite:intersect;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}
.tk .eyebrow{color:#6E665D;margin-bottom:4px}
.tk .w{font-family:var(--fd);font-weight:700;font-size:22px;line-height:1}
.tk .c{font-size:13px;color:#6E665D;margin-top:4px;line-height:1.3}
.tk>div:first-child{min-width:0}
.tk .d{font-size:11px;color:#6E665D;text-align:right;line-height:1.3;white-space:nowrap}
.tk .d b{display:block;font-family:var(--fd);font-weight:800;font-size:18px;color:#231F1B;letter-spacing:.02em}
.bs{display:flex;gap:8px}
.bs .btn{flex:1}
.rv{text-align:left}
.rv .who{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.rv h2{font-size:28px}
.strip{position:fixed;z-index:7;left:10px;right:10px;top:10px;border:1px solid var(--stamp);background:var(--stamp-tint);color:var(--stamp);border-radius:4px;padding:10px 12px;font-size:14px;display:flex;gap:10px;align-items:center;justify-content:space-between}
.strip[hidden]{display:none}
.strip .btn{height:32px;padding:0 12px;font-size:14px;color:var(--stamp);border-color:var(--stamp)}
.gone{padding:32px 16px}
.gone h1{margin:0;font-family:var(--fd);font-weight:700;font-size:28px;line-height:1}
@media (prefers-reduced-motion:reduce){.t,.th{transition:none}.picked .t.on{transform:none}.t:active{transform:none}}
`;

function tileHtml(t: TapTile, i: number, story: boolean): string {
  const eager = i < 6 ? `fetchpriority="${i < 2 ? "high" : "auto"}"` : `loading="lazy"`;
  const inner = t.imageUrl
    ? `<img src="${esc(t.imageUrl)}" alt="" ${eager} decoding="async">`
    : `<span class="tx">${esc(t.text)}</span>`;
  return `<button class="t${story ? " st" : ""}" data-i="${esc(t.id)}" data-n="${esc(t.name)}"${t.imageUrl ? ` data-img="${esc(t.imageUrl)}"` : ""} aria-label="${esc(tileLabel(t.name))}">${inner}<span class="bd${t.live ? " lv" : ""}"><span class="bl">${esc(t.badge)}</span><span class="bs">${esc(t.badgeShort)}</span></span></button>`;
}

export function renderTapPage(d: TapPageData): string {
  const head = d.showHeader
    ? `<header class="hd">${avatarHtml(d.shop.name, d.shop.avatarUrl, 40)}<div><div class="nm">${esc(d.shop.name)}</div>${d.shop.handle ? `<div class="hn">@${esc(d.shop.handle)}</div>` : ""}</div></header>`
    : "";
  const tiles = [d.story ? tileHtml(d.story, 0, true) : "", ...d.tiles.map((t, i) => tileHtml(t, i + (d.story ? 1 : 0), false))].join("");
  const body = `<div id="pg">${head}
<div class="ask"><h1>Saw us online?</h1><p>Tap the post that brought you in.</p></div>
<div class="grid" id="g">${tiles}</div>
<div class="none"><button class="btn" id="none">I didn't see a post</button></div>
<footer class="ft"><span>Anonymous. A post, a time, nothing else.</span><span class="ci">${BELL_MONO_SVG}CAME IN</span></footer>
</div>
<section class="th" id="th" hidden role="dialog" aria-modal="true" aria-label="Thanks"></section>
<div class="strip" id="err" hidden role="alert"><span>We couldn't reach the shop. Try again?</span><button class="btn" id="retry">Try again</button></div>
<script type="application/json" id="cfg">${jsonForScript({
    shop: d.shop.id,
    name: d.shop.name,
    avatar: d.shop.avatarUrl,
    ini: initials(d.shop.name),
    tz: d.shop.timezone,
    ty: d.thankYou,
    rv: d.reviewUrl,
    ep: d.tapEndpoint,
    src: d.source,
    dk: d.deviceKey,
    mode: d.mode,
  })}</script>`;
  return page({
    title: `${d.shop.name}: saw us online?`,
    description: `Tap the post that brought you in to ${d.shop.name}.`,
    css: CSS,
    body,
    script: TAP_SCRIPT,
    head: `<meta name="robots" content="noindex">`,
  });
}

export function renderGonePage(): string {
  return page({
    title: "Came In",
    css: CSS,
    body: `<div class="gone"><h1>This shop isn't using Came In any more.</h1></div>`,
    head: `<meta name="robots" content="noindex">`,
  });
}

// The script, kept small and dependency-free. It runs once per page.
const TAP_SCRIPT = `(function(){
var C=JSON.parse(document.getElementById('cfg').textContent),EMB=false,$=function(i){return document.getElementById(i)};
EMB=C.mode==='embed'&&parent!==window;if(EMB)document.documentElement.classList.add('emb');
var g=$('g'),th=$('th'),err=$('err'),busy=false,pending=null;
var rm=matchMedia('(prefers-reduced-motion: reduce)').matches;
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function rid(){var a=new Uint8Array(16);crypto.getRandomValues(a);return Array.from(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('')}
var dev=ls(C.dk);if(!dev){dev=rid();ls(C.dk,dev)}
function day(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:C.tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch(e){return new Date().toISOString().slice(0,10)}}
var tk='ci_t:'+C.dk+':'+C.shop;
function already(){return C.mode!=='sample'&&ls(tk)===day()}
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ticket(){if(!C.ty)return'';var d=new Date(),dd,tt;try{dd=d.toLocaleDateString('en-GB',{timeZone:C.tz,weekday:'short',day:'numeric',month:'short'}).replace(/,/g,'');tt=d.toLocaleTimeString('en-US',{timeZone:C.tz,hour:'numeric',minute:'2-digit'}).toLowerCase()}catch(x){dd=d.toDateString();tt=d.toTimeString().slice(0,5)}
return'<div class="tk"><div><div class="eyebrow">Today\\'s thank-you</div><div class="w">'+e(C.ty)+'</div><div class="c">Show this at the till.</div>'+(C.mode==='sample'?'<div class="c">Sample thank-you. You write your own.</div>':'')+'</div><div class="d">'+e(dd)+'<b>'+e(tt)+'</b></div></div>'}
var pg=$('pg'),last=null;
function show(html,plain){th.className='th'+(plain?' plain':'');th.innerHTML=html;th.hidden=false;pg.inert=true;if(EMB){pg.classList.add('away');window.rp&&window.rp(true)}setTimeout(function(){var f=th.querySelector('.btn');if(f)f.focus({preventScroll:true})},rm?0:330);if(rm){th.classList.add('in')}else{requestAnimationFrame(function(){requestAnimationFrame(function(){th.classList.add('in')})})}}
function close(){th.classList.remove('in');pg.inert=false;if(EMB)pg.classList.remove('away');setTimeout(function(){th.hidden=true;th.innerHTML='';if(EMB&&window.rp)window.rp(false)},rm?0:(EMB?0:320));g.classList.remove('picked');var o=g.querySelector('.on');if(o)o.classList.remove('on');busy=false;if(last&&last.focus)last.focus({preventScroll:true});
if(window.parent!==window){try{window.parent.postMessage({ci:'closed'},location.origin)}catch(x){}}}
function done(){if(C.rv){review()}else close()}
function review(){show('<div class="bo rv"><div class="who">'+(C.avatar?'<img class="av" src="'+e(C.avatar)+'" alt="" width="40" height="40" style="width:40px;height:40px">':'<span class="av av-f" aria-hidden="true" style="width:40px;height:40px;font-size:18px">'+e(C.ini)+'</span>')+'<span class="nm">'+e(C.name)+'</span></div><div><h2>Would you leave us a review?</h2><p>A line from you helps more than you\\'d think.</p></div><div class="bs"><a class="btn primary" id="lv" href="'+e(C.rv)+'" target="_blank" rel="noopener">Leave us a review</a><button class="btn" id="nn">Not now</button></div>'+(C.mode==='sample'?'<p>Sample review ask. You paste your own link in Setup.</p>':'')+'</div>',true);
$('nn').onclick=close;$('lv').addEventListener('click',function(){setTimeout(close,400)})}
function thanks(t,again){var ph=t?(t.img?'<div class="ph"><img src="'+e(t.img)+'" alt=""></div>':'<div class="ph"><span class="tx">'+e(t.text)+'</span></div>'):'';
var tick=(!again&&C.ty)?ticket():'';
var h=again?'Thanks again!':'Thanks!';
var line=t?'That was '+e(t.name)+'.':'Have a good one.';
show(ph+'<div class="bo"><div><h2>'+h+'</h2><p>'+line+'</p></div>'+tick+'<div class="bs"><button class="btn primary" id="dn">Done</button></div></div>',!t);
$('dn').onclick=again?close:done}
var tries=0;
function send(body){tries=0;pending=body;attempt()}
function attempt(){var b=pending;if(!b)return;fetch(C.ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),credentials:'same-origin',keepalive:true}).then(function(r){
if(r.status===410){location.reload();return}
if(r.status>=500)throw new Error('s'+r.status);return r.json()}).then(function(j){if(!j)return;pending=null;err.hidden=true;if(C.mode!=='sample'&&j.ok)ls(tk,day());
if(j.again){var h=th.querySelector('h2');if(h)h.textContent='Thanks again!';var k=th.querySelector('.tk');if(k)k.remove()}}).catch(function(){
tries++;if(tries<=5){setTimeout(attempt,tries*2000)}else{err.hidden=false}})}
$('retry').onclick=function(){err.hidden=true;tries=0;attempt()};
document.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&!th.hidden)close()});
g.addEventListener('click',function(ev){var b=ev.target.closest('.t');if(!b||busy)return;busy=true;
last=b;var t={id:b.dataset.i,name:b.dataset.n,img:b.dataset.img||null,text:(b.querySelector('.tx')||{}).textContent||''};
var again=already();g.classList.add('picked');b.classList.add('on');
setTimeout(function(){thanks(t,again)},rm?0:320);
if(!again)send({shop:C.shop,tile:t.id,answer:'post',source:C.src,device:dev})});
$('none').onclick=function(){if(busy)return;busy=true;last=$('none');var again=already();thanks(null,again);if(!again)send({shop:C.shop,tile:null,answer:'walked_past',source:C.src,device:dev})};
// Inside the embed, tell the page around us how tall we are (it sizes the frame).
if(EMB){var hh=0;window.rp=function(thanks){var h=Math.ceil(document.body.getBoundingClientRect().height);if(h!==hh||thanks){hh=h;parent.postMessage({cameIn:'height',h:h,thanks:!!thanks},'*')}};
var rp=window.rp;rp();addEventListener('load',function(){rp()});addEventListener('resize',function(){rp()});if(window.ResizeObserver)new ResizeObserver(function(){rp()}).observe(document.body)}
})();`;
