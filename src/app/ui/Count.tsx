// A number that ticks (look.md section 6): the old number slides up and out,
// the new one slides in from below, 220 ms settle, inside a clipped box.
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { reducedMotion } from "../lib/theme";

export function TickNumber({ value, class: cls }: { value: number; class?: string }): JSX.Element {
  const [shown, setShown] = useState(value);
  const [next, setNext] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (value === shown) return;
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    setNext(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setShown(value);
      setNext(null);
    }, 240);
    return () => clearTimeout(timer.current);
  }, [value]);
  return (
    <span class={`tick ${cls ?? ""}${next !== null ? " ticking" : ""}`} aria-live="off">
      <span class="cur">{shown}</span>
      <span class="next" aria-hidden="true">{next ?? ""}</span>
    </span>
  );
}

const TILTS = [-1.5, 1, -0.8, 1.6, -1.2, 0.8];

/** The sticker: "N CAME IN", stuck on by hand, flashing brass when someone comes in. */
export function Sticker({ count, index, flash, onPaper }: { count: number; index: number; flash: boolean; onPaper: boolean }): JSX.Element {
  const zero = count === 0;
  return (
    <span
      class={`sticker${zero ? " zero" : ""}${zero && onPaper ? " on-paper" : ""}${flash ? " flash" : ""}`}
      style={{ "--tilt": `${TILTS[index % TILTS.length]}deg` }}
      aria-label={`${count === 1 ? "1 person" : `${count} people`} came in`}
    >
      <TickNumber value={count} class="n" />
      <span class="w">came in</span>
    </span>
  );
}
