// The sheets of plan 3.7 and 3.9: Post it again, Post this, and the share images.
import { tileLabel } from "@shared/names";
import { scrollIntoRoom } from "../lib/scroll";
import { outcomeLine, resultLine, sentenceStart, type Outcome, type SheetResult } from "../lib/lines";

export { outcomeLine, resultLine };
export type { Outcome, SheetResult };
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { serviceName } from "@shared/marks";
import { api } from "../lib/api";
import { Mark } from "./marks";

export interface Channel {
  id: string;
  name: string;
  service: string;
  /** Why the server would refuse this channel, asked before the sheet opens (plan 3.9). */
  refusal?: "photo" | "video" | "board" | null;
}

const REFUSAL_WORDS = { photo: "needs a photo", video: "needs the video", board: "needs a board in Buffer" } as const;

function blocked(c: Channel): boolean {
  return !!c.refusal;
}

/**
 * The line a write-back leaves where the person acted (plan 3.9, look.md "Round five"): a paper strip with a bar
 * on its left edge. It arrives over 260ms, scrolls into view if it is not fully on screen, and stays until the page
 * is left. Mount it with a new key for each confirmation, so a second one replaces the first.
 */
export function QueueLine({ text, failed, name }: { text: string; failed?: boolean; name?: string }): JSX.Element {
  const box = useRef<HTMLParagraphElement>(null);
  // The post's name stands out in the line (weight 600), when the line is about the post.
  const lead = name && text.startsWith(sentenceStart(name)) ? sentenceStart(name) : "";
  useEffect(() => {
    const t = requestAnimationFrame(() => scrollIntoRoom(box.current));
    return () => cancelAnimationFrame(t);
  }, []);
  return (
    <p class={`queue-line small${failed ? " failed" : ""}`} role="status" ref={box}>
      {lead ? (
        <>
          <b>{lead}</b>
          {text.slice(lead.length)}
        </>
      ) : (
        text
      )}
    </p>
  );
}

async function send(endpoint: string, body: unknown, channels: Channel[]): Promise<SheetResult> {
  try {
    const r = await api<{ outcome: Outcome; results?: { channelId: string; status: string }[] }>(endpoint, { json: body });
    const name = (id: string) => {
      const c = channels.find((ch) => ch.id === id);
      return c ? serviceName(c.service) : "One channel";
    };
    const good = ["queued", "draft", "approval", "retrying"];
    const results = r.results ?? [];
    return { outcome: r.outcome, ok: results.filter((x) => good.includes(x.status)).map((x) => name(x.channelId)), failed: results.filter((x) => !good.includes(x.status)).map((x) => name(x.channelId)) };
  } catch {
    return { outcome: "failed", ok: [], failed: [] };
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
        <li key={c.id} class={c.refusal ? "refused" : undefined}>
          <Mark service={c.service} />
          <span class="ch-label">
            <span class="ch-name-line">
              {c.name}
              <span class="caption muted"> · {serviceName(c.service)}</span>
            </span>
            {c.refusal && <span class="caption reason">{REFUSAL_WORDS[c.refusal]}</span>}
          </span>
          <button
            class="toggle"
            role="switch"
            aria-checked={on.has(c.id)}
            aria-label={`${c.name} on ${serviceName(c.service)}`}
            disabled={blocked(c)}
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
function useTargets(url: string): Channel[] | null {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  useEffect(() => {
    api<{ channels: Channel[] }>(url)
      .then((r) => setChannels(r.channels))
      .catch(() => setChannels([]));
  }, [url]);
  return channels;
}

export function PostAgainSheet({ endpoint, targets, postName, imageUrl, sample, onClose, onDone }: { endpoint: string; targets: string; postName?: string; imageUrl?: string | null; sample?: boolean; onClose: () => void; onDone: (r: SheetResult) => void }): JSX.Element {
  const channels = useTargets(targets);
  return channels ? <PostAgainReady endpoint={endpoint} channels={channels} postName={postName} imageUrl={imageUrl} sample={sample} onClose={onClose} onDone={onDone} /> : <Sheet title="Post it again to:" onClose={onClose}><p class="small muted"><span class="spin" aria-hidden="true" /></p></Sheet>;
}

function PostAgainReady({ endpoint, channels, postName, imageUrl, sample, onClose, onDone }: { endpoint: string; channels: Channel[]; postName?: string; imageUrl?: string | null; sample?: boolean; onClose: () => void; onDone: (r: SheetResult) => void }): JSX.Element {
  const [on, setOn] = useState(() => new Set(channels.filter((c) => !blocked(c)).map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Post it again to:" onClose={onClose}>
      {postName ? (
        <div class="sheet-post">
          {imageUrl ? <img src={imageUrl} alt="" width="48" height="48" /> : null}
          <strong>{tileLabel(postName)}</strong>
        </div>
      ) : null}
      <p class="small muted">{sample ? "Sample bakery: nothing is sent to any real account." : "Goes into your Buffer queue and out at your next slot."}</p>
      <ChannelToggles channels={channels} on={on} setOn={setOn} />
      <div class="btn-row">
        <button
          class="btn primary"
          disabled={busy || !on.size}
          onClick={async () => {
            setBusy(true);
            onDone(await send(endpoint, { channels: [...on] }, channels));
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
export function PostThisSheet(props: { endpoint: string; targets: string; text: string; image: string; onClose: () => void; onDone: (r: SheetResult) => void }): JSX.Element {
  const channels = useTargets(props.targets);
  return channels ? <PostThisReady {...props} channels={channels} /> : <Sheet title="Post this to:" onClose={props.onClose}><p class="small muted"><span class="spin" aria-hidden="true" /></p></Sheet>;
}

function PostThisReady({ endpoint, channels, text: initial, image, onClose, onDone }: { endpoint: string; channels: Channel[]; text: string; image: string; onClose: () => void; onDone: (r: SheetResult) => void }): JSX.Element {
  const [on, setOn] = useState(() => new Set(channels.filter((c) => !blocked(c)).map((c) => c.id)));
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
            onDone(await send(endpoint, { channels: [...on], text, image }, channels));
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
