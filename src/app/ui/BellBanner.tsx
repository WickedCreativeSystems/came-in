// The bell banner (look.md sections 5 and 9): in flow above the heading row,
// 8 s, dismissable, a second ring replaces the sentence and restarts the clock.
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Bell } from "./glyphs";
import { Icon } from "./icons";
import { reducedMotion } from "../lib/theme";

/**
 * When a ring arrives and the banner is not fully on screen (on a phone it sits below the try strip and the
 * setup chips), scroll so it sits 8px under the header: smoothly, or at once with motion off. It never ends up
 * under the bottom bar or the Try a tap button. A banner already in view does not move the page.
 */
function reveal(el: HTMLElement | null): void {
  if (!el) return;
  const header = document.querySelector("header.sign")?.getBoundingClientRect().bottom ?? 64;
  const top = header + 8;
  const phone = innerWidth <= 720;
  const bar = phone ? document.querySelector("nav.bottombar")?.getBoundingClientRect().height ?? 0 : 0;
  const fab = phone ? (document.querySelector(".fab")?.getBoundingClientRect().height ?? 0) + 16 : 0;
  const r = el.getBoundingClientRect();
  if (r.top >= top - 1 && r.bottom <= innerHeight - bar - fab) return;
  const delta = r.top - top;
  if (reducedMotion() || Math.abs(delta) < 2) {
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

export interface Ring {
  key: number;
  sentence: string;
  where: string;
  imageUrl: string | null;
  href: string | null;
}

export function BellBanner({ ring, onGone }: { ring: Ring | null; onGone: () => void }): JSX.Element | null {
  const [phase, setPhase] = useState<"in" | "out" | "enter">("enter");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const showing = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ring) return;
    let raf = 0;
    if (!showing.current) {
      showing.current = true;
      setPhase("enter");
      // The first ring brings the banner into view; a later one that only replaces its sentence does not.
      raf = requestAnimationFrame(() => requestAnimationFrame(() => { setPhase("in"); reveal(box.current); }));
    } else setPhase("in");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fold(), 8000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer.current);
    };
  }, [ring?.key]);
  function fold() {
    clearTimeout(timer.current);
    setPhase("out");
    setTimeout(() => {
      showing.current = false;
      onGone();
    }, reducedMotion() ? 0 : 320);
  }
  if (!ring) return null;
  const body = (
    <>
      <Bell class="bell" />
      <div class="line">
        {ring.sentence}
        <span class="where">{ring.where}</span>
      </div>
      {ring.imageUrl && <img class="thumb" src={ring.imageUrl} alt="" />}
    </>
  );
  return (
    <div class={`ring ${phase}`} role="status" ref={box}>
      {ring.href ? (
        <a class="ring-body" href={ring.href}>
          {body}
        </a>
      ) : (
        <div class="ring-body">{body}</div>
      )}
      <button class="x" aria-label="Dismiss" onClick={fold}>
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}
