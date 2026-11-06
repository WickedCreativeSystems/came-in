// The wall (plan 3.4) for a real shop and for the sample bakery (plan 3.10).
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WallData, RoomMessage, RingMessage } from "@shared/types";
import { api, ApiError } from "../lib/api";
import { connectRoom } from "../lib/room";
import { deviceId } from "../lib/device";
import { ringSound } from "../lib/bell";
import { applyTheme } from "../lib/theme";
import { HeaderSkeleton, TilesSkeleton } from "../ui/Skeleton";
import { LocationTabs } from "../ui/LocationTabs";
import { readTab, saveTab, locQuery } from "../lib/locationTab";
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
  // On a phone a tap made in the sample's tap sheet holds the wall's ring until the sheet closes (plan 3.10).
  const sheetOpen = useRef(false);
  sheetOpen.current = sheet;
  const held = useRef<RingMessage[]>([]);
  // The location tab (null: all locations), shared with This week and A post (plan 3.13).
  const locRef = useRef<string | null>(null);
  const restored = useRef(false);
  const ringKey = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  async function load() {
    try {
      const d = await api<WallData>((sample ? "/api/sample/wall" : "/api/wall") + (sample ? "" : locQuery(locRef.current)));
      // First load: come back to the tab this browser last chose for this shop.
      if (!restored.current && !sample) {
        restored.current = true;
        const saved = readTab(d.shop.id);
        if (saved && d.locations.some((l) => l.id === saved) && saved !== locRef.current) {
          locRef.current = saved;
          return load();
        }
      }
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
    // A tap taken back from the staff screen: counts and header drop by one (plan 3.6). The bell that rang stays rung.
    else if (m.type === "undo") void load();
    else if (m.type === "posts" || (m.type === "sync" && m.done)) void load();
  }

  // look.md section 9: sound at once, banner the same instant, sticker and header tick at +300 ms.
  function onRing(m: RingMessage) {
    if (sheetOpen.current && !matchMedia("(min-width: 1024px)").matches) {
      held.current.push(m);
      return;
    }
    playRing(m);
  }

  function playRing(m: RingMessage) {
    ringSound();
    ringKey.current += 1;
    setRing({ key: ringKey.current, sentence: m.sentence, where: m.where, imageUrl: m.imageUrl, href: m.tileId ? `${sample ? "/sample" : ""}/post/${m.tileId}` : null });
    setTimeout(() => {
      // A chosen location's counts are its own: the ring only carries all-location counts, so ask again.
      if (locRef.current) {
        if (m.tileId) setFlash(m.tileId);
        void load();
        return;
      }
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

  // The sheet has closed: the ring it held plays in full now (sound, banner scrolled into view, ticks, the 8 s clock).
  useEffect(() => {
    if (sheet || !held.current.length) return;
    const q = held.current.splice(0);
    const t = requestAnimationFrame(() => q.forEach(playRing));
    return () => cancelAnimationFrame(t);
  }, [sheet]);

  // "Now try a tap" in Setup comes here: the same as Open the tap page, once the wall is drawn.
  useEffect(() => {
    if (!sample || !data) return;
    const u = new URL(location.href);
    if (u.searchParams.get("try") !== "1") return;
    u.searchParams.delete("try");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    tryTap();
  }, [!!data]);

  // The sample's "Open the tap page" keeps the wall in view so its ring is seen (plan 3.10, P6):
  // on a phone it opens the Try a tap sheet; on a computer it brings the phone frame into view and focuses its first tile.
  function openTapPage(e: JSX.TargetedMouseEvent<HTMLAnchorElement>) {
    if (!sample || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    tryTap();
  }

  function tryTap() {
    if (!matchMedia("(min-width: 1024px)").matches) {
      setSheet(true);
      return;
    }
    const frame = document.querySelector<HTMLElement>(".phone-wrap .phone");
    const iframe = document.querySelector<HTMLIFrameElement>(".phone-wrap iframe.screen");
    if (!frame || !iframe) return;
    const r = frame.getBoundingClientRect();
    if (r.top < 88 || r.bottom > innerHeight) {
      const rm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: r.top - 88, behavior: rm ? "auto" : "smooth" });
    }
    const focusTile = (tries: number) => {
      const doc = iframe.contentDocument;
      const tile = doc?.querySelector<HTMLElement>("#g .t, .t");
      if (tile) {
        iframe.contentWindow?.focus();
        // Programmatic focus after a mouse press shows no ring by default; ask for the ordinary one.
        (tile as HTMLElement & { focus(o?: { focusVisible?: boolean; preventScroll?: boolean }): void }).focus({ focusVisible: true, preventScroll: true });
      } else if (tries > 0) setTimeout(() => focusTile(tries - 1), 100);
    };
    focusTile(20);
  }

  async function showOnCard(id: string) {
    try {
      await api(`${sample ? "/api/sample/post" : "/api/post"}/${encodeURIComponent(id)}`, { json: { hidden: false } });
      await load();
    } catch {}
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
      <>
        <HeaderSkeleton />
        <main class="page">
          {error && <div class="strip stamp" role="alert">Something's wrong on our side. Try again in a minute.</div>}
          {!error && <TilesSkeleton />}
        </main>
      </>
    );
  }

  const now = new Date(data.now);
  const tz = data.shop.timezone;
  const shown = data.tiles;
  const base = sample ? "/sample" : "";
  const tapUrl = sample ? "/sample/t" : `/t/${data.shop.id}?try=1`;
  const allDone = Object.values(data.checklist).every(Boolean);

  return (
    <div class={sample ? "with-phone" : ""}>
      <Header shop={data.shop} today={data.countToday} tab="wall" base={base} />
      <main class={`page${sample ? " with-try" : ""}`}>
        {error && <div class="strip stamp" role="alert">Something's wrong on our side. Try again in a minute.</div>}
        {sample && (
          <div class="strip">
            <span>Sample bakery. Nothing here reaches a real shop. Tap a post and this wall rings.</span>
            <a class="btn primary sm" href="/auth/start">
              Connect your own Buffer
            </a>
          </div>
        )}
        <LocationTabs
          locations={data.locations}
          value={data.location}
          onChange={(id) => {
            locRef.current = id;
            saveTab(data.shop.id, id);
            void load();
          }}
        />
        {!data.hasTapped || sample ? (
          <section class="try" aria-label="Try it">
            <div class="qr-col">
              <div class="qr">
                <img src={sample ? "/qr/sample.svg" : `/qr/${data.shop.id}.svg`} alt="QR code for the tap page" width="96" height="96" />
              </div>
              <p class="caption muted qr-cap">The same code is on your printed card.</p>
            </div>
            <div>
              <h2 class="h2">This is what your customers will tap.</h2>
              <p class="small muted">
                <span class="on-desk">Try it: open the tap page or scan the code with your phone, tap a post, and this page rings.</span>
                <span class="on-phone">Try it: open the tap page, tap a post, and this page rings.</span>
              </p>
            </div>
            <div class="try-actions">
              <a
                class="btn"
                href={tapUrl}
                target={sample ? undefined : "_blank"}
                rel={sample ? undefined : "noopener"}
                onClick={openTapPage}
              >
                <Icon name="phone" size={18} />
                Open the tap page
              </a>
              {sample && (
                <div class="counter-link">
                  <a class="btn quiet" href="/sample/c">
                    Open the staff screen
                  </a>
                  <span class="small muted">At the till, staff tap here for a customer.</span>
                </div>
              )}
              <div class="print-card">
                <span class="small muted">
                  <span class="on-desk">Put this code on your counter:</span>
                  <span class="on-phone">Put your code on the counter:</span>
                </span>
                <a class="btn quiet sm card-btn" href={`${base}/card`}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
                    <rect x="6" y="3" width="12" height="18" rx="2.5" />
                    <circle cx="12" cy="8" r="1.6" />
                  </svg>
                  Print your card
                </a>
              </div>
            </div>
          </section>
        ) : null}
        {!allDone && (
          <div class="checklist" aria-label="Setup">
            <span class="eyebrow">Setup</span>
            <Chip done={data.checklist.connected} label="Connected Buffer" href={`${base}/setup#buffer`} />
            <Chip done={data.checklist.card} label="Print your card" href={`${base}/setup#card`} />
            <Chip done={data.checklist.counter} label="Open the staff screen" href={`${base}/setup#staff`} />
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
            Counts on each post cover the last 60 days. Today and this week are in <a class="range-link" href={`${base}/week`}>This week</a>.
          </span>
          <button class="btn quiet sm refresh" onClick={doRefresh} disabled={refresh === "checking"}>
            {refresh === "checking" ? <span class="spin" aria-hidden="true" /> : <Icon name="refresh" size={18} />}
            {refresh === "rest" ? "Refresh" : refresh === "checking" ? "Checking…" : "Checked a moment ago"}
          </button>
        </div>
        {shown.length ? (
          <div class="wall">
            {shown.map((t, i) =>
              t.hidden ? (
                <div class="week-tile" key={t.id}>
                  <Tile tile={t} index={i} now={now} tz={tz} flash={flash === t.id} href={`${base}/post/${t.id}`} />
                  <div class="tile-actions">
                    <button class="tile-action" onClick={() => void showOnCard(t.id)}>
                      Show on the card
                    </button>
                  </div>
                </div>
              ) : (
                <Tile key={t.id} tile={t} index={i} now={now} tz={tz} flash={flash === t.id} href={`${base}/post/${t.id}`} />
              ),
            )}
          </div>
        ) : data.sync.status === "running" ? (
          <p class="small muted">Reading your posts…{data.sync.count > 0 ? ` ${data.sync.count} so far` : ""}</p>
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
