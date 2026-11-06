// Round five changes (plan 3.4, 3.7, 3.9, 3.10): the phone header's "today", the Post it again line,
// the sample's ring words and Now try a tap, and the ring held for the sheet.
import { describe, it, expect } from "vitest";
import setupSrc from "../src/app/pages/Setup.tsx?raw";
import wallSrc from "../src/app/pages/Wall.tsx?raw";
import weekSrc from "../src/app/pages/Week.tsx?raw";
import postSrc from "../src/app/pages/Post.tsx?raw";
import sheetsSrc from "../src/app/ui/Sheets.tsx?raw";
import { resultLine } from "../src/app/lib/lines";

const ok = (outcome: "queued" | "draft" | "approval", ...names: string[]) => ({ outcome, ok: names, failed: [] as string[] });

describe("3.9 the Post it again line names the post", () => {
  it("queued: the post's name, in your Buffer queue, next slot", () => {
    expect(resultLine(ok("queued", "Instagram"), "Tuesday's sourdough post")).toBe("Tuesday's sourdough post is in your Buffer queue. It goes out at your next slot.");
  });
  it("starts the sentence with a capital and keeps the owner's own words", () => {
    expect(resultLine(ok("queued", "Instagram"), "the sourdough post")).toBe("The sourdough post is in your Buffer queue. It goes out at your next slot.");
    expect(resultLine(ok("queued", "Instagram"), "the Oct 28 sourdough post")).toBe("The Oct 28 sourdough post is in your Buffer queue. It goes out at your next slot.");
  });
  it("staging draft and waiting for approval keep the plan's words", () => {
    expect(resultLine(ok("draft", "Instagram"), "Tuesday's sourdough post")).toBe("Saved as a draft in your Buffer.");
    expect(resultLine(ok("approval", "Instagram"), "Tuesday's sourdough post")).toBe("Sent to Buffer, waiting for approval.");
  });
  it("some channels failing and none succeeding read as before", () => {
    expect(resultLine({ outcome: "queued", ok: ["Instagram", "TikTok"], failed: ["YouTube"] }, "Tuesday's sourdough post")).toBe("Added on Instagram and TikTok. YouTube didn't take it.");
    expect(resultLine({ outcome: "failed", ok: [], failed: ["Instagram"] }, "Tuesday's sourdough post")).toBe("Buffer didn't take that. Try again in a minute.");
  });
  it("Post this (no name) keeps its own line", () => {
    expect(resultLine(ok("queued", "Instagram"))).toBe("Added to your Buffer queue.");
  });
});

describe("round 6 words", () => {
  it("the card's second line is two nowrap lines at 12 units", async () => {
    const card = (await import("../src/worker/render/card.ts?raw")).default as string;
    expect(card).toContain("Scan, then tap the post that brought you in.<br>Three seconds, no app.");
    expect(card).toMatch(/\.card \.sub\{font-size:calc\(12 \* var\(--u\)\);[^}]*white-space:nowrap\}/);
  });
});

describe("source: the screens use them", () => {
  it("3.10 Ring my phone result words and Now try a tap", () => {
    const setup = setupSrc;
    expect(setup).toContain("<b>This browser will ring.</b> In your own shop, open Came In on your phone and tap Ring my phone there, and your phone rings.");
    expect(setup).toContain("Now try a tap");
    expect(setup).toContain('href="/sample?try=1"');
  });
  it("3.10 the Ring my phone result is scrolled clear of the bottom bar after a press", () => {
    expect(setupSrc).toContain("scrollIntoRoom(result.current)");
    expect(setupSrc).toContain("pressed.current = true");
    expect(setupSrc).toMatch(/<div ref=\{result\}>[\s\S]*Now try a tap/);
  });
  it("3.10 a tap in the sheet holds the ring until the sheet closes", () => {
    const wall = wallSrc;
    expect(wall).toContain("held.current.push(m)");
    expect(wall).toMatch(/if \(sheet \|\| !held\.current\.length\) return;/);
  });
  it("3.9 the line is one strip that stays: no timer, no dismiss", () => {
    const week = weekSrc;
    const post = postSrc;
    expect(week).toContain("QueueLine");
    expect(sheetsSrc).toContain("<b>{lead}</b>");
    expect(post).toContain("QueueLine");
    expect(sheetsSrc).not.toMatch(/QueueLine[\s\S]{0,600}setTimeout/);
  });
});
