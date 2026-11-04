// The bell banner (look.md sections 5 and 9): in flow above the heading row,
// 8 s, dismissable, a second ring replaces the sentence and restarts the clock.
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Bell } from "./glyphs";
import { Icon } from "./icons";
import { reducedMotion } from "../lib/theme";

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
  useEffect(() => {
    if (!ring) return;
    setPhase("enter");
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("in")));
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
    setTimeout(onGone, reducedMotion() ? 0 : 320);
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
    <div class={`ring ${phase}`} role="status" key={ring.key}>
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
