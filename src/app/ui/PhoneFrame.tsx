// The sample's phone: beside the wall on desktop, the "Try a tap" button and a
// sheet on phones, as sample.html does it (plan 3.10, look.md section 9).
import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Icon } from "./icons";

export function PhoneFrame({ open, onOpen, onClose, src }: { open: boolean; onOpen: () => void; onClose: () => void; src: string }): JSX.Element {
  useEffect(() => {
    // "Not now" or "Done" on the tap page closes the sheet, so the wall and the banner are visible.
    const onMsg = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.ci === "closed") onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("message", onMsg);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("message", onMsg);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <>
      <div class="phone-wrap">
        <div class="hint">
          <Icon name="phone" size={16} />A customer's phone. Tap a post.
        </div>
        <div class="phone">
          <iframe class="screen" src={src} title="The tap page, on a customer's phone" />
        </div>
      </div>
      <button class="fab" onClick={onOpen}>
        <Icon name="phone" size={20} />
        Try a tap
      </button>
      {open && (
        <div class="sheet" role="dialog" aria-label="The tap page">
          <button class="close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
          <iframe class="screen" src={src} title="The tap page" />
        </div>
      )}
    </>
  );
}
