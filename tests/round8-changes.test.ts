// Round eight (plan 1.7, 3.4): the day line names the weekday in the plural, and a tile older than 6 days shows
// its weekday first, so the day line can be added up from the tiles.
import { describe, it, expect } from "vitest";
import { call } from "./helpers";
import { dayBadge, dayBadgeShort } from "../src/shared/names";
import { SAMPLE_SHOP } from "../src/shared/sample";

const TZ = "America/Chicago";
const NOW = new Date("2026-11-06T16:00:00Z"); // Fri Nov 6

describe("3.4 the older tile's badge", () => {
  it("FRI · OCT 23 on a wide tile, FRI 23 on a tile under 180px", () => {
    const oct23 = new Date("2026-10-23T17:00:00Z");
    expect(dayBadge(oct23, NOW, TZ, false)).toBe("FRI · OCT 23");
    expect(dayBadge(oct23, NOW, TZ, false, "tap")).toBe("FRI · OCT 23");
    expect(dayBadgeShort(oct23, NOW, TZ, false)).toBe("FRI 23");
    expect(dayBadgeShort(new Date("2026-09-30T17:00:00Z"), NOW, TZ, false)).toBe("WED 30");
  });
  it("posts within 6 days and today keep their badges", () => {
    expect(dayBadge(new Date("2026-11-03T18:00:00Z"), NOW, TZ, false)).toBe("TUE");
    expect(dayBadgeShort(new Date("2026-11-03T18:00:00Z"), NOW, TZ, false)).toBe("TUE");
    expect(dayBadge(new Date("2026-10-31T18:00:00Z"), NOW, TZ, false)).toBe("SAT");
    expect(dayBadge(new Date("2026-11-06T14:00:00Z"), NOW, TZ, false)).toBe("SENT TODAY");
    expect(dayBadgeShort(new Date("2026-11-06T14:00:00Z"), NOW, TZ, false)).toBe("NEW");
  });
});

describe("1.7 the day line adds up from the sample's tiles", () => {
  it("Posts sent on <weekday>s brought the most people: N, and the tiles of that weekday add up to N", async () => {
    const w = (await (await call("/api/sample/week?range=week")).json()) as { summary: { patterns: string[] }; tiles: { firstSentAt: string; weekPeople: number }[] };
    const line = w.summary.patterns.find((p) => p.startsWith("Posts sent on "));
    const m = line?.match(/^Posts sent on (\w+)days brought the most people: (\d+)\.$/);
    expect(m, line).toBeTruthy();
    const day = m![1].slice(0, 3).toUpperCase();
    const now = new Date();
    const sum = w.tiles.filter((t) => {
      const b = dayBadge(new Date(t.firstSentAt), now, SAMPLE_SHOP.timezone, false);
      return b.startsWith(day) || (b === "SENT TODAY" && now.toLocaleDateString("en-US", { weekday: "short", timeZone: SAMPLE_SHOP.timezone }).toUpperCase() === day);
    }).reduce((n, t) => n + t.weekPeople, 0);
    expect(sum).toBe(Number(m![2]));
  });
});
