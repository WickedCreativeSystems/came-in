// Plan 3.7 (Walker's yes, Nov 6 11:12): each This week button's accessible name starts with its visible words,
// then the post's name, so voice control's "tap Post again" matches (label in name, WCAG 2.5.3).
import { describe, it, expect } from "vitest";
import weekSrc from "../src/app/pages/Week.tsx?raw";

declare const __APP_CSS__: string;

describe("This week's tile buttons: the name starts with the words that show", () => {
  it("no fixed aria-label overrides the words", () => {
    expect(weekSrc).not.toContain('aria-label="Post it again"');
    expect(weekSrc).not.toContain('aria-label="More like this"');
  });
  it("both word forms are in the name's source, and the post's name follows them", () => {
    expect(weekSrc).toMatch(/<span class="long">Post it again<\/span>\s*<span class="short">Post again<\/span>\s*<span class="sr">: \{t\.name\}<\/span>/);
    expect(weekSrc).toMatch(/<span class="long">More like this<\/span>\s*<span class="short">More like it<\/span>\s*<span class="sr">: \{t\.name\}<\/span>/);
    expect(weekSrc).not.toMatch(/<span class="short" aria-hidden="true">(Post again|More like it)<\/span>/);
  });
  it("the form that doesn't show is display: none, so it is left out of the name", () => {
    expect(__APP_CSS__).toContain(".tile-action .short { display: none; }");
    expect(__APP_CSS__).toMatch(/@media \(max-width: 720px\) \{\s*\.tile-action \.long \{ display: none; \}/);
  });
});
