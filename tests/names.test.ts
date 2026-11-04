// Plan 1.7: honest numbers and post names. look.md section 8: the voice.
import { describe, it, expect } from "vitest";
import { postName, firstWords, peopleWord, dayBadge, sentCaption, bellSentence, whereLine, isLiveStory, textOnlyCaption } from "../src/shared/names";
import { startOfShopDay, startOfShopWeek, shopDayKey, timeBucket, inOpeningWindow } from "../src/shared/time";
import { markId, monogram, serviceName } from "../src/shared/marks";

const TZ = "America/Chicago";
// Thursday, Nov 5 2026, 10:00 in Chicago (16:00 UTC).
const NOW = new Date("2026-11-05T16:00:00Z");
const TUESDAY = "2026-11-03T23:10:00Z"; // Tue Nov 3, 5:10 pm Chicago
const OLD = "2026-10-28T23:10:00Z"; // Wed Oct 28

describe("people, never a bare number", () => {
  it("says 1 person and N people", () => {
    expect(peopleWord(1)).toBe("1 person");
    expect(peopleWord(0)).toBe("0 people");
    expect(peopleWord(7)).toBe("7 people");
  });
});

describe("a post's name in sentences (plan 1.7)", () => {
  it("uses the nickname first", () => {
    expect(postName({ firstSentAt: TUESDAY, nickname: "the sourdough post", subject: "bread", text: "x" }, NOW, TZ)).toBe("the sourdough post");
  });
  it("uses the subject: Tuesday's sourdough post", () => {
    expect(postName({ firstSentAt: TUESDAY, subject: "sourdough", text: "Sourdough is out" }, NOW, TZ)).toBe("Tuesday's sourdough post");
  });
  it("older than 6 days: the Oct 28 sourdough post", () => {
    expect(postName({ firstSentAt: OLD, subject: "sourdough" }, NOW, TZ)).toBe("the Oct 28 sourdough post");
  });
  it("without a subject: Tuesday's post, \"First five words\"", () => {
    expect(postName({ firstSentAt: TUESDAY, text: "Sourdough is out of the oven. Crust like a map." }, NOW, TZ)).toBe("Tuesday's post, “Sourdough is out of the”");
  });
  it("no text: Tuesday's photo", () => {
    expect(postName({ firstSentAt: TUESDAY, text: "" }, NOW, TZ)).toBe("Tuesday's photo");
  });
  it("first words: at most 32 characters, trailing punctuation removed, URLs dropped", () => {
    expect(firstWords("Winter hours! Monday.")).toBe("Winter hours! Monday");
    expect(firstWords("Supercalifragilisticexpialidocious and more words")).toBe("Supercalifragilisticexpialidocio");
    expect(firstWords("See https://x.com/a our new menu")).toBe("See our new menu");
    expect(firstWords("Hello, world...")).toBe("Hello, world");
  });
  it("the bell sentence and its sub-lines", () => {
    expect(bellSentence("Tuesday's sourdough post")).toBe("Someone just came in because of Tuesday's sourdough post.");
    expect(whereLine("card")).toBe("From the card · just now");
    expect(whereLine("counter")).toBe("At the till · just now");
    expect(whereLine("online")).toBe("Online · just now");
  });
});

describe("day badges and captions (plan 3.4, 3.9)", () => {
  it("TUE within 6 days, OCT 28 when older, TODAY · LIVE on a live story", () => {
    expect(dayBadge(new Date(TUESDAY), NOW, TZ, false)).toBe("TUE");
    expect(dayBadge(new Date(OLD), NOW, TZ, false)).toBe("OCT 28");
    expect(dayBadge(new Date(TUESDAY), NOW, TZ, true, "wall")).toBe("TODAY · LIVE");
    expect(dayBadge(new Date(TUESDAY), NOW, TZ, true, "tap")).toBe("TODAY");
  });
  it("Sent Tuesday, 5:10 pm and Sent Oct 28, 6:10 pm", () => {
    expect(sentCaption(new Date(TUESDAY), NOW, TZ)).toBe("Sent Tuesday, 5:10 pm");
    expect(sentCaption(new Date(OLD), NOW, TZ)).toBe("Sent Oct 28, 6:10 pm");
  });
  it("Text only · Tue", () => {
    expect(textOnlyCaption(new Date(TUESDAY), NOW, TZ)).toBe("Text only · Tue");
  });
  it("a story is live for 24 hours", () => {
    expect(isLiveStory(true, new Date(NOW.getTime() - 3600000), NOW)).toBe(true);
    expect(isLiveStory(true, new Date(NOW.getTime() - 25 * 3600000), NOW)).toBe(false);
    expect(isLiveStory(false, new Date(NOW.getTime() - 3600000), NOW)).toBe(false);
  });
});

describe("shop time (plan 1.3)", () => {
  it("today starts at the shop's midnight", () => {
    expect(startOfShopDay(NOW, TZ).toISOString()).toBe("2026-11-05T06:00:00.000Z");
    expect(shopDayKey(new Date("2026-11-05T04:00:00Z"), TZ)).toBe("2026-11-04");
  });
  it("weeks start Monday", () => {
    expect(startOfShopWeek(NOW, TZ).toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });
  it("handles the DST change: Sunday Nov 1 2026 in Chicago", () => {
    expect(startOfShopDay(new Date("2026-11-01T18:00:00Z"), TZ).toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(startOfShopDay(new Date("2026-11-02T18:00:00Z"), TZ).toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });
  it("time buckets and the opening window", () => {
    expect(timeBucket(new Date("2026-11-05T13:00:00Z"), TZ)).toBe("morning"); // 7 am
    expect(timeBucket(new Date("2026-11-06T00:00:00Z"), TZ)).toBe("evening"); // 6 pm
    expect(inOpeningWindow(new Date("2026-11-05T11:00:00Z"), TZ)).toBe(false); // 5 am
    expect(inOpeningWindow(new Date("2026-11-05T13:00:00Z"), TZ)).toBe(true);
  });
});

describe("channel marks (look.md section 5)", () => {
  it("maps every Buffer service with a Simple Icons mark, and a monogram otherwise", () => {
    for (const s of ["instagram", "facebook", "googlebusiness", "twitter", "linkedin", "tiktok", "youtube", "pinterest", "threads", "bluesky", "mastodon", "substack"]) expect(markId(s)).toMatch(/^mark-/);
    expect(markId("startPage")).toBeNull();
    expect(monogram("startPage")).toBe("ST");
    expect(serviceName("twitter")).toBe("X");
  });
});
