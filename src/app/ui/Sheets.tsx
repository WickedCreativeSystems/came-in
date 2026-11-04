// The sheets of plan 3.7 and 3.9: Post it again, Post this, and the share images.
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { serviceName } from "@shared/marks";
import { api } from "../lib/api";
import { Mark } from "./marks";

export interface Channel {
  id: string;
  name: string;
  service: string;
  needsPhoto?: boolean;
  needsBoard?: boolean;
}

export type Outcome = "queued" | "approval" | "draft" | "failed" | "saved";

/** What a write-back says when it's done (plan 3.7, 3.9, 1.8). */
export function outcomeLine(o: Outcome): string {
  switch (o) {
    case "queued":
      return "Added to your Buffer queue.";
    case "approval":
      return "Sent to Buffer, waiting for approval.";
    case "draft":
      return "Saved as a draft in your Buffer.";
    case "saved":
      return "Saved to your Buffer Ideas.";
    default:
      return "Buffer didn't take that. Try again in a minute.";
  }
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: JSX.Element | (JSX.Element | false | null)[] }): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button, input, a")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <h2 class="h2">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ChannelToggles({ channels, on, setOn }: { channels: Channel[]; on: Set<string>; setOn: (s: Set<string>) => void }): JSX.Element {
  return (
    <ul class="ch-toggles">
      {channels.map((c) => (
        <li key={c.id}>
          <Mark service={c.service} />
          <span class="ch-label">
            {c.name}
            <span class="caption muted"> · {serviceName(c.service)}</span>
            {c.needsPhoto && <span class="eyebrow needs"> needs a photo</span>}
            {c.needsBoard && <span class="eyebrow needs"> needs a board in Buffer</span>}
          </span>
          <button
            class="toggle"
            role="switch"
            aria-checked={on.has(c.id)}
            aria-label={`${c.name} on ${serviceName(c.service)}`}
            disabled={c.needsPhoto || c.needsBoard}
            onClick={() => {
              const n = new Set(on);
              if (n.has(c.id)) n.delete(c.id);
              else n.add(c.id);
              setOn(n);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/** "Post it again to:" (plan 3.9): Instagram off and marked "needs a photo" if the post has none. */
export function PostAgainSheet({ endpoint, channels, onClose, onDone }: { endpoint: string; channels: Channel[]; onClose: () => void; onDone: (o: Outcome) => void }): JSX.Element {
  const [on, setOn] = useState(() => new Set(channels.filter((c) => !c.needsPhoto && !c.needsBoard).map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Post it again to:" onClose={onClose}>
      <ChannelToggles channels={channels} on={on} setOn={setOn} />
      <div class="btn-row">
        <button
          class="btn primary"
          disabled={busy || !on.size}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ outcome: Outcome }>(endpoint, { json: { channels: [...on] } });
              onDone(r.outcome);
            } catch {
              onDone("failed");
            }
          }}
        >
          {busy && <span class="spin" aria-hidden="true" />}
          Add to my Buffer queue
        </button>
        <button class="btn" onClick={onClose}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}

/** "Post this to:" (plan 3.7): channel toggles, the text, then Add to my Buffer queue. */
export function PostThisSheet({ endpoint, channels, text: initial, image, onClose, onDone }: { endpoint: string; channels: Channel[]; text: string; image: string; onClose: () => void; onDone: (o: Outcome) => void }): JSX.Element {
  const [on, setOn] = useState(() => new Set(channels.filter((c) => !c.needsBoard && c.service !== "youtube").map((c) => c.id)));
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Post this to:" onClose={onClose}>
      <ChannelToggles channels={channels} on={on} setOn={setOn} />
      <label class="sr" for="post-this-text">
        The post's text
      </label>
      <textarea id="post-this-text" class="input textarea" rows={3} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <div class="btn-row">
        <button
          class="btn primary"
          disabled={busy || !on.size}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ outcome: Outcome }>(endpoint, { json: { channels: [...on], text, image } });
              onDone(r.outcome);
            } catch {
              onDone("failed");
            }
          }}
        >
          {busy && <span class="spin" aria-hidden="true" />}
          Add to my Buffer queue
        </button>
        <button class="btn" onClick={onClose}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}
