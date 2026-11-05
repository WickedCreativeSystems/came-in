// The landing page (plan 3.1), the privacy page and the photo credits. They follow the system, Day or After close.
import { esc, page, BELL_SVG } from "./html";

const SITE_CSS = `
.wrap{max-width:1240px;margin:0 auto;padding:0 24px}
@media (max-width:720px){.wrap{padding:0 16px}}
.top{display:flex;align-items:center;justify-content:space-between;height:64px;border-bottom:1px solid var(--rule)}
.wm{display:inline-flex;align-items:center;gap:8px;font-family:var(--fd);font-weight:800;font-size:13px;letter-spacing:.04em;text-transform:uppercase;text-decoration:none}
.wm svg{width:22px;height:22px}
.hero{padding:64px 0 48px;max-width:760px}
.hero h1{margin:0 0 16px;font-family:var(--fd);font-weight:700;font-size:40px;line-height:1.02;letter-spacing:-.005em}
.hero p{margin:0 0 24px;color:var(--ink-2);font-size:16px;max-width:620px}
.bs{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.cap{margin:12px 0 0;font-size:13px;line-height:1.4;color:var(--ink-2);max-width:52ch}
.bs{flex-direction:row}
@media (max-width:480px){.bs{flex-direction:column;align-items:stretch;gap:8px}.bs .btn{justify-content:center}}
.cap.free{margin-top:4px;max-width:none}
@media (max-width:720px){.hero{padding:32px 0}.hero h1{font-size:30px}}
.loop{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:0 0 64px}
.loop figure{margin:0}
.loop img{width:100%;height:auto;border-radius:4px;border:1px solid var(--rule);background:var(--paper-2);aspect-ratio:4/3;object-fit:cover;object-position:top}
.loop figcaption{font-size:13px;color:var(--ink-2);margin-top:8px}
@media (max-width:720px){.loop{grid-template-columns:1fr;gap:24px}}
.why{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:0 0 64px}
.why p{margin:8px 0 0}
@media (max-width:720px){.why{grid-template-columns:1fr}}
.foot{border-top:1px solid var(--rule);padding:16px 0 32px;font-size:11px;line-height:1.3;color:var(--ink-2);display:flex;gap:8px 16px;flex-wrap:wrap}
.foot a{color:var(--ink-2)}
.prose .body{font-size:16px;font-weight:400;margin:0 0 8px}
.prose .price{font-family:var(--fd);font-weight:700;font-size:22px;line-height:1.2;margin:16px 0}
.prose{max-width:560px}
.strip{margin:24px 0 0;border:1px solid var(--rule);border-radius:4px;padding:12px 16px;font-size:14px}
.prose{max-width:640px;padding:48px 0 64px}
.prose h1{margin:0 0 24px;font-family:var(--fd);font-weight:700;font-size:28px;line-height:1.02}
.prose p{margin:0 0 16px}
.prose ul{padding-left:20px}
.prose li{margin:0 0 8px}
`;

function header(): string {
  return `<header class="top"><a class="wm" href="/">${BELL_SVG}<span>Came In</span></a><a class="btn" href="/auth/start" style="height:36px">Connect Buffer</a></header>`;
}

export function footer(contactEmail: string | null, opts: { photoCredits?: boolean } = {}): string {
  const contact = contactEmail ? `<a href="mailto:${esc(contactEmail)}">Contact</a>` : "";
  return `<footer class="foot"><span>Anonymous. A post, a time, nothing else.</span><a href="/privacy">Privacy</a><a href="/pricing">Pricing</a>${contact}<span>Built for Buffer Commit 2026</span>${opts.photoCredits ? `<a href="/credits">Photo credits</a>` : ""}</footer>`;
}

export function renderLanding(opts: { error?: "denied" | "exchange" | "signedout" | null; contactEmail: string | null }): string {
  const strip =
    opts.error === "denied"
      ? `<div class="strip" role="status">No problem. Nothing was connected.</div>`
      : opts.error === "exchange"
        ? `<div class="strip" role="alert">Buffer didn't finish connecting. Try again.</div>`
        : opts.error === "signedout"
          ? `<div class="strip" role="status">Signed out. Connect Buffer to come back in.</div>`
          : "";
  const body = `<div class="wrap">${header()}<main>${strip}
<section class="hero"><h1>Find out which of your posts bring people through the door.</h1>
<p>Came In reads the posts you've already sent through Buffer, the app many shops use to schedule posts. Customers (or your staff) tap the one that brought them in. Your phone rings.</p>
<div class="bs"><a class="btn primary" href="/sample">Try the sample bakery</a><a class="btn" href="/auth/start">Connect Buffer</a></div>
<div class="cap">Connect Buffer takes you to Buffer to sign in. Came In only reads your posts and channels.</div>
<div class="cap free">Free for one location. <a href="/pricing">Pricing</a></div></section>
<section class="loop" aria-label="How it works">
<figure><img src="/landing/card.jpg" alt="The printed card on a shop counter: Saw us online? Tap the post that brought you in." width="800" height="600" loading="lazy"><figcaption>The card on your counter.</figcaption></figure>
<figure><img src="/landing/tap.jpg" alt="A phone showing the shop's posts as tiles to tap." width="800" height="600" loading="lazy"><figcaption>A customer taps the post they saw.</figcaption></figure>
<figure><img src="/landing/bell.jpg" alt="The shop's wall with the bell banner: Someone just came in because of Tuesday's sourdough post." width="800" height="600" loading="lazy"><figcaption>Your phone rings.</figcaption></figure>
</section>
<section class="why">
<div><div class="eyebrow">Every week</div><p>See which posts bring people in, and post more like them.</p></div>
<div><div class="eyebrow">Honest</div><p>It counts people at the door, not likes.</p></div>
<div><div class="eyebrow">Private</div><p>Taps are anonymous. A post, a time, nothing else.</p></div>
</section></main>
${footer(opts.contactEmail, { photoCredits: true })}</div>`;
  return page({
    title: "Came In",
    description: "Find out which of your posts bring people through the door. Built on Buffer.",
    css: SITE_CSS,
    body,
    followSystem: true,
  });
}

export function renderPrivacy(contactEmail: string | null): string {
  const body = `<div class="wrap">${header()}<main><article class="prose">
<h1>Privacy</h1>
<p>Came In reads the posts you've already sent through Buffer, and the name and logo of your channels, and keeps a copy so your card works.</p>
<p>A customer's tap stores the post, the time, where the tap came from (the card, the counter or your booking page) and a random id their phone keeps so the thank-you shows once a day. No name, no number, no email, no location.</p>
<p>For a post with a picture or video, its picture and words are sent once to Anthropic, only to give the post a short name. Nothing else is sent, and nothing about a customer.</p>
<p>We write to your Buffer only when you press a button or when the "Mark winners in Buffer" switch is on.</p>
<p>"Disconnect and delete everything" removes all of it, including Came In's notes in Buffer.</p>
<p>Questions: the contact line below.</p>
</article></main>${footer(contactEmail)}</div>`;
  return page({ title: "Privacy · Came In", css: SITE_CSS, body, followSystem: true });
}

/** The sample bakery's photo credits, as credited in LookieBot's sample.html (plan section 0). */
export function renderCredits(contactEmail: string | null): string {
  const cc0 = [
    "Loaf of sourdough bread cooling",
    "Sourdough bread loaf",
    "Croissants au beurre (18953292873)",
    "Cinnamon Roll - Olea 2025-07-03",
    "Cinnamon bun - Black Mocha 2024-01-08",
    "Bavarian pretzels",
    "Apple cake with vanilla ice cream 2",
    "Piece of chocolate cake on a white plate",
    "Oatmeal cookies on a plate",
  ];
  const ccby = ["Closeup of a cup of latte art with coffee powder", "Baker woman's hands kneading bread dough", "Baguettes - stonesoup"];
  const li = (t: string) => `<li><a href="https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(t)}&title=Special:MediaSearch&type=image">${esc(t)}</a></li>`;
  const body = `<div class="wrap">${header()}<main><article class="prose">
<h1>Photo credits</h1>
<p>The sample bakery's photos are from Wikimedia Commons. They stand in for the sample bakery's posts.</p>
<p><strong>CC0</strong></p><ul>${cc0.map(li).join("")}</ul>
<p><strong>CC BY 2.0</strong> (<a href="https://creativecommons.org/licenses/by/2.0/">license</a>)</p><ul>${ccby.map(li).join("")}</ul>
<p>Fonts: Big Shoulders and Libre Franklin, from Google Fonts, under the SIL Open Font License.</p>
</article></main>${footer(contactEmail)}</div>`;
  return page({ title: "Photo credits · Came In", css: SITE_CSS, body, followSystem: true });
}


/** The price as a person reads it: "$9" whether the secret says 9 or $9. */
export function priceLabel(v: string | undefined | null): string | null {
  const t = (v ?? "").trim();
  if (!t || t.length > 24) return null;
  return t.startsWith("$") ? t : `$${t}`;
}

/** Only a Stripe-hosted link is used as the Pay button. */
export function paymentLink(v: string | undefined | null): string | null {
  try {
    const u = new URL((v ?? "").trim());
    return u.protocol === "https:" && (u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com")) ? u.href : null;
  } catch {
    return null;
  }
}

/** /pricing (plan 3.13): One location is free; with a price and a Payment Link, what more cost and where to pay. We don't check payments. */
export function renderPricing(opts: { price: string | null; link: string | null; contactEmail: string | null }): string {
  const paid = !!(opts.price && opts.link);
  const more = paid
    ? `<p class="price">More locations are ${esc(opts.price!)} a month each.</p>
<p class="body">A location is a store with its own card, whether it shares your posts or has its own.</p>
<p><a class="btn primary" href="${esc(opts.link!)}" target="_blank" rel="noopener">Pay for more locations</a></p>
<p class="cap">After you pay, add your next location from Setup, under Locations. We don't check payments, so you won't be locked out.</p>`
    : `<p class="price">Need more than one location? Write to us.</p>${opts.contactEmail ? `<p><a href="mailto:${esc(opts.contactEmail)}">${esc(opts.contactEmail)}</a></p>` : ""}`;
  const body = `<div class="wrap">${header()}<main><article class="prose">
<h1>Pricing</h1>
<p class="body">One location is free, with everything in it.</p>
${more}
</article></main>${footer(opts.contactEmail)}</div>`;
  return page({ title: "Pricing · Came In", css: SITE_CSS, body, followSystem: true });
}
