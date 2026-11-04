// The wall (plan 3.4) for a real shop and for the sample bakery (plan 3.10).
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WallData, RoomMessage, RingMessage } from "@shared/types";
import { api, ApiError } from "../lib/api";
import { connectRoom } from "../lib/room";
import { deviceId } from "../lib/device";
import { ringSound } from "../lib/bell";
import { applyTheme } from "../lib/theme";
import { Header } from "../ui/Header";
import { Tile } from "../ui/Tile";
import { BellBanner, type Ring } from "../ui/BellBanner";
import { Icon } from "../ui/icons";
import { PhoneFrame } from "../ui/PhoneFrame";

export function Wall({ sample }: { sample: boolean }): JSX.Element {
  const [data, setData] = useState<WallData | null>(null);
  const [error, setError] = useState<"server" | null>(null);
  const [ring, setRing] = useState<Ring | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [refresh, setRefresh] = useState<"rest" | "checking" | "checked">("rest");
  const [sheet, setSheet] = useState(false);
  const ringKey = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  async function load() {
    try {
      const d = await api<WallData>(sample ? "/api/sample/wall" : "/api/wall");
      setData(d);
      setError(null);
      applyTheme(d.shop.theme);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        location.href = "/";
        return;
      }
      setError("server");
    }
  }

  useEffect(() => {
    void load();
    const path = sample ? "/sample/ws" : `/api/ws?device=${deviceId()}`;
    return connectRoom(path, onRoom, () => void load());
  }, []);

  function onRoom(m: RoomMessage) {
    if (m.type === "ring") onRing(m);
    else if (m.type === "posts" || (m.type === "sync" && m.done)) void load();
  }

  // look.md section 9: sound at once, banner the same instant, sticker and header tick at +300 ms.
  function onRing(m: RingMessage) {
    ringSound();
    ringKey.current += 1;
    setRing({ key: ringKey.current, sentence: m.sentence, where: m.where, imageUrl: m.imageUrl, href: null });
    setTimeout(() => {
      setData((d) => {
        if (!d) return d;
        return {
          ...d,
          hasTapped: true,
          countToday: Math.max(d.countToday, m.countToday),
          countThisWeek: d.countThisWeek + 1,
          tiles: d.tiles.map((t) => (t.id === m.tileId ? { ...t, count: Math.max(t.count, m.count) } : t)),
        };
      });
      if (m.tileId) {
        setFlash(m.tileId);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 1200);
      }
    }, 300);
  }

  async function doRefresh() {
    if (refresh !== "rest") return;
    setRefresh("checking");
    try {
      if (!sample) {
        const r = await api<{ waited: boolean; newPosts?: number }>("/api/refresh", { method: "POST" });
        if (!r.waited && r.newPosts) await load();
      } else {
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch {}
    setRefresh("checked");
    setTimeout(() => setRefresh("rest"), 60000);
  }

  if (!data) {
    return (
      <main class="page">
        {error && <div class="strip stamp" role="alert">Something's wrong on our side. Try again in a minute.</div>}
      </main>
    );
  }

  const now = new Date(data.now);
  const tz = data.shop.timezone;
  const shown = data.tiles.filter((t) => !t.hidden);
  const base = sample ? "/sample" : "";
  const tapUrl = sample ? "/sample/t" : `/t/${data.shop.id}?try=1`;
  const allDone = Object.values(data.checklist).every(Boolean);

  return (
    <div class={sample ? "with-phone" : ""}>
      <Header shop={data.shop} today={data.countToday} tab="wall" base={base} />
      <main class="page">
        {error && <div class="strip stamp" role="alert">Something's wrong on our side. Try again in a minute.</div>}
        {sample && (
          <div class="strip">
            <span>Sample bakery. Taps here only ring this browser.</span>
            <a class="btn primary sm" href="/auth/start">
              Connect your own Buffer
            </a>
          </div>
        )}
        {!data.hasTapped || sample ? (
          <section class="try" aria-label="Try it">
            <div class="qr">
              <img src={sample ? "/qr/sample.svg" : `/qr/${data.shop.id}.svg`} alt="QR code for the tap page" width="96" height="96" />
            </div>
            <div>
              <h2 class="h2">This is what your customers will tap.</h2>
              <p class="small muted">Try it: scan this with your phone, tap a post, and this screen rings.</p>
            </div>
            <a
              class="btn"
              href={tapUrl}
              target="_blank"
              rel="noopener"
              onClick={(e) => {
                if (sample) {
                  e.preventDefault();
                  if (window.innerWidth < 1024) setSheet(true);
                  else
                    document.querySelector(".phone-wrap")?.animate([{ transform: "translateY(0)" }, { transform: "translateY(-10px)" }, { transform: "translateY(0)" }], { duration: 400, easing: "cubic-bezier(.2,.8,.2,1)" });
                }
              }}
            >
              <Icon name="phone" size={18} />
              Open the tap page
            </a>
          </section>
        ) : null}
        {!allDone && (
          <div class="checklist" aria-label="Setup">
            <span class="eyebrow">Setup</span>
            <Chip done={data.checklist.connected} label="Connected Buffer" href={`${base}/setup#buffer`} />
            <Chip done={data.checklist.card} label="Print your card" href={`${base}/setup#card`} />
            <Chip done={data.checklist.counter} label="Open the counter" href={`${base}/setup#counter`} />
            <Chip done={data.checklist.phone} label="Ring my phone" href={`${base}/setup#phone`} />
            <Chip done={data.checklist.thankYou} label="Thank-you after a tap" href={`${base}/setup#thank-you`} />
            <Chip done={data.checklist.review} label="Ask for a review" href={`${base}/setup#review`} />
          </div>
        )}
        {data.strips.rateLimited && <div class="strip">New posts will show up in a little while.</div>}
        {data.strips.reconnect && (
          <div class="strip">
            <span>Reconnect Buffer to keep new posts coming.</span>
            <a class="btn" href="/auth/start">
              Reconnect Buffer
            </a>
          </div>
        )}
        <BellBanner ring={ring} onGone={() => setRing(null)} />
        <div class="wall-head">
          <h1 class="h1">Your posts</h1>
          <span class="range">
            Last 60 days · {data.countThisWeek === 1 ? "1 person" : `${data.countThisWeek} people`} this week
          </span>
          <button class="btn quiet sm refresh" onClick={doRefresh} disabled={refresh === "checking"}>
            {refresh === "checking" ? <span class="spin" aria-hidden="true" /> : <Icon name="refresh" size={18} />}
            {refresh === "rest" ? "Refresh" : refresh === "checking" ? "Checking…" : "Checked a moment ago"}
          </button>
        </div>
        {shown.length ? (
          <div class="wall">
            {shown.map((t, i) => (
              <Tile key={t.id} tile={t} index={i} now={now} tz={tz} flash={flash === t.id} />
            ))}
          </div>
        ) : data.sync.status === "running" ? (
          <p class="small muted">Reading your posts… {data.sync.count} so far</p>
        ) : (
          <div class="empty">
            <h2 class="h2">Nothing sent yet.</h2>
            <p class="muted">Post something in Buffer and it shows up here within 15 minutes. Meanwhile, try the sample bakery.</p>
            <a class="btn" href="/sample">
              Try the sample bakery
            </a>
          </div>
        )}
        <footer class="app-foot privacy">
          <span>Anonymous. A post, a time, nothing else.</span>
          <a href="/privacy">Privacy</a>
          <span>Built for Buffer Commit 2026</span>
          {sample && <a href="/credits">Photo credits</a>}
        </footer>
      </main>
      {sample && <PhoneFrame open={sheet} onOpen={() => setSheet(true)} onClose={() => setSheet(false)} src="/sample/t" />}
    </div>
  );
}

function Chip({ done, label, href }: { done: boolean; label: string; href: string }): JSX.Element {
  return (
    <a class={`chip${done ? " done" : ""}`} href={href}>
      <span class="box">{done && <Icon name="check" size={12} />}</span>
      {label}
    </a>
  );
}
