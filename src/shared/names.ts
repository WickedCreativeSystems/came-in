// Honest numbers and the names of posts, from plan 1.7 and look.md section 8.
import { shopDaysBetween, weekdayName, weekdayAbbrev, shortDate, clockTime } from "./time";

export interface NameableTile {
  firstSentAt: string; // ISO
  nickname?: string | null;
  subject?: string | null;
  text?: string | null;
  hasImage?: boolean;
}

/** "1 person", "7 people". Never a bare number. */
export function peopleWord(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

/** The first five words of a post, at most 32 characters, trailing punctuation removed. */
export function firstWords(text: string): string {
  const words = text.replace(/https?:\/\/\S+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  let s = words.join(" ");
  if (s.length > 32) s = s.slice(0, 32).replace(/\s+\S*$/, "");
  s = s.replace(/[\s.,;:!?…\-–—"'“”‘’]+$/u, "");
  return s;
}

/** "Tuesday's" within 6 shop-days, else "the Oct 28". */
export function dayPhrase(sentAt: Date, now: Date, tz: string): { possessive: string; recent: boolean } {
  const recent = Math.abs(shopDaysBetween(sentAt, now, tz)) <= 6;
  return recent ? { possessive: `${weekdayName(sentAt, tz)}'s`, recent } : { possessive: `the ${shortDate(sentAt, tz)}`, recent };
}

/**
 * The post's name in a sentence (plan 1.7, 3.9):
 *   nickname set           → the nickname, as the owner wrote it ("the sourdough post")
 *   subject (vision call)  → "Tuesday's sourdough post" / "the Oct 28 sourdough post"
 *   text                   → Tuesday's post, "First five words"
 *   nothing                → "Tuesday's photo"
 */
export function postName(tile: NameableTile, now: Date, tz: string): string {
  const nickname = tile.nickname?.trim();
  if (nickname) return nickname;
  const sent = new Date(tile.firstSentAt);
  const { possessive } = dayPhrase(sent, now, tz);
  const subject = tile.subject?.trim();
  if (subject) return `${possessive} ${subject} post`;
  const words = tile.text ? firstWords(tile.text) : "";
  if (words) return `${possessive} post, “${words}”`;
  return `${possessive} photo`;
}

/** A tile's name where it is shown on its own: no leading "the", first letter up ("Oct 27 morning bun post"). The bell keeps the sentence form. */
export function tileLabel(name: string): string {
  const s = name.replace(/^the\s+/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Someone just came in because of X." and, at a shop with two or more locations, "... at Eastside because of X." */
export function bellSentence(name: string, location?: string | null): string {
  return location ? `Someone just came in at ${location} because of ${name}.` : `Someone just came in because of ${name}.`;
}

export type TapSource = "card" | "counter" | "online" | "sample";

export function whereLine(source: TapSource): string {
  switch (source) {
    case "counter":
      return "At the till · just now";
    case "online":
      return "Online · just now";
    default:
      return "From the card · just now";
  }
}

/** Day badge text on a tile. The wall says "TODAY · LIVE" on a live story; the tap page "TODAY". */
export function dayBadge(sentAt: Date, now: Date, tz: string, live: boolean, where: "wall" | "tap" = "wall"): string {
  if (live) return where === "wall" ? "TODAY · LIVE" : "TODAY";
  // Every post sent today says SENT TODAY, not the weekday (plain TODAY was read as visits today).
  if (shopDaysBetween(sentAt, now, tz) === 0) return "SENT TODAY";
  const recent = Math.abs(shopDaysBetween(sentAt, now, tz)) <= 6;
  // Older than 6 days: the weekday first, so This week's day line can be added up from the tiles (plan 3.4, round 8).
  return recent ? weekdayAbbrev(sentAt, tz) : `${weekdayAbbrev(sentAt, tz)} · ${shortDate(sentAt, tz).toUpperCase()}`;
}

/** The same badge on a tile narrower than 180px: NEW for a post sent today, LIVE (brass) for a live story, FRI 23 for an older post. */
export function dayBadgeShort(sentAt: Date, now: Date, tz: string, live: boolean): string {
  if (live) return "LIVE";
  if (shopDaysBetween(sentAt, now, tz) === 0) return "NEW";
  // Older than 6 days: "FRI 23", the weekday and the day of the month ("FRI · OCT 23" doesn't fit; look.md Day badge).
  if (Math.abs(shopDaysBetween(sentAt, now, tz)) > 6) return `${weekdayAbbrev(sentAt, tz)} ${shortDate(sentAt, tz).split(" ")[1]}`;
  return dayBadge(sentAt, now, tz, false);
}

/** A story is live for 24 hours after it was sent. */
export function isLiveStory(isStory: boolean, sentAt: Date, now: Date): boolean {
  return isStory && now.getTime() - sentAt.getTime() < 24 * 3600000 && now.getTime() >= sentAt.getTime() - 60000;
}

/** "Sent Tuesday, 6:10 pm" or "Sent Oct 28, 6:10 pm" (plan 3.9). */
export function sentCaption(sentAt: Date, now: Date, tz: string): string {
  const recent = Math.abs(shopDaysBetween(sentAt, now, tz)) <= 6;
  const day = recent ? weekdayName(sentAt, tz) : shortDate(sentAt, tz);
  return `Sent ${day}, ${clockTime(sentAt, tz)}`;
}

/** "Text only · Tue" under a text tile's first line. */
export function textOnlyCaption(sentAt: Date, now: Date, tz: string): string {
  const recent = Math.abs(shopDaysBetween(sentAt, now, tz)) <= 6;
  const day = recent ? weekdayName(sentAt, tz).slice(0, 3) : shortDate(sentAt, tz);
  return `Text only · ${day}`;
}

/** The first line of a text-only post, for the tile. */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 120 ? line.slice(0, 117).replace(/\s+\S*$/, "") + "…" : line;
}

/** The wall's order (P3): today's live story pinned first, then newest first. */
export function wallOrder<T extends { isLive: boolean; firstSentAt: string }>(tiles: T[]): T[] {
  return [...tiles].sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.firstSentAt.localeCompare(a.firstSentAt));
}
