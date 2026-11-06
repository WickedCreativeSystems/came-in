// Setup (plan 3.8; P10). Every section saves and reloads; the checklist's
// chips open their sections by hash.
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WallData, ChannelRow, Theme } from "@shared/types";
import { serviceName } from "@shared/marks";
import { api, ApiError } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { scrollIntoRoom } from "../lib/scroll";
import { deviceId } from "../lib/device";
import { ringMyPhone, initialPhoneState, thisPhoneRings, isIOS, type PhoneState } from "../lib/push";
import { HeaderSkeleton, TilesSkeleton } from "../ui/Skeleton";
import { Header } from "../ui/Header";
import { Icon } from "../ui/icons";
import { Sheet } from "../ui/Sheets";
import { Bell, Avatar } from "../ui/glyphs";
import { fetchLocations, switchTo, type Locations } from "../lib/locations";

interface SetupData {
  settings: { thankYou: string | null; reviewUrl: string | null; markWinners: boolean; theme: Theme; cardPrinted: boolean };
  tapUrl: string;
  price?: string | null;
  tapUrls?: { id: string; name: string; url: string }[];
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
  // After Add location with Same posts: "Eastside is added. Print its card."
  const addedId = new URLSearchParams(location.search).get("added");
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!addedId || sample) return;
    fetchLocations().then((l) => { const hit = l.locations.find((x) => x.id === addedId); if (hit) setAdded({ id: hit.id, name: hit.name }); }).catch(() => undefined);
  }, []);

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
    // Hold the page's place while the shop's data loads, so a section link never opens on a blank screen.
    return (
      <>
        <HeaderSkeleton />
        <main class="page setup">
          {error && <div class="strip stamp" role="alert">Something's wrong on our side. Try again in a minute.</div>}
          <h1 class="h1">Setup</h1>
          {!error && <div class="setup-hold" aria-hidden="true" />}
        </main>
      </>
    );
  }

  return (
    <>
      <Header shop={wall.shop} today={wall.countToday} tab="setup" base={base} />
      <main class="page setup">
        {sample && (
          <div class="strip">
            <span>Sample bakery. Nothing here reaches a real shop. Tap a post and this wall rings.</span>
            <a class="btn primary" href="/auth/start">
              Connect your own Buffer
            </a>
          </div>
        )}
        <h1 class="h1">Setup</h1>
        {added && (
          <div class="strip" role="status">
            <span>
              {added.name} is added. <a href={`/card?l=${added.id}`}>Print its card.</a>
            </span>
          </div>
        )}

        <Section id="card" eyebrow="Card">
          <p>The sign that goes by your till.</p>
          <a class="btn primary" href={`${base}/card`}>
            Print your card
          </a>
        </Section>

        <Section id="staff" eyebrow="Staff screen">
          <p>A screen for your staff, not something to print.</p>
          <p>This turns this phone or tablet into the staff screen. It stays signed in until you close it.</p>
          <OpenCounter sample={sample} locations={wall.locations} />
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
            <span id="mark-winners">Once 3 people say a post brought them in, we leave a note on it in Buffer.</span>
          </label>
        </Section>

        <Section id="receipts" eyebrow="Receipts">
          <p>Paste your tap link into your receipt's custom text.</p>
          {data.tapUrls && data.tapUrls.length >= 2 ? (
            <div class="tap-links">
              {data.tapUrls.map((l) => (
                <CopyField key={l.id} value={l.url} label={`Tap link for ${l.name}`} />
              ))}
            </div>
          ) : (
            <CopyField value={data.tapUrl} label="Your tap link" />
          )}
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

        <Section id="locations" eyebrow="Locations">
          <LocationsSetting sample={sample} shopName={wall.shop.name} samplePrice={data.price ?? null} />
        </Section>

        {!sample && (
          <Section id="channels" eyebrow="Channels">
            <ChannelsSetting rows={data.channels} />
          </Section>
        )}

        {!sample && (
          <Section id="signout" eyebrow="Sign out">
            <SignOut />
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

function LocationsSetting({ sample, shopName, samplePrice }: { sample: boolean; shopName: string; samplePrice?: string | null }): JSX.Element {
  const [locs, setLocs] = useState<Locations | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const reload = () => fetchLocations().then(setLocs).catch(() => undefined);
  useEffect(() => {
    if (!sample) void reload();
  }, []);
  if (sample)
    return (
      <div>
        <p>Each location has its own card, staff screen and counts.</p>
        <div class="loc-list">
          <div class="loc-row">
            <span class="loc-name">{shopName}</span>
            <a class="btn quiet sm" href="/sample/card">
              Print its card
            </a>
          </div>
        </div>
        <p>
          <a class="btn" href="/sample/setup/add">
            <Icon name="plus" size={18} />
            Add a location
          </a>
        </p>
        <p class="small muted">
          {samplePrice ? `More than one location is ${samplePrice} a month each.` : "One location is free."} <a href="/pricing">See Pricing.</a>
        </p>
      </div>
    );
  const mine = locs?.locations ?? [];
  const others = (locs?.shops ?? []).filter((x) => x.id !== locs?.current);
  const full = mine.length >= (locs?.cap ?? 10);
  async function save(id: string) {
    setErr(null);
    try {
      await api(`/api/shop/locations/${id}`, { method: "PATCH", json: { name: draft } });
      setRenaming(null);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : "Something's wrong on our side. Try again in a minute.");
    }
  }
  async function remove(id: string) {
    try {
      await api(`/api/shop/locations/${id}`, { method: "DELETE" });
    } catch {}
    setRemoving(null);
    await reload();
  }
  return (
    <div>
      <p>Each location has its own card, staff screen and counts.</p>
      <div class="loc-list">
        {mine.map((l, i) => (
          <div class="loc-row" key={l.id}>
            {renaming === l.id ? (
              <>
                <div class="loc-edit">
                  <label class="sr" for={`rn-${l.id}`}>
                    Name
                  </label>
                  <input id={`rn-${l.id}`} class={`input${err ? " error" : ""}`} value={draft} maxLength={24} autofocus onInput={(e) => { setDraft((e.target as HTMLInputElement).value); setErr(null); }} onKeyDown={(e) => { if (e.key === "Enter") void save(l.id); if (e.key === "Escape") setRenaming(null); }} />
                  {err && (
                    <div class="input-error" role="alert">
                      {err}
                    </div>
                  )}
                </div>
                <button class="btn sm" onClick={() => void save(l.id)}>
                  Save
                </button>
                <button class="btn quiet sm" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span class="loc-name">{l.name}</span>
                <span class="loc-actions">
                  <a class="btn quiet sm" href={i === 0 ? "/card" : `/card?l=${l.id}`}>
                    Print its card
                  </a>
                  <button class="btn quiet sm" onClick={() => { setRenaming(l.id); setDraft(l.name); setErr(null); }}>
                    Rename
                  </button>
                  {i > 0 && !l.hasTaps && (
                    <button class="btn quiet sm" onClick={() => setRemoving({ id: l.id, name: l.name })}>
                      Remove
                    </button>
                  )}
                </span>
              </>
            )}
          </div>
        ))}
        {others.length > 0 && <div class="loc-rule" />}
        {others.map((s) => (
          <div class="loc-row" key={s.id}>
            <Avatar name={s.name} url={s.avatarUrl} size={32} />
            <span class="loc-name">{s.name}</span>
            <button class="btn quiet sm" onClick={() => void switchTo(s.id)}>
              Open
            </button>
          </div>
        ))}
      </div>
      <p>
        {full ? (
          <span class="small muted">A shop can have up to 10 locations.</span>
        ) : (
          <a class="btn" href="/setup/add">
            <Icon name="plus" size={18} />
            Add a location
          </a>
        )}
      </p>
      <p class="small muted">
        {locs?.price ? `More than one location is ${locs.price} a month each.` : "One location is free."} <a href="/pricing">See Pricing.</a>
      </p>
      {removing && (
        <Sheet title={`Remove ${removing.name}? Its card will stop working.`} onClose={() => setRemoving(null)}>
          <div class="btn-row">
            <button class="btn stamp" onClick={() => void remove(removing.id)}>
              Remove
            </button>
            <button class="btn" onClick={() => setRemoving(null)}>
              Keep
            </button>
          </div>
        </Sheet>
      )}
    </div>
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

function OpenCounter({ sample, locations }: { sample: boolean; locations: { id: string; name: string }[] }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  if (sample)
    return (
      <a class="btn" href="/sample/c">
        Open the staff screen on this device
      </a>
    );
  async function open(location?: string) {
    setBusy(true);
    try {
      const r = await api<{ url: string }>("/api/counter/open", { json: { location } });
      location_href(r.url);
    } catch {
      setBusy(false);
    }
  }
  // With two or more locations the screen first asks which one it is at (plan 3.8).
  if (asking && locations.length >= 2)
    return (
      <div class="which-loc">
        <h2 class="h2">Which location is this screen at?</h2>
        {locations.map((l) => (
          <button key={l.id} class="btn which-btn" disabled={busy} onClick={() => void open(l.id)}>
            {l.name}
          </button>
        ))}
      </div>
    );
  return (
    <button
      class="btn"
      disabled={busy}
      onClick={() => (locations.length >= 2 ? setAsking(true) : void open(locations[0]?.id))}
    >
      {busy && <span class="spin" aria-hidden="true" />}
      Open the staff screen on this device
    </button>
  );
}

function location_href(url: string): void {
  location.href = url;
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
  // In the sample the button never asks for or reads notification permission: the bell rings in this page.
  const [state, setState] = useState<PhoneState>(() => (sample ? "idle" : initialPhoneState()));
  useEffect(() => {
    if (sample) return;
    void thisPhoneRings().then((yes) => yes && setState((s) => (s === "idle" ? "ok" : s)));
  }, []);
  // The result and Now try a tap sit below the button, so on a phone they start behind the bottom bar:
  // after a tap, bring them into view (EaseBot, round 6, task 6 phone).
  const result = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  useEffect(() => {
    if (state !== "ok" || !pressed.current) return;
    const id = requestAnimationFrame(() => scrollIntoRoom(result.current));
    return () => cancelAnimationFrame(id);
  }, [state]);
  async function go() {
    pressed.current = true;
    if (sample) {
      setState("ok");
      await api("/api/sample/phone", { method: "POST" }).catch(() => undefined);
      onDone();
      return;
    }
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
      <p class="small">{sample ? "In this sample the bell rings in this browser." : "Your phone rings when someone taps. Open Came In on your phone, then tap Ring my phone."}</p>
      {state !== "ios" && state !== "unsupported" && state !== "refused" && (
        <button class="btn" disabled={state === "working"} onClick={go}>
          {state === "working" && <span class="spin" aria-hidden="true" />}
          Ring my phone
        </button>
      )}
      {state === "ok" && (
        <div ref={result}>
          <p class="small has-hint">{sample ? <><b>This browser will ring.</b> In your own shop, open Came In on your phone and tap Ring my phone there, and your phone rings.</> : "Your phone will ring."}</p>
          {sample && (
            <a class="btn now-try" href="/sample?try=1">
              <Icon name="phone" size={18} />
              Now try a tap
            </a>
          )}
        </div>
      )}
      {state === "ok" && !sample && <p class="caption muted sound-hint">If it only buzzes, open your phone's notification settings for Came In and turn sound on.</p>}
      {state === "denied" && <p class="small">Notifications are blocked for Came In on this device. Allow them in this browser's or phone's settings, then tap Ring my phone again.</p>}
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

function SignOut(): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p>Signs this browser out of every shop in it. Your walls, cards and taps stay, and open staff screens keep working.</p>
      <button
        class="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ next: string }>("/setup/signout", { json: { device: deviceId() } });
            location.href = r.next;
          } catch {
            setBusy(false);
          }
        }}
      >
        {busy && <span class="spin" aria-hidden="true" />}
        Sign out of this browser
      </button>
    </div>
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
              This deletes your wall, your taps and your card, and removes Came In's notes from your Buffer posts.
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
