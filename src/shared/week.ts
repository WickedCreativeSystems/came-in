// This week (plan 1.7, 3.7; P11): the headline, the pattern lines, the honest
// ratio and the receipt lines, from taps. Shared by the Worker and the sample.
import { weekdayName, timeBucket, type TimeBucket } from "./time";

export type Range = "today" | "this" | "last" | "month";

export interface WeekTap {
  tileId: string | null;
  answer: "post" | "walked_past" | "friend" | "google";
  source: string;
  at: string;
}

export interface WeekTile {
  id: string;
  firstSentAt: string;
  kind: "photo" | "video" | "text" | "link";
  kindDetail: "real_photo" | "graphic" | "text_image" | null;
  isStory: boolean;
}

export interface WeekSummary {
  headline: string;
  patterns: string[];
  ratio: string | null;
  receipts: { label: string; n: number }[];
  people: number;
  posts: number;
  ranked: { tileId: string; people: number }[];
  topTileId: string | null;
}

export function rangeWords(r: Range): string {
  return r === "today" ? "today" : r === "last" ? "last week" : r === "month" ? "this month" : "this week";
}

function people(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/**
 * The ratio line (plan 1.7): counter taps only, at least 10 in the window.
 * "1 in N" with N = round(all ÷ post taps); if post taps are the majority,
 * the reduced fraction.
 */
export function ratioLine(counterAll: number, counterPost: number): string | null {
  if (counterAll < 10 || counterPost === 0) return null;
  if (counterPost * 2 > counterAll) {
    const g = gcd(counterPost, counterAll);
    return `${counterPost / g} in ${counterAll / g} new customers who told us came because of a post.`;
  }
  return `1 in ${Math.round(counterAll / counterPost)} new customers who told us came because of a post.`;
}

const BUCKET_WORDS: Record<TimeBucket, [string, string]> = {
  morning: ["in the morning", "mornings"],
  midday: ["at midday", "middays"],
  afternoon: ["in the afternoon", "afternoons"],
  evening: ["in the evening", "evenings"],
  night: ["at night", "nights"],
};

export function summarize(taps: WeekTap[], tiles: WeekTile[], tz: string, range: Range): WeekSummary {
  const byTile = new Map(tiles.map((t) => [t.id, t]));
  const postTaps = taps.filter((t) => t.answer === "post" && t.tileId && byTile.has(t.tileId));
  const counts = new Map<string, number>();
  for (const t of postTaps) counts.set(t.tileId!, (counts.get(t.tileId!) ?? 0) + 1);
  const n = postTaps.length;
  const posts = counts.size;
  const answers = taps.length;
  const words = rangeWords(range);

  // Headline (plan 3.7): 0, under ten answers, or the full sentence.
  let headline: string;
  if (range === "today") headline = n === 0 ? "Nobody has tapped yet today." : `${people(n)} came in today because of ${posts === 1 ? "1 post" : `${posts} posts`}.`;
  else if (n === 0) headline = range === "this" ? "Nobody has tapped yet this week." : range === "month" ? "Nobody has tapped yet this month." : "Nobody tapped last week.";
  else if (answers < 10) headline = `${people(n)} said a post brought them in ${words}.`;
  else headline = `${people(n)} came in because of ${posts === 1 ? "1 post" : `${posts} posts`}.`;

  // Pattern lines (plan 1.7): only with at least 3 people; all-zero lines hidden; at most 4, biggest first.
  const lines: { text: string; weight: number }[] = [];
  if (n >= 3) {
    const tileOf = (t: WeekTap) => byTile.get(t.tileId!)!;
    const sorted = postTaps.some((t) => tileOf(t).kindDetail);
    if (sorted) {
      const real = postTaps.filter((t) => tileOf(t).kindDetail === "real_photo").length;
      const graphic = postTaps.filter((t) => tileOf(t).kindDetail === "graphic" || tileOf(t).kindDetail === "text_image").length;
      if (real || graphic) lines.push({ text: `Photos of real things brought ${people(real)}. Graphics brought ${graphic}.`, weight: Math.max(real, graphic) });
    } else {
      const photos = postTaps.filter((t) => tileOf(t).kind === "photo").length;
      const videos = postTaps.filter((t) => tileOf(t).kind === "video").length;
      const textOnly = postTaps.filter((t) => tileOf(t).kind === "text" || tileOf(t).kind === "link").length;
      if (photos || videos || textOnly) lines.push({ text: `Photos brought ${people(photos)}. Videos brought ${videos}. Text-only posts brought ${textOnly}.`, weight: Math.max(photos, videos, textOnly) });
    }
    // Best day: the weekday the posts that brought people in were sent.
    const days = new Map<string, number>();
    for (const t of postTaps) {
      const d = weekdayName(new Date(tileOf(t).firstSentAt), tz);
      days.set(d, (days.get(d) ?? 0) + 1);
    }
    const best = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) lines.push({ text: `Your best day was ${best[0]}: ${people(best[1])}.`, weight: best[1] });
    // Time of day the posts were sent, in shop time.
    const buckets = new Map<TimeBucket, number>();
    for (const t of postTaps) {
      const b = timeBucket(new Date(tileOf(t).firstSentAt), tz);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    if (top.length) {
      const [b1, n1] = top[0];
      const second = top[1];
      // The line names the two biggest times; anyone in the others is added, so it always adds up to the headline.
      const others = top.slice(2).reduce((n, [, c]) => n + c, 0);
      const tail = others > 0 ? `; other times ${others}` : "";
      lines.push({ text: second ? `Posts sent ${BUCKET_WORDS[b1][0]} brought ${people(n1)}; ${BUCKET_WORDS[second[0]][1]} ${second[1]}${tail}.` : `Posts sent ${BUCKET_WORDS[b1][0]} brought ${people(n1)}.`, weight: n1 });
    }
    const stories = postTaps.filter((t) => tileOf(t).isStory).length;
    if (stories) lines.push({ text: `Stories brought ${people(stories)}.`, weight: stories });
  }
  const patterns = lines.sort((a, b) => b.weight - a.weight).slice(0, 4).map((l) => l.text);

  const counter = taps.filter((t) => t.source === "counter");
  const ratio = ratioLine(counter.length, counter.filter((t) => t.answer === "post").length);

  // Receipt lines, when the counter has been used. "I didn't see a post" from the card counts as walked past.
  const receipts = counter.length
    ? [
        { label: "Walked past", n: taps.filter((t) => t.answer === "walked_past").length },
        { label: "A friend told them", n: taps.filter((t) => t.answer === "friend").length },
        { label: "Found us on Google", n: taps.filter((t) => t.answer === "google").length },
      ]
    : [];

  const ranked = tiles
    .map((t) => ({ tileId: t.id, people: counts.get(t.id) ?? 0, sent: t.firstSentAt }))
    .sort((a, b) => b.people - a.people || b.sent.localeCompare(a.sent))
    .map(({ tileId, people }) => ({ tileId, people }));
  return { headline, patterns, ratio, receipts, people: n, posts, ranked, topTileId: ranked[0]?.people ? ranked[0].tileId : null };
}

/** The Monday push's body (plan 3.7). */
export function mondayBody(s: WeekSummary): string | null {
  if (!s.people) return null;
  return `Your week: ${s.headline.replace(/\.$/, "")}.`.replace("Your week: ", "Your week: ");
}
