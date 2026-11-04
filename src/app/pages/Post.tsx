// A post (plan 3.9; P12, P13, P17).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { WallData, WallTile } from "@shared/types";
import { seeItOn } from "@shared/marks";
import { api, ApiError } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { Header } from "../ui/Header";
import { Marks } from "../ui/marks";
import { Icon } from "../ui/icons";
import { PostAgainSheet, outcomeLine, type Channel, type Outcome } from "../ui/Sheets";

interface PostData {
  tile: WallTile;
  sent: string;
  byDay: { label: string; n: number }[];
  bySource: { label: string; n: number }[];
  noteLeft: boolean;
  media: "image" | "video" | "none";
  channels: Channel[];
}

function Receipt({ rows }: { rows: { label: string; n: number }[] }): JSX.Element | null {
  if (!rows.length) return null;
  return (
    <ul class="receipt">
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <span class="leader" aria-hidden="true" />
          <span class="num">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

export function Post({ sample, tileId }: { sample: boolean; tileId: string }): JSX.Element {
  const [wall, setWall] = useState<WallData | null>(null);
  const [data, setData] = useState<PostData | null>(null);
  const [missing, setMissing] = useState(false);
  const [nick, setNick] = useState("");
  const [nickState, setNickState] = useState<"rest" | "saving" | "saved">("rest");
  const [nickErr, setNickErr] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [ideaLine, setIdeaLine] = useState<string | null>(null);
  const base = sample ? "/sample" : "";
  const apiBase = `${sample ? "/api/sample/post" : "/api/post"}/${encodeURIComponent(tileId)}`;

  async function load() {
    try {
      const d = await api<PostData>(apiBase);
      setData(d);
      setNick(d.tile.nickname ?? "");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) location.href = "/";
      else setMissing(true);
    }
  }
  useEffect(() => {
    api<WallData>(sample ? "/api/sample/wall" : "/api/wall")
      .then((w) => {
        setWall(w);
        applyTheme(w.shop.theme);
      })
      .catch(() => (location.href = "/"));
    void load();
  }, []);

  if (!wall) return <main class="page" />;
  const t = data?.tile;
  return (
    <>
      <Header shop={wall.shop} today={wall.countToday} tab="wall" base={base} />
      <main class="page post-page">
        <a class="btn quiet sm back" href={sample ? "/sample" : "/wall"}>
          Your posts
        </a>
        {missing && <p class="muted">This post isn't on your wall any more.</p>}
        {t && data && (
          <div class="post-grid">
            <div class="post-photo">
              {t.imageUrl ? (
                <img src={t.imageUrl.replace(/(\/i\/[a-z]{10}\/[^/]+)$/, "$1")} alt="" />
              ) : (
                <div class="text-only big">
                  <span class="first">{t.text}</span>
                </div>
              )}
            </div>
            <div class="post-body">
              <p class="post-text">{t.text}</p>
              <div class="post-meta">
                <Marks services={t.services} />
                <span class="caption muted">{data.sent}</span>
              </div>
              {t.links.length > 0 && (
                <p class="post-links">
                  {t.links.map((l) => (
                    <a key={l.url} class="btn quiet sm" href={l.url} target="_blank" rel="noopener">
                      {seeItOn(l.service)}
                      <Icon name="external" size={16} />
                    </a>
                  ))}
                </p>
              )}
              <div class="post-count">
                <span class="count-big">{t.count}</span>
                <span class="h2">{t.count === 1 ? "person came in because of this post." : "people came in because of this post."}</span>
              </div>
              <Receipt rows={data.byDay} />
              <Receipt rows={data.bySource} />

              <div class="field nick">
                <div class="eyebrow">Nickname</div>
                <div class="field-row">
                  <label class="sr" for="nickname">
                    Nickname
                  </label>
                  <input
                    id="nickname"
                    class={`input${nickErr ? " error" : ""}`}
                    value={nick}
                    maxLength={24}
                    placeholder="the sourdough post"
                    onInput={(e) => {
                      setNick((e.target as HTMLInputElement).value);
                      setNickState("rest");
                      setNickErr(null);
                    }}
                  />
                  <button
                    class="btn primary"
                    disabled={nickState === "saving"}
                    onClick={async () => {
                      setNickState("saving");
                      try {
                        await api(apiBase, { json: { nickname: nick } });
                        setNickState("saved");
                        void load();
                      } catch (e) {
                        setNickErr(e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : outcomeLine("failed"));
                        setNickState("rest");
                      }
                    }}
                  >
                    {nickState === "saved" ? "Saved" : "Save"}
                  </button>
                </div>
                {nickErr && (
                  <div class="input-error" role="alert">
                    {nickErr}
                  </div>
                )}
                <p class="small muted">Used in the bell: Someone just came in because of {nick.trim() || "the sourdough post"}.</p>
              </div>

              <div class="btn-row">
                <button class="btn" onClick={() => setAgain(true)}>
                  Post it again
                </button>
                <button
                  class="btn"
                  onClick={async () => {
                    try {
                      const r = await api<{ outcome: Outcome }>(`${apiBase}/idea`, { method: "POST" });
                      setIdeaLine(outcomeLine(r.outcome));
                    } catch {
                      setIdeaLine(outcomeLine("failed"));
                    }
                  }}
                >
                  More like this
                </button>
                <button
                  class="btn quiet"
                  onClick={async () => {
                    try {
                      await api(apiBase, { json: { hidden: !t.hidden } });
                      void load();
                    } catch {}
                  }}
                >
                  {t.hidden ? "Show on the card" : "Hide from the card"}
                </button>
              </div>
              {line && <p class="small outcome">{line}</p>}
              {ideaLine && <p class="small outcome">{ideaLine}</p>}
              {(t.tagged || data.noteLeft) && (
                <p class="caption status-lines">
                  <Icon name="tag" size={14} />
                  {[t.tagged ? 'Tagged "Came in" in Buffer' : null, data.noteLeft ? "Note left in Buffer" : null].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>
        )}
      </main>
      {again && data && (
        <PostAgainSheet
          endpoint={`${apiBase}/again`}
          channels={data.channels}
          onClose={() => setAgain(false)}
          onDone={(o) => {
            setLine(outcomeLine(o));
            setAgain(false);
          }}
        />
      )}
    </>
  );
}
