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
  it("each word form's whole name is one hidden span next to its visible words, so no space comes before the colon", () => {
    expect(weekSrc).toMatch(/<span class="long" aria-hidden="true">Post it again<\/span>\s*<span class="short" aria-hidden="true">Post again<\/span>\s*<span class="sr long">Post it again: \{t\.name\}<\/span>\s*<span class="sr short">Post again: \{t\.name\}<\/span>/);
    expect(weekSrc).toMatch(/<span class="long" aria-hidden="true">More like this<\/span>\s*<span class="short" aria-hidden="true">More like it<\/span>\s*<span class="sr long">More like this: \{t\.name\}<\/span>\s*<span class="sr short">More like it: \{t\.name\}<\/span>/);
    expect(weekSrc).not.toContain('<span class="sr">: {t.name}</span>');
  });
  it("the form that doesn't show is display: none, so it is left out of the name", () => {
    expect(__APP_CSS__).toContain(".tile-action .short { display: none; }");
    expect(__APP_CSS__).toMatch(/@media \(max-width: 720px\) \{\s*\.tile-action \.long \{ display: none; \}/);
  });
});
