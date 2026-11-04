// Small helpers for the server-rendered pages: the tap page, landing,
// privacy and credits. Everything that goes into HTML passes through esc().

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON for a <script type="application/json"> block, safe against </script>. */
export function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** The brass bell (look.md section 7): dome brass, lip and clapper brass-deep, a brass-tint highlight. */
export const BELL_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4.5c.9 0 1.6.7 1.6 1.6v1.2c5.3.8 9.2 5.3 9.2 10.8v7.3l3 4.2H6.2l3-4.2v-7.3C9.2 12.6 13.1 8.1 18.4 7.3V6.1c0-.9.7-1.6 1.6-1.6z" fill="var(--brass,#C4912C)"/><path d="M6.2 29.6h27.6v2.1H6.2z" fill="var(--brass-deep,#9A6F1C)"/><circle cx="20" cy="34.4" r="2.6" fill="var(--brass-deep,#9A6F1C)"/><path d="M12.5 17.8c.6-3.6 3.2-6.3 6.5-7.1" stroke="var(--brass-tint,#F6EBD0)" stroke-width="1.4" stroke-linecap="round" fill="none" opacity=".8"/></svg>`;

/** The monochrome stroke bell (1.6px) for the Came In mark and the header count. */
export const BELL_MONO_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a1 1 0 0 1 1 1v.6a6.5 6.5 0 0 1 5.5 6.4v4.2L20 17.5H4l1.5-2.3V11A6.5 6.5 0 0 1 11 4.6V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 20.2a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export const FONT_PRELOADS = `<link rel="preload" href="/fonts/big-shoulders-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/libre-franklin-latin.woff2" as="font" type="font/woff2" crossorigin>`;

export const FONT_FACES = `@font-face{font-family:"Big Shoulders";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/big-shoulders-latin.woff2) format("woff2")}@font-face{font-family:"Libre Franklin";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/libre-franklin-latin.woff2) format("woff2")}`;

/** The Day tokens only: the tap page, the card and the landing are always Day (look.md section 2). */
export const DAY_TOKENS = `:root{--paper:#F4F2ED;--paper-2:#ECE9E2;--paper-3:#E2DED5;--label:#FFFFFF;--label-ink:#231F1B;--ink:#231F1B;--ink-2:#6E665D;--ink-3:#A69E93;--rule:#D8D3CA;--rule-2:#C9C3B8;--brass:#C4912C;--brass-deep:#9A6F1C;--brass-tint:#F6EBD0;--stamp:#9B2B1E;--stamp-tint:#F7E4E0;--focus:#231F1B;--fd:"Big Shoulders","Arial Narrow",sans-serif;--ft:"Libre Franklin","Franklin Gothic","Helvetica Neue",Arial,sans-serif;--settle:cubic-bezier(.2,.8,.2,1);--fold:cubic-bezier(.6,0,.2,1);color-scheme:light}`;

export const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;font-feature-settings:"tnum" 1,"kern" 1;-webkit-font-smoothing:antialiased}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--ft);font-size:16px;line-height:1.45}img{display:block;max-width:100%}button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}a{color:inherit}:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:3px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border-radius:3px;border:1.5px solid var(--ink);background:var(--paper);color:var(--ink);font-weight:600;font-size:15px;line-height:1;white-space:nowrap;text-decoration:none;transition:background 200ms var(--settle),transform 120ms var(--settle)}.btn:hover{background:var(--paper-3)}.btn:active{transform:translateY(1px)}.btn.primary{background:var(--ink);color:var(--paper)}.btn.primary:hover{background:var(--ink-2);border-color:var(--ink-2)}.eyebrow{font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);line-height:1}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`;

export function page(opts: { title: string; description?: string; css: string; body: string; script?: string; head?: string; lang?: string }): string {
  return `<!doctype html><html lang="${opts.lang ?? "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(opts.title)}</title>${opts.description ? `<meta name="description" content="${esc(opts.description)}">` : ""}<meta name="theme-color" content="#F4F2ED"><link rel="icon" href="/icon.svg" type="image/svg+xml">${FONT_PRELOADS}${opts.head ?? ""}<style>${FONT_FACES}${DAY_TOKENS}${BASE_CSS}${opts.css}</style></head><body>${opts.body}${opts.script ? `<script>${opts.script}</script>` : ""}</body></html>`;
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s&]/gu, " ").split(/\s+/).filter((w) => w && w !== "&");
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

/** The shop's avatar: its logo, or its initials on brass (look.md: the avatar fallback is brass). */
export function avatarHtml(name: string, url: string | null, size: number): string {
  const style = `width:${size}px;height:${size}px`;
  if (url) return `<img class="av" src="${esc(url)}" alt="" width="${size}" height="${size}" style="${style}">`;
  return `<span class="av av-f" aria-hidden="true" style="${style};font-size:${Math.round(size * 0.46)}px">${esc(initials(name))}</span>`;
}

export const AVATAR_CSS = `.av{border-radius:50%;object-fit:cover;flex:none;background:var(--paper-2)}.av-f{display:grid;place-items:center;background:var(--brass);color:#231F1B;font-family:var(--fd);font-weight:800;letter-spacing:.02em}`;
