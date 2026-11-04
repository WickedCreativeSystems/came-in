// The sample bakery, Rye & Lantern (plan 3.10, look.md section 10): twelve
// posts with baseline counts. Sent times are placed on the weekdays the
// sample names, relative to now, so the badges and names stay true.
import { startOfShopDay, zonedParts } from "./time";

export const SAMPLE_SHOP = {
  id: "sample",
  name: "Rye & Lantern",
  handle: "ryeandlantern",
  timezone: "America/Chicago",
  reviewUrl: "https://g.page/r/sample-rye-and-lantern/review",
  thankYouText: "Free cookie today",
  initials: "RL",
};

export interface SamplePost {
  id: string;
  text: string;
  subject: string | null;
  services: string[];
  count: number; // baseline people
  noted: boolean;
  story?: boolean;
  textOnly?: boolean;
  /** 0 = today, 1 = yesterday ...; or a weekday to place it on (its most recent occurrence, + weeksBack) */
  when: { daysAgo: number } | { weekday: number; weeksBack?: number };
  hour: number;
  minute: number;
}

const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

export const SAMPLE_POSTS: SamplePost[] = [
  { id: "story", text: "Today only: chocolate fudge slices, still warm at 3.", subject: "fudge", services: ["instagram"], count: 1, noted: false, story: true, when: { daysAgo: 0 }, hour: 9, minute: 12 },
  { id: "sour", text: "Sourdough is out of the oven. Crust like a map.", subject: "sourdough", services: ["instagram", "facebook"], count: 6, noted: true, when: { weekday: TUE }, hour: 18, minute: 10 },
  { id: "crois", text: "Saturday croissants. We made forty. They won't last.", subject: "croissant", services: ["instagram", "facebook"], count: 4, noted: true, when: { weekday: SAT }, hour: 7, minute: 40 },
  { id: "hours", text: "Winter hours start Monday: 7 to 3, closed Sundays.", subject: "winter hours", services: ["facebook", "googlebusiness"], count: 0, noted: false, textOnly: true, when: { weekday: MON }, hour: 8, minute: 5 },
  { id: "cinn", text: "Cinnamon knots are back for the season.", subject: "cinnamon knot", services: ["instagram"], count: 3, noted: true, when: { weekday: FRI }, hour: 10, minute: 30 },
  { id: "latte", text: "New beans from the roaster on Hill Street. Come taste.", subject: "new coffee", services: ["instagram", "googlebusiness"], count: 2, noted: false, when: { weekday: THU }, hour: 15, minute: 2 },
  { id: "hands", text: "5am. Shaping day. Sound on.", subject: "dough", services: ["instagram", "facebook"], count: 2, noted: false, when: { weekday: WED }, hour: 5, minute: 48 },
  { id: "pretz", text: "Pretzel Saturday is a thing now.", subject: "pretzel", services: ["instagram"], count: 1, noted: false, when: { weekday: SAT, weeksBack: 1 }, hour: 11, minute: 15 },
  { id: "apple", text: "Apple cake, the one with the custard.", subject: "apple cake", services: ["facebook"], count: 0, noted: false, when: { weekday: SUN, weeksBack: 1 }, hour: 14, minute: 20 },
  { id: "bun", text: "Morning buns until they're gone.", subject: "morning bun", services: ["instagram", "facebook"], count: 1, noted: false, when: { weekday: TUE, weeksBack: 1 }, hour: 7, minute: 55 },
  { id: "cook", text: "Oatmeal raisin. Yes, raisin. We stand by it.", subject: "oatmeal cookie", services: ["instagram"], count: 0, noted: false, when: { weekday: THU, weeksBack: 1 }, hour: 16, minute: 5 },
  { id: "bag", text: "Baguettes at noon, every day but Sunday.", subject: "baguette", services: ["instagram", "googlebusiness"], count: 2, noted: false, when: { weekday: FRI, weeksBack: 2 }, hour: 12, minute: 0 },
];

/** The instant a sample post was "sent", given now and the shop's zone. */
export function samplePostSentAt(post: SamplePost, now: Date, tz = SAMPLE_SHOP.timezone): Date {
  const todayStart = startOfShopDay(now, tz);
  let daysAgo: number;
  if ("daysAgo" in post.when) {
    daysAgo = post.when.daysAgo;
  } else {
    const todayWd = zonedParts(now, tz).weekday;
    // The most recent occurrence of that weekday, today included, so the names
    // stay "Tuesday's sourdough post" and never slip past 6 days.
    const back = (todayWd - post.when.weekday + 7) % 7;
    daysAgo = back + 7 * (post.when.weeksBack ?? 0);
  }
  const dayStart = startOfShopDay(new Date(todayStart.getTime() - daysAgo * 86400000 + 3600000), tz);
  let t = dayStart.getTime() + post.hour * 3600000 + post.minute * 60000;
  // A story "sent" later today than now would be in the future: pull it back to now.
  if (t > now.getTime()) t = now.getTime() - 15 * 60000;
  return new Date(t);
}

export function sampleImageUrl(post: SamplePost): string | null {
  return post.textOnly ? null : `/sample/${post.id}.jpg`;
}
