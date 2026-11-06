// This week (plan 3.7; P11, P12, P14).
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WallData, WallTile } from "@shared/types";
import { api, ApiError } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { drawShare } from "../lib/share";
import { HeaderSkeleton, TilesSkeleton } from "../ui/Skeleton";
import { Header } from "../ui/Header";
import { Tile } from "../ui/Tile";
import { LocationTabs } from "../ui/LocationTabs";
import { readTab, saveTab, locQuery } from "../lib/locationTab";
import { PostAgainSheet, PostThisSheet, QueueLine, Sheet, outcomeLine, resultLine, type Channel, type Outcome } from "../ui/Sheets";

type Range = "today" | "this" | "last" | "month";

interface WeekData {
  range: Range;
  summary: { headline: string; patterns: string[]; ratio: string | null; receipts: { label: string; n: number }[]; people: number; posts: number; topTileId: string | null };
  tiles: (WallTile & { weekPeople: number; byLocation?: { label: string; n: number }[] })[];
  channels: Channel[];
  drafts: boolean;
}

function rangeFromUrl(): Range {
  const r = new URLSearchParams(location.search).get("range");
  return r === "today" || r === "last" || r === "month" ? r : "this";
}

export function Week({ sample }: { sample: boolean }): JSX.Element {
  const [wall, setWall] = useState<WallData | null>(null);
  const [range, setRange] = useState<Range>(rangeFromUrl());
  // The location tab (null: all), shared with the Wall and A post; undefined until the shop is known (plan 3.13).
  const [loc, setLoc] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState(false);
  const [again, setAgain] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, string>>({});
  // The line Post it again leaves under its tile: one at a time, it stays until the page is left (plan 3.9).
  const [queued, setQueued] = useState<{ id: string; text: string; failed: boolean; n: number; name?: string } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(2);
  const [share, setShare] = useState<null | { story: string | null; square: string | null; storyUrl: string | null; squareUrl: string | null; busy: boolean }>(null);
  const [postThis, setPostThis] = useState(false);
  const [postLine, setPostLine] = useState<string | null>(null);
  const [busyIdea, setBusyIdea] = useState<Record<string, boolean>>({});
  const base = sample ? "/sample" : "";

  useEffect(() => {
    api<WallData>(sample ? "/api/sample/wall" : "/api/wall")
      .then((w) => {
        setWall(w);
        applyTheme(w.shop.theme);
        const saved = sample ? null : readTab(w.shop.id);
        setLoc(saved && w.locations.some((l) => l.id === saved) ? saved : null);
      })
      .catch((e) => (e instanceof ApiError && e.status === 401 ? (location.href = "/") : setError(true)));
  }, []);
  useEffect(() => {
    if (loc === undefined) return;
    setData(null);
    // The header's count follows the chosen location too.
    if (!sample) api<WallData>(`/api/wall${locQuery(loc)}`).then(setWall).catch(() => undefined);
    const u = new URL(location.href);
    u.searchParams.set("range", range);
    history.replaceState(null, "", u.pathname + (range === "this" ? "" : `?range=${range}`));
    api<WeekData>(`${sample ? "/api/sample/week" : "/api/week"}?range=${range}${sample ? "" : locQuery(loc, "&")}`)
      .then(setData)
      .catch(() => setError(true));
  }, [range, loc]);

  // How many tiles sit in a row now, so the line goes under the row that holds its tile.
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const count = () => setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length));
    count();
    const ro = new ResizeObserver(count);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!data, !!wall]);

  if (!wall)
    return (
      <>
        <HeaderSkeleton />
        <main class="page">
          {error && <div class="strip stamp" role="alert">Something's wrong on our side. Try again in a minute.</div>}
          {!error && <TilesSkeleton />}
        </main>
      </>
    );
  const now = new Date(wall.now);
  const top = data?.tiles.find((t) => t.id === data.summary.topTileId) ?? null;

  async function openShare() {
    if (!data || !top) return;
    setShare({ story: null, square: null, storyUrl: null, squareUrl: null, busy: true });
    const input = { photoUrl: top.imageUrl, text: top.text, people: top.weekPeople, shopName: wall!.shop.name, avatarUrl: wall!.shop.avatarUrl };
    try {
      const [story, square] = await Promise.all([drawShare("story", input), drawShare("square", input)]);
      const up = (kind: string, blob: Blob) =>
        sample
          ? Promise.resolve("sample")
          : fetch(`/api/share/${kind}?range=${range}`, { method: "POST", headers: { "content-type": "image/png" }, body: blob, credentials: "same-origin" })
          .then((r) => r.json() as Promise<{ url?: string }>)
          .then((j) => j.url ?? null)
          .catch(() => null);
      const [storyUrl, squareUrl] = await Promise.all([up("story", story), up("square", square)]);
      setShare({ story: URL.createObjectURL(story), square: URL.createObjectURL(square), storyUrl, squareUrl, busy: false });
    } catch {
      setShare(null);
      setPostLine(outcomeLine("failed"));
    }
  }

  const tabs: [Range, string][] = [
    ["today", "Today"],
    ["this", "This week"],
    ["last", "Last week"],
    ["month", "This month"],
  ];

  return (
    <>
      <Header shop={wall.shop} today={wall.countToday} tab="week" base={base} />
      <main class="page week">
        {sample && (
          <div class="strip">
            <span>Sample bakery. Nothing here reaches a real shop. Tap a post and this wall rings.</span>
            <a class="btn primary sm" href="/auth/start">
              Connect your own Buffer
            </a>
          </div>
        )}
        <LocationTabs
          locations={wall.locations}
          value={loc ?? null}
          onChange={(id) => {
            saveTab(wall.shop.id, id);
            setLoc(id);
          }}
        />
        <nav class="range-tabs" aria-label="Range">
          {tabs.map(([r, label]) => (
            <button key={r} class="range-tab body-strong" aria-pressed={range === r} onClick={() => setRange(r)}>
              {label}
            </button>
          ))}
        </nav>
        {!data ? (
          <p class="small muted">
            <span class="spin" aria-hidden="true" />
          </p>
        ) : (
          <>
            <h1 class="h1 week-headline">{data.summary.headline}</h1>
            {range !== "today" && (
              <>
            {data.summary.patterns.map((p) => (
              <p key={p} class="pattern">
                {p}
              </p>
            ))}
            {data.summary.ratio && <p class="ratio body-strong">{data.summary.ratio}</p>}
            {data.summary.receipts.length > 0 && <div class="eyebrow receipt-eyebrow">NOT FROM A POST</div>}
            {data.summary.receipts.length > 0 && (
              <ul class="receipt">
                {data.summary.receipts.map((r) => (
                  <li key={r.label}>
                    <span>{r.label}</span>
                    <span class="leader" aria-hidden="true" />
                    <span class="num">{r.n}</span>
                  </li>
                ))}
              </ul>
            )}
            <div class="btn-row week-actions">
              <button class="btn" disabled={!top} onClick={openShare}>
                Share this week
              </button>
              <button
                class="btn"
                disabled={!top}
                onClick={async () => {
                  if (!share?.squareUrl) await openShare();
                  setPostThis(true);
                }}
              >
                Post this week's picture
              </button>
            </div>
              </>
            )}
            {postLine && <p class={`small outcome${postLine === outcomeLine("failed") ? " failed" : ""}`}>{postLine}</p>}
            <div class="wall week-wall" ref={grid}>
              {data.tiles.filter((t) => t.weekPeople > 0).flatMap((t, i, all) => {
                const rowEnd = Math.min(all.length - 1, (Math.floor(i / cols) + 1) * cols - 1);
                const line = queued && i === rowEnd && all.slice(Math.floor(i / cols) * cols, rowEnd + 1).some((x) => x.id === queued.id);
                return [(
                <div class="week-tile" key={t.id}>
                  <Tile tile={{ ...t, count: t.weekPeople }} index={i} now={now} tz={wall.shop.timezone} flash={false} href={`${base}/post/${t.id}`} />
                  {t.byLocation && t.byLocation.length > 0 && <p class="caption muted by-loc">{t.byLocation.map((x, k) => <>{k > 0 && " · "}<span class="by-loc-item" key={x.label}><span class="nm">{x.label}</span><span class="n">{"\u00a0"}{x.n}</span></span></>)}</p>}
                  <div class="tile-actions">
                    <button class="tile-action" aria-label="Post it again" onClick={() => setAgain(t.id)}>
                      <span class="long">Post it again</span>
                      <span class="short" aria-hidden="true">Post again</span>
                    </button>
                    <span class="tile-divider" aria-hidden="true" />
                    <button
                      class="tile-action"
                      aria-label="More like this"
                      disabled={!!busyIdea[t.id]}
                      onClick={async () => {
                        if (busyIdea[t.id]) return;
                        setBusyIdea((b) => ({ ...b, [t.id]: true }));
                        try {
                          const r = await api<{ outcome: Outcome }>(`${sample ? "/api/sample/post" : "/api/post"}/${t.id}/idea`, { method: "POST" });
                          setLines((l) => ({ ...l, [t.id]: outcomeLine(r.outcome) }));
                        } catch {
                          setLines((l) => ({ ...l, [t.id]: outcomeLine("failed") }));
                        }
                        setBusyIdea((b) => ({ ...b, [t.id]: false }));
                      }}
                    >
                      <span class="long">More like this</span>
                      <span class="short" aria-hidden="true">More like it</span>
                    </button>
                    {t.hidden && (
                      <>
                        <span class="tile-divider" aria-hidden="true" />
                        <button
                          class="tile-action"
                          onClick={async () => {
                            try {
                              await api(`${sample ? "/api/sample/post" : "/api/post"}/${t.id}`, { json: { hidden: false } });
                              setData((d) => (d ? { ...d, tiles: d.tiles.map((x) => (x.id === t.id ? { ...x, hidden: false } : x)) } : d));
                            } catch {}
                          }}
                        >
                          Show on the card
                        </button>
                      </>
                    )}
                  </div>
                  {lines[t.id] && <p class={`small outcome${lines[t.id] === outcomeLine("failed") ? " failed" : ""}`}>{lines[t.id]}</p>}
                </div>
                ),
                ...(line && queued ? [<div class="queue-row" key={`q-${queued.n}`}><QueueLine text={queued.text} name={queued.name} failed={queued.failed} /></div>] : []),
                ];
              })}
            </div>
            {(() => {
              const nobody = data.tiles.filter((t) => t.weekPeople === 0).length;
              const when = range === "last" ? "last week" : range === "month" ? "this month" : "this week";
              return range !== "today" && nobody > 0 ? <p class="caption muted other-posts">{nobody === 1 ? "1 other post had" : `${nobody} other posts had`} nobody {when}.</p> : null;
            })()}
          </>
        )}
        <footer class="app-foot privacy">
          <span>Anonymous. A post, a time, nothing else.</span>
          <a href="/privacy">Privacy</a>
          <span>Built for Buffer Commit 2026</span>
          {sample && <a href="/credits">Photo credits</a>}
        </footer>
      </main>
      {again && data && (
        <PostAgainSheet
          endpoint={`${sample ? "/api/sample/post" : "/api/post"}/${again}/again`}
          targets={`${sample ? "/api/sample/post" : "/api/post"}/${again}/targets`}
          postName={data.tiles.find((x) => x.id === again)?.name}
          imageUrl={data.tiles.find((x) => x.id === again)?.imageUrl}
          sample={sample}
          onClose={() => setAgain(null)}
          onDone={(r) => {
            const name = data.tiles.find((x) => x.id === again)?.name;
            const text = resultLine(r, name);
            setQueued((q) => ({ id: again, text, name, failed: text === outcomeLine("failed"), n: (q?.n ?? 0) + 1 }));
            setAgain(null);
          }}
        />
      )}
      {share && !postThis && (
        <Sheet title="Share this week" onClose={() => setShare(null)}>
          {share.busy ? (
            <p class="small muted">
              <span class="spin" aria-hidden="true" />
            </p>
          ) : (
            <div class="share-grid">
              {(["story", "square"] as const).map((k) => (
                <figure key={k}>
                  <img src={share[k]!} alt={k === "story" ? "The week as a story image" : "The week as a square image"} />
                  <a class="btn sm" href={share[k]!} download={`came-in-${range}-${k}.png`}>
                    Save
                  </a>
                </figure>
              ))}
            </div>
          )}
        </Sheet>
      )}
      {postThis && data && top && (
        <PostThisSheet
          endpoint={sample ? "/api/sample/week/post" : "/api/week/post"}
          targets={sample ? "/api/sample/week/targets" : "/api/week/targets"}
          text={`${top.weekPeople} of you came in because of this post ${range === "this" ? "this week" : range === "last" ? "last week" : "this month"}. Thank you.`}
          image={share?.squareUrl ?? ""}
          onClose={() => {
            setPostThis(false);
            setShare(null);
          }}
          onDone={(r) => {
            setPostLine(resultLine(r));
            setPostThis(false);
            setShare(null);
          }}
        />
      )}
    </>
  );
}
