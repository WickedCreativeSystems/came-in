// Which shop? (plan 3.2) and first run (plan 3.3).
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ChannelRow, RoomMessage } from "@shared/types";
import { serviceName } from "@shared/marks";
import { api, ApiError } from "../lib/api";
import { connectRoom } from "../lib/room";
import { deviceId } from "../lib/device";
import { Bell } from "../ui/glyphs";

function Top(): JSX.Element {
  return (
    <header class="sign plain">
      <a class="wordmark" href="/">
        <Bell size={22} />
        <span>Came In</span>
      </a>
    </header>
  );
}

export function WhichShop(): JSX.Element {
  const [orgs, setOrgs] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<{ orgs: { id: string; name: string }[] }>("/api/orgs")
      .then((r) => setOrgs(r.orgs))
      .catch(() => (location.href = "/?error=exchange"));
  }, []);
  async function pick(id: string) {
    setBusy(id);
    try {
      const r = await api<{ next: string }>("/api/setup/org", { json: { org: id } });
      location.href = r.next;
    } catch {
      location.href = "/?error=exchange";
    }
  }
  return (
    <>
      <Top />
      <main class="page narrow">
        <h1 class="h1">Which shop?</h1>
        <div class="org-list">
          {(orgs ?? []).map((o) => (
            <button key={o.id} class="btn" disabled={!!busy} onClick={() => pick(o.id)}>
              {busy === o.id && <span class="spin" aria-hidden="true" />}
              {o.name}
            </button>
          ))}
        </div>
        <p class="small muted">You can add the others later under Locations.</p>
      </main>
    </>
  );
}

export function Channels(): JSX.Element {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    api<{ channels: ChannelRow[] }>("/api/channels")
      .then((r) => {
        setRows(r.channels);
        setCard(r.channels.find((c) => c.onCard)?.id ?? r.channels[0]?.id ?? null);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) location.href = "/";
        else if (e instanceof ApiError && e.status === 409) location.href = "/auth/start";
        else setProblem("Buffer is taking a while… Try again in a minute.");
      });
  }, []);
  function toggle(id: string) {
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) ?? null);
  }
  async function save() {
    if (!rows) return;
    setBusy(true);
    try {
      await api("/api/channels", { json: { enabled: rows.filter((r) => r.enabled).map((r) => r.id), card } });
      location.href = "/setup/reading";
    } catch (e) {
      setBusy(false);
      setProblem(e instanceof ApiError && typeof e.body.error === "string" && e.status === 400 ? e.body.error : "Something's wrong on our side. Try again in a minute.");
    }
  }
  return (
    <>
      <Top />
      <main class="page narrow">
        <h1 class="h1">Your channels</h1>
        {problem && <div class="strip stamp" role="alert">{problem}</div>}
        {!rows && !problem && (
          <p class="small muted">
            <span class="spin" aria-hidden="true" /> Reading your channels…
          </p>
        )}
        <ul class="channels">
          {(rows ?? []).map((r) => (
            <li key={r.id} class={changing ? "picking" : ""} onClick={changing ? () => (setCard(r.id), setChanging(false)) : undefined}>
              {r.avatar ? <img class="avatar" src={r.avatar} alt="" width="36" height="36" /> : <span class="avatar avatar-fallback" style={{ width: 36, height: 36 }} />}
              <div class="ch-text">
                <div class="ch-name">{r.displayName || r.name}</div>
                <div class="caption muted">{serviceName(r.service)}</div>
              </div>
              {card === r.id && (
                <span class="on-card">
                  <span class="eyebrow">On the card</span>
                  {!changing && rows!.length > 1 && (
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
                onClick={(e) => (e.stopPropagation(), toggle(r.id))}
              />
            </li>
          ))}
        </ul>
        <p class="small muted">The card and the tap page use this channel's name and logo.</p>
        <button class="btn primary" disabled={!rows || busy || !rows.some((r) => r.enabled)} onClick={save}>
          {busy && <span class="spin" aria-hidden="true" />}
          Looks right
        </button>
      </main>
    </>
  );
}

export function Reading(): JSX.Element {
  const [count, setCount] = useState(0);
  const [slow, setSlow] = useState<0 | 1 | 2>(0);
  const done = useRef(false);
  useEffect(() => {
    const started = Date.now();
    const finish = () => {
      if (done.current) return;
      done.current = true;
      location.href = "/wall";
    };
    const t8 = setTimeout(() => setSlow((s) => (s < 1 ? 1 : s)), 8000);
    const t30 = setTimeout(() => setSlow(2), 30000);
    const onMsg = (m: RoomMessage) => {
      if (m.type !== "sync") return;
      setCount(m.count);
      if (m.done) finish();
    };
    const stop = connectRoom(`/api/ws?device=${deviceId()}`, onMsg, () => {});
    // The socket is the fast path; this poll covers a socket that never opens.
    const poll = setInterval(async () => {
      try {
        const s = await api<{ running: boolean; count: number }>("/api/sync");
        setCount((c) => Math.max(c, s.count));
        if (!s.running && Date.now() - started > 1500) finish();
      } catch {}
    }, 2000);
    return () => {
      clearTimeout(t8);
      clearTimeout(t30);
      clearInterval(poll);
      stop();
    };
  }, []);
  return (
    <>
      <Top />
      <main class="page narrow">
        <h2 class="h2">Reading your posts…</h2>
        <p class="small reading">
          <span class="spin" aria-hidden="true" /> {count} so far
        </p>
        {slow === 1 && <p class="small muted">Buffer is taking a while…</p>}
        {slow === 2 && (
          <>
            <p class="small muted">Buffer isn't answering right now. We'll keep trying; your wall will fill in on its own.</p>
            <a class="btn" href="/wall">
              Open my wall
            </a>
          </>
        )}
      </main>
    </>
  );
}
