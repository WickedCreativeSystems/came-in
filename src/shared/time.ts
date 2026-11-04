// Shop time. Every "today", "this week" and weekday in Came In is in the
// shop's own time zone (plan 1.3), computed with Intl so the Worker and the
// browser agree.

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0 = Sunday ... 6 = Saturday
  hour: number;
  minute: number;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        weekday: "short",
        hour: "numeric",
        minute: "numeric",
      });
    } catch {
      f = fmt("Europe/London");
    }
    fmtCache.set(tz, f);
  }
  return f;
}

const WD_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = fmt(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WD_INDEX[get("weekday")] ?? 0,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

/** "YYYY-MM-DD" of the shop's calendar day. */
export function shopDayKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The UTC offset of `tz` at `date`, in minutes (positive east of UTC). */
export function offsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, date.getUTCSeconds());
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/** The instant the shop's day began. */
export function startOfShopDay(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  const guess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  // Two passes handle a DST change inside the day.
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** Weeks start Monday (plan 1.3). */
export function startOfShopWeek(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  const sinceMonday = (p.weekday + 6) % 7;
  const dayStart = startOfShopDay(date, tz);
  return startOfShopDay(new Date(dayStart.getTime() - sinceMonday * 86400000 + 3600000), tz);
}

/** Whole shop-days from `a` to `b` (positive when b is later). */
export function shopDaysBetween(a: Date, b: Date, tz: string): number {
  const da = startOfShopDay(a, tz).getTime();
  const db = startOfShopDay(b, tz).getTime();
  return Math.round((db - da) / 86400000);
}

export function weekdayName(date: Date, tz: string): string {
  return WEEKDAYS[zonedParts(date, tz).weekday];
}

export function weekdayAbbrev(date: Date, tz: string): string {
  return WEEKDAYS[zonedParts(date, tz).weekday].slice(0, 3).toUpperCase();
}

/** "Oct 28" */
export function shortDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${MONTHS[p.month - 1]} ${p.day}`;
}

/** "6:10 pm" */
export function clockTime(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "am" : "pm"}`;
}

export type TimeBucket = "morning" | "midday" | "afternoon" | "evening" | "night";

/** Shop-time buckets from plan 1.7. */
export function timeBucket(date: Date, tz: string): TimeBucket {
  const h = zonedParts(date, tz).hour;
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 14) return "midday";
  if (h >= 14 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

/** 06:00 to 22:00 shop time is the opening window polls run in (plan 1.2). */
export function inOpeningWindow(date: Date, tz: string): boolean {
  const h = zonedParts(date, tz).hour;
  return h >= 6 && h < 22;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The first instant of the shop's calendar month. */
export function startOfShopMonth(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  const guess = new Date(Date.UTC(p.year, p.month - 1, 1, 12));
  return startOfShopDay(guess, tz);
}

/** "YYYY-Www": the shop's week, Monday first, for "sent once a week" marks. */
export function shopWeekKey(date: Date, tz: string): string {
  return shopDayKey(startOfShopWeek(date, tz), tz);
}
