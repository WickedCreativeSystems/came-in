// Setup (plan 3.8; P10). Every section saves and reloads; the checklist's
// chips open their sections by hash.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { WallData, ChannelRow, Theme } from "@shared/types";
import { serviceName } from "@shared/marks";
import { api, ApiError } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { ringMyPhone, initialPhoneState, thisPhoneRings, isIOS, type PhoneState } from "../lib/push";
import { Header } from "../ui/Header";
import { Bell } from "../ui/glyphs";

interface SetupData {
  settings: { thankYou: string | null; reviewUrl: string | null; markWinners: boolean; theme: Theme; cardPrinted: boolean };
  tapUrl: string;
  embed: string;
  phones: number;
  channels: ChannelRow[];
  pushKey: string | null;
}

const MAX = 60;

export function Setup({ sample }: { sample: boolean }): JSX.Element {
  const [wall, setWall] = useState<WallData | null>(null);
  const [data, setData] = useState<SetupData | null>(null);
  const [error, setError] = useState(false);
  const base = sample ? "/sample" : "";
  const setupApi = sample ? "/api/sample/setup" : "/api/setup";

  async function load() {
    try {
      const [w, d] = await Promise.all([api<WallData>(sample ? "/api/sample/wall" : "/api/wall"), api<SetupData>(setupApi)]);
      setWall(w);
      setData(d);
      applyTheme(d.settings.theme);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) location.href = "/";
      else setError(true);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!data || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [!!data]);

  async function save(patch: Partial<SetupData["settings"]>): Promise<string | null> {
    try {
      const r = await api<{ settings: SetupData["settings"] }>(setupApi, { json: patch });
      setData((d) => (d ? { ...d, settings: r.settings } : d));
      if (patch.theme) applyTheme(patch.theme);
      return null;
    } catch (e) {
      if (e instanceof ApiError && typeof e.body.error === "string") return e.body.error;
      return "Something's wrong on our side. Try again in a minute.";
    }
  }

  if (!wall || !data) {
    return <main class="page">{error && <div class="strip stamp" role="alert">Something's wrong on our side. Try again in a minute.</div>}</main>;
  }

  return (
    <>
      <Header shop={wall.shop} today={wall.countToday} tab="setup" base={base} />
      <main class="page setup">
        {sample && (
          <div class="strip">
            <span>Sample bakery. Taps here only ring this browser.</span>
            <a class="btn primary" href="/auth/start">
              Connect your own Buffer
            </a>
          </div>
        )}
        <h1 class="h1">Setup</h1>

        <Section id="card" eyebrow="Card">
          <a class="btn primary" href={`${base}/card`}>
            Print your card
          </a>
        </Section>

        <Section id="counter" eyebrow="Counter">
          <p>This turns this phone or tablet into the counter. It stays signed in until you close it.</p>
          <OpenCounter sample={sample} />
        </Section>

        <Section id="phone" eyebrow="Phone">
          <RingMyPhone sample={sample} pushKey={data.pushKey} phones={data.phones} onDone={load} />
        </Section>

        <Section id="thank-you" eyebrow="Thank-you">
          <p>Shown once per phone per day, after any tap, including when they didn't see a post.</p>
          <TextSetting
            value={data.settings.thankYou ?? ""}
            placeholder="Free cookie today. Show this at the till."
            max={MAX}
            label="Thank-you text"
            onSave={(v) => save({ thankYou: v || null })}
          />
        </Section>

        <Section id="review" eyebrow="Review">
          <p>Shown after the thank-you, never tied to it.</p>
          <TextSetting value={data.settings.reviewUrl ?? ""} placeholder="Paste your Google review link" label="Google review link" type="url" onSave={(v) => save({ reviewUrl: v || null })} />
        </Section>

        <Section id="buffer" eyebrow="Buffer">
          <label class="toggle-row">
            <button
              class="toggle"
              role="switch"
              aria-checked={data.settings.markWinners}
              aria-labelledby="mark-winners"
              onClick={() => void save({ markWinners: !data.settings.markWinners })}
            />
            <span id="mark-winners">Once 3 people say a post brought them in, we tag it "Came in" in Buffer and leave a note on it.</span>
          </label>
        </Section>

        <Section id="receipts" eyebrow="Receipts">
          <p>Paste your tap link into your receipt's custom text.</p>
          <CopyField value={data.tapUrl} label="Your tap link" />
          <a class="small" href="https://squareup.com/help/us/en/article/5424" target="_blank" rel="noopener">
            How, on Square
          </a>
        </Section>

        <Section id="online" eyebrow="Online">
          <p>Put this on your booking confirmation or thank-you page.</p>
          <CopyField value={data.embed} label="The script for your page" mono />
        </Section>

        <Section id="look" eyebrow="Look">
          <div class="seg" role="radiogroup" aria-label="Look">
            {(
              [
                ["day", "Day"],
                ["night", "After close"],
                ["system", "Follow my phone"],
              ] as [Theme, string][]
            ).map(([t, label]) => (
              <button key={t} class="btn" role="radio" aria-checked={data.settings.theme === t} onClick={() => void save({ theme: t })}>
                {label}
              </button>
            ))}
          </div>
        </Section>

        {!sample && (
          <Section id="channels" eyebrow="Channels">
            <ChannelsSetting rows={data.channels} />
          </Section>
        )}

        {!sample && (
          <Section id="delete" eyebrow="Delete">
            <DeleteShop />
          </Section>
        )}

        <footer class="app-foot privacy">
          <span>Anonymous. A post, a time, nothing else.</span>
          <a href="/privacy">Privacy</a>
          <span>Built for Buffer Commit 2026</span>
          {sample && <a href="/credits">Photo credits</a>}
        </footer>
      </main>
    </>
  );
}

function Section({ id, eyebrow, children }: { id: string; eyebrow: string; children: JSX.Element | JSX.Element[] | (JSX.Element | false)[] }): JSX.Element {
  return (
    <section class="setup-section" id={id} aria-labelledby={`${id}-h`}>
      <h2 class="eyebrow" id={`${id}-h`}>
        {eyebrow}
      </h2>
      <div class="setup-body">{children}</div>
    </section>
  );
}

function TextSetting({ value, placeholder, max, label, type, onSave }: { value: string; placeholder: string; max?: number; label: string; type?: string; onSave: (v: string) => Promise<string | null> }): JSX.Element {
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<"rest" | "saving" | "saved">("rest");
  const id = label.replace(/\W+/g, "-").toLowerCase();
  const n = [...v].length;
  return (
    <div class="field">
      <label class="sr" for={id}>
        {label}
      </label>
      <div class="field-row">
        <input
          id={id}
          class={`input${err ? " error" : ""}`}
          type={type ?? "text"}
          value={v}
          placeholder={placeholder}
          maxLength={max}
          aria-invalid={!!err}
          aria-describedby={err ? `${id}-err` : undefined}
          onInput={(e) => {
            setV((e.target as HTMLInputElement).value);
            setErr(null);
            setState("rest");
          }}
        />
        <button
          class="btn primary"
          disabled={state === "saving"}
          onClick={async () => {
            setState("saving");
            const e = await onSave(v.trim());
            setErr(e);
            setState(e ? "rest" : "saved");
          }}
        >
          {state === "saving" && <span class="spin" aria-hidden="true" />}
          {state === "saved" ? "Saved" : "Save"}
        </button>
      </div>
      {max && <div class="caption muted counter-chars">{`${n} / ${max}`}</div>}
      {err && (
        <div class="input-error" id={`${id}-err`} role="alert">
          {err}
        </div>
      )}
    </div>
  );
}

function CopyField({ value, label, mono }: { value: string; label: string; mono?: boolean }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <div class="field-row">
      <label class="sr" for={id}>
        {label}
      </label>
      <input id={id} class={`input${mono ? " mono" : ""}`} readOnly value={value} onFocus={(e) => (e.target as HTMLInputElement).select()} />
      <button
        class="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            (document.getElementById(id) as HTMLInputElement | null)?.select();
            document.execCommand?.("copy");
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function OpenCounter({ sample }: { sample: boolean }): JSX.Element {
  const [busy, setBusy] = useState(false);
  if (sample)
    return (
      <a class="btn" href="/sample/c">
        Open the counter on this device
      </a>
    );
  return (
    <button
      class="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ url: string }>("/api/counter/open", { method: "POST" });
          location.href = r.url;
        } catch {
          setBusy(false);
        }
      }}
    >
      {busy && <span class="spin" aria-hidden="true" />}
      Open the counter on this device
    </button>
  );
}

function IOSSteps(): JSX.Element {
  return (
    <ol class="ios-steps">
      <li>
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <path d="M12 3v11M8 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M8 10H6v10h12V10h-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        </svg>
        <span>Tap Share.</span>
      </li>
      <li>
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <span>Tap Add to Home Screen.</span>
      </li>
      <li>
        <span class="app-icon">
          <Bell size={22} />
        </span>
        <span>Open Came In from your Home Screen and tap Ring my phone.</span>
      </li>
    </ol>
  );
}

function RingMyPhone({ sample, pushKey, onDone }: { sample: boolean; pushKey: string | null; phones: number; onDone: () => void }): JSX.Element {
  const [state, setState] = useState<PhoneState>(() => initialPhoneState());
  useEffect(() => {
    void thisPhoneRings().then((yes) => yes && setState((s) => (s === "idle" ? "ok" : s)));
  }, []);
  async function go() {
    setState("working");
    try {
      const s = await ringMyPhone(sample, pushKey);
      setState(s);
      if (s === "ok") onDone();
    } catch {
      setState("refused");
    }
  }
  return (
    <div>
      {state !== "ios" && state !== "unsupported" && state !== "refused" && (
        <button class="btn" disabled={state === "working"} onClick={go}>
          {state === "working" && <span class="spin" aria-hidden="true" />}
          Ring my phone
        </button>
      )}
      {state === "ok" && <p class="small">Your phone will ring.</p>}
      {state === "denied" && <p class="small">Notifications are off for Came In in your phone's settings. Turn them on, then tap Ring my phone again.</p>}
      {state === "ios" && (
        <div class="note">
          <IOSSteps />
        </div>
      )}
      {state === "unsupported" && (
        <div class="note">
          <p class="small">This phone can't ring. The bell still rings wherever Came In is open.</p>
          {isIOS() && <IOSSteps />}
        </div>
      )}
      {state === "refused" && (
        <div class="note">
          <p class="small">Came In couldn't turn on the bell in this browser. The bell still rings wherever Came In is open.</p>
          <button class="btn" onClick={go}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function ChannelsSetting({ rows: initial }: { rows: ChannelRow[] }): JSX.Element {
  const [rows, setRows] = useState(initial);
  const [card, setCard] = useState(initial.find((r) => r.onCard)?.id ?? initial[0]?.id ?? null);
  const [changing, setChanging] = useState(false);
  const [state, setState] = useState<"rest" | "saving" | "saved">("rest");
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <ul class="channels">
        {rows.map((r) => (
          <li key={r.id} class={changing ? "picking" : ""} onClick={changing ? () => (setCard(r.id), setChanging(false), setState("rest")) : undefined}>
            {r.avatar ? <img class="avatar" src={r.avatar} alt="" width="36" height="36" /> : <span class="avatar avatar-fallback" style={{ width: 36, height: 36 }} />}
            <div class="ch-text">
              <div class="ch-name">{r.displayName || r.name}</div>
              <div class="caption muted">{serviceName(r.service)}</div>
            </div>
            {card === r.id && (
              <span class="on-card">
                <span class="eyebrow">On the card</span>
                {!changing && rows.length > 1 && (
                  <button class="btn quiet sm" onClick={(e) => (e.stopPropagation(), setChanging(true))}>
                    Change
                  </button>
                )}
              </span>
            )}
            <button
              class="toggle"
              role="switch"
              aria-checked={r.enabled}
              aria-label={`${r.displayName || r.name} on ${serviceName(r.service)}`}
              onClick={(e) => {
                e.stopPropagation();
                setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)));
                setState("rest");
              }}
            />
          </li>
        ))}
      </ul>
      {err && (
        <div class="input-error" role="alert">
          {err}
        </div>
      )}
      <div class="btn-row">
        <button
          class="btn primary"
          disabled={state === "saving" || !rows.some((r) => r.enabled)}
          onClick={async () => {
            setState("saving");
            setErr(null);
            try {
              await api("/api/channels", { json: { enabled: rows.filter((r) => r.enabled).map((r) => r.id), card } });
              setState("saved");
            } catch (e) {
              setErr(e instanceof ApiError && typeof e.body.error === "string" && e.status === 400 ? e.body.error : "Something's wrong on our side. Try again in a minute.");
              setState("rest");
            }
          }}
        >
          {state === "saving" && <span class="spin" aria-hidden="true" />}
          {state === "saved" ? "Saved" : "Save"}
        </button>
        <a class="btn" href="/auth/start">
          Reconnect Buffer
        </a>
      </div>
    </>
  );
}

function DeleteShop(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button class="btn stamp" onClick={() => setOpen(true)}>
        Disconnect and delete everything
      </button>
      {open && (
        <div class="scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="del-h">
            <h2 class="h2" id="del-h">
              This deletes your wall, your taps and your card, and removes Came In's tags and notes from your Buffer posts.
            </h2>
            <div class="btn-row">
              <button
                class="btn stamp"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api<{ next: string }>("/api/shop/delete", { method: "POST" });
                    location.href = r.next;
                  } catch {
                    setBusy(false);
                  }
                }}
              >
                {busy && <span class="spin" aria-hidden="true" />}
                Delete
              </button>
              <button class="btn" autoFocus onClick={() => setOpen(false)}>
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
