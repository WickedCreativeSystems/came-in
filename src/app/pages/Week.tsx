// This week (plan 3.7; P11, P12, P14).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { WallData, WallTile } from "@shared/types";
import { api, ApiError } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { drawShare } from "../lib/share";
import { Header } from "../ui/Header";
import { Tile } from "../ui/Tile";
import { PostAgainSheet, PostThisSheet, Sheet, outcomeLine, resultLine, type Channel, type Outcome } from "../ui/Sheets";

type Range = "this" | "last" | "month";

interface WeekData {
  range: Range;
  summary: { headline: string; patterns: string[]; ratio: string | null; receipts: { label: string; n: number }[]; people: number; posts: number; topTileId: string | null };
  tiles: (WallTile & { weekPeople: number })[];
  channels: Channel[];
  drafts: boolean;
}

function rangeFromUrl(): Range {
  const r = new URLSearchParams(location.search).get("range");
  return r === "last" || r === "month" ? r : "this";
}

export function Week({ sample }: { sample: boolean }): JSX.Element {
  const [wall, setWall] = useState<WallData | null>(null);
  const [range, setRange] = useState<Range>(rangeFromUrl());
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState(false);
  const [again, setAgain] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, string>>({});
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
      })
      .catch((e) => (e instanceof ApiError && e.status === 401 ? (location.href = "/") : setError(true)));
  }, []);
  useEffect(() => {
    setData(null);
    const u = new URL(location.href);
    u.searchParams.set("range", range);
    history.replaceState(null, "", u.pathname + (range === "this" ? "" : `?range=${range}`));
    api<WeekData>(`${sample ? "/api/sample/week" : "/api/week"}?range=${range}`)
      .then(setData)
      .catch(() => setError(true));
  }, [range]);

  if (!wall) return <main class="page">{error && <div class="strip stamp" role="alert">Something's wrong on our side. Try again in a minute.</div>}</main>;
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
            <span>Sample bakery. Nothing here reaches a real shop. Tap a post and this page rings.</span>
            <a class="btn primary sm" href="/auth/start">
              Connect your own Buffer
            </a>
          </div>
        )}
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
            {data.summary.patterns.map((p) => (
              <p key={p} class="pattern">
                {p}
              </p>
            ))}
            {data.summary.ratio && <p class="ratio body-strong">{data.summary.ratio}</p>}
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
                Post this
              </button>
            </div>
            {postLine && <p class={`small outcome${postLine === outcomeLine("failed") ? " failed" : ""}`}>{postLine}</p>}
            <div class="wall week-wall">
              {data.tiles.map((t, i) => (
                <div class="week-tile" key={t.id}>
                  <Tile tile={{ ...t, count: t.weekPeople }} index={i} now={now} tz={wall.shop.timezone} flash={false} href={`${base}/post/${t.id}`} />
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
              ))}
            </div>
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
            setLines((l) => ({ ...l, [again]: resultLine(r) }));
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
