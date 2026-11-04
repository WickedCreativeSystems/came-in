// The share image (look.md section 5; P14): 1080×1920 for a story and
// 1080×1080 for a feed post, drawn on a canvas with the page's own fonts.
export interface ShareInput {
  photoUrl: string | null;
  text: string;
  people: number;
  shopName: string;
  avatarUrl: string | null;
}

const PAPER = "#F4F2ED";
const PAPER2 = "#ECE9E2";
const INK = "#231F1B";
const INK2 = "#6E665D";
const BRASS = "#C4912C";
const BRASS_DEEP = "#9A6F1C";

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function bell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = BRASS;
  ctx.fill(new Path2D("M20 4.5c.9 0 1.6.7 1.6 1.6v1.2c5.3.8 9.2 5.3 9.2 10.8v7.3l3 4.2H6.2l3-4.2v-7.3C9.2 12.6 13.1 8.1 18.4 7.3V6.1c0-.9.7-1.6 1.6-1.6z"));
  ctx.fillStyle = BRASS_DEEP;
  ctx.fill(new Path2D("M6.2 29.6h27.6v2.1H6.2z"));
  ctx.beginPath();
  ctx.arc(20, 34.4, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function textTile(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = PAPER2;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = INK;
  ctx.font = `700 ${Math.round(w / 9)}px "Big Shoulders", "Arial Narrow", sans-serif`;
  wrap(ctx, text, x + w * 0.08, y + h * 0.14, w * 0.84, Math.round(w / 9) * 1.05, 6);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number): number {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  ctx.textBaseline = "top";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lh);
      line = w;
      lines++;
      if (lines >= maxLines) return lines;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + lines * lh), lines++;
  return lines;
}

async function avatar(ctx: CanvasRenderingContext2D, url: string | null, name: string, x: number, y: number, d: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  ctx.clip();
  const img = url ? await load(url) : null;
  if (img) cover(ctx, img, x, y, d, d);
  else {
    ctx.fillStyle = BRASS;
    ctx.fillRect(x, y, d, d);
    const ini = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    ctx.fillStyle = INK;
    ctx.font = `800 ${Math.round(d * 0.46)}px "Big Shoulders", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ini, x + d / 2, y + d / 2 + d * 0.02);
    ctx.textAlign = "left";
  }
  ctx.restore();
}

function caption(n: number): string {
  return n === 1 ? "person came in because of this post" : "people came in because of this post";
}

export async function drawShare(kind: "story" | "square", s: ShareInput): Promise<Blob> {
  await document.fonts.ready;
  const W = 1080;
  const H = kind === "story" ? 1920 : 1080;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const photo = s.photoUrl ? await load(s.photoUrl) : null;
  if (kind === "story") {
    // The top post's photo fills the top 60%.
    const ph = Math.round(H * 0.6);
    if (photo) cover(ctx, photo, 0, 0, W, ph);
    else textTile(ctx, s.text, 0, 0, W, ph);
    const x = 96;
    let y = ph + 72;
    ctx.fillStyle = INK;
    ctx.textBaseline = "top";
    ctx.font = `800 240px "Big Shoulders", sans-serif`;
    ctx.fillText(String(s.people), x - 6, y);
    y += 230;
    ctx.font = `700 64px "Big Shoulders", sans-serif`;
    y += wrap(ctx, caption(s.people), x, y, W - 2 * x, 66, 2) * 66 + 56;
    await avatar(ctx, s.avatarUrl, s.shopName, x, y, 96);
    ctx.fillStyle = INK;
    ctx.font = `700 64px "Big Shoulders", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(s.shopName, x + 124, y + 50);
    bell(ctx, x, H - 120, 44);
    ctx.fillStyle = INK2;
    ctx.font = `800 34px "Big Shoulders", sans-serif`;
    ctx.fillText("CAME IN", x + 56, H - 96);
  } else {
    // The photo on the left half.
    if (photo) cover(ctx, photo, 0, 0, W / 2, H);
    else textTile(ctx, s.text, 0, 0, W / 2, H);
    const x = W / 2 + 64;
    let y = 120;
    ctx.fillStyle = INK;
    ctx.textBaseline = "top";
    ctx.font = `800 220px "Big Shoulders", sans-serif`;
    ctx.fillText(String(s.people), x - 6, y);
    y += 216;
    ctx.font = `700 52px "Big Shoulders", sans-serif`;
    y += wrap(ctx, caption(s.people), x, y, W / 2 - 112, 56, 3) * 56 + 56;
    await avatar(ctx, s.avatarUrl, s.shopName, x, y, 80);
    ctx.fillStyle = INK;
    ctx.font = `700 48px "Big Shoulders", sans-serif`;
    ctx.textBaseline = "middle";
    wrap(ctx, s.shopName, x + 100, y + 18, W / 2 - 212, 50, 2);
    bell(ctx, x, H - 112, 40);
    ctx.fillStyle = INK2;
    ctx.font = `800 30px "Big Shoulders", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText("CAME IN", x + 52, H - 90);
  }
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"));
}
