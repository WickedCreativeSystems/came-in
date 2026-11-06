// Bring a line into view the way look.md asks: only if it is not fully in view, until its bottom edge is 16px
// above the bottom bar (or the window's bottom), over 320ms, or at once with motion off.
import { reducedMotion } from "./theme";

export function scrollIntoRoom(el: HTMLElement | null): void {
  if (!el) return;
  const header = document.querySelector("header.sign")?.getBoundingClientRect().bottom ?? 64;
  const phone = innerWidth <= 720;
  const bar = phone ? document.querySelector("nav.bottombar")?.getBoundingClientRect().height ?? 0 : 0;
  const fab = phone ? (document.querySelector(".fab")?.getBoundingClientRect().height ?? 0) : 0;
  // Measure where the line will rest: it may still be rising (translateY) when this runs.
  const rise = new DOMMatrix(getComputedStyle(el).transform).m42;
  const box = el.getBoundingClientRect();
  const r = { top: box.top - rise, bottom: box.bottom - rise, right: box.right };
  const floor = innerHeight - bar - 16;
  let delta = 0;
  if (r.bottom > floor) delta = r.bottom - floor;
  else if (r.top < header + 8) delta = r.top - (header + 8);
  // The "Try a tap" button floats over the bottom right of the sample on a phone: keep the line clear of it too.
  if (!delta && fab && r.bottom > floor - fab - 8 && r.right > innerWidth - 200) delta = r.bottom - (floor - fab - 8);
  if (Math.abs(delta) < 2) return;
  if (reducedMotion()) {
    window.scrollBy(0, delta);
    return;
  }
  const from = window.scrollY;
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / 320);
    window.scrollTo(0, from + delta * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
