// The sample bakery's posts keep the names the sample promises, on every day of the week.
import { describe, it, expect } from "vitest";
import { sampleTiles } from "../src/worker/sample";

describe("sample bakery names (plan 3.10)", () => {
  // One instant per weekday, at 10 pm and 7 am in Chicago.
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 10, 2 + i, 4, 0))) // 10 pm the evening before
    .concat(Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 10, 2 + i, 13, 0)))); // 7 am
  it.each(days.map((d) => [d.toISOString(), d]))("on %s the week's posts are named by weekday, never by date", (_label, now) => {
    const tiles = sampleTiles(now as Date, new Map());
    const sour = tiles.find((t) => t.id === "sour")!;
    expect(sour.name).toBe("Tuesday's sourdough post");
    expect(tiles.find((t) => t.id === "crois")!.name).toBe("Saturday's croissant post");
    for (const t of tiles) expect(new Date(t.firstSentAt).getTime()).toBeLessThanOrEqual((now as Date).getTime());
    expect(tiles[0].id).toBe("story");
    expect(tiles[0].isLive).toBe(true);
  });
});
