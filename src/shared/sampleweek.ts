// The sample bakery's taps (plan 3.10). Each post's baseline count is spread
// between the moment it went out and now, so its sticker, its page and This
// week always agree, whatever day it is. A quarter of the post taps came at
// the counter, and the counter heard 6 "walked past", 4 "a friend" and 2
// "Google" this week, so the honest ratio line shows.
import { SAMPLE_POSTS, SAMPLE_SHOP, samplePostSentAt } from "./sample";
import { startOfShopWeek, startOfShopDay } from "./time";
import type { WeekTap } from "./week";

export function sampleHistory(now: Date): WeekTap[] {
  const tz = SAMPLE_SHOP.timezone;
  const weekStart = startOfShopWeek(now, tz).getTime();
  const taps: WeekTap[] = [];
  let k = 0;
  const spread = (min: number, max: number, i: number, n: number) => {
    // Evenly through the span, nudged so no two posts' taps fall together.
    k++;
    const f = (i + 0.35 + ((k * 0.6180339887) % 1) * 0.3) / n;
    return new Date(min + (max - min) * Math.min(0.98, f)).toISOString();
  };
  for (const p of SAMPLE_POSTS) {
    const sent = samplePostSentAt(p, now, tz).getTime();
    // A post sent before today earned its taps before today, so today's count is only today's posts.
    const dayStart = startOfShopDay(now, tz).getTime();
    const end = sent < dayStart ? Math.max(sent + 60000, dayStart - 60000) : Math.max(sent + 60000, now.getTime() - 60000);
    for (let i = 0; i < p.count; i++) taps.push({ tileId: p.id, answer: "post", source: i % 4 === 1 ? "counter" : "card", at: spread(sent, end, i, p.count) });
  }
  const span = Math.max(60000, now.getTime() - weekStart);
  for (const [answer, n] of [["walked_past", 6], ["friend", 4], ["google", 2]] as const) {
    for (let i = 0; i < n; i++) taps.push({ tileId: null, answer, source: "counter", at: spread(weekStart, weekStart + span, i, n) });
  }
  return taps;
}
