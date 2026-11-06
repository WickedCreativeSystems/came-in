// Plan section 0 (awaiting Walker's yes with the Nov 6 changes) and look.md "A long location name never widens a screen":
// a long one-word name ends in an ellipsis inside its chip, row or caption, and breaks onto the next line everywhere else.
import { describe, it, expect } from "vitest";
import weekSrc from "../src/app/pages/Week.tsx?raw";
import { BASE_CSS } from "../src/worker/render/html";
import tapSrc from "../src/worker/render/tap.ts?raw";
import counterSrc from "../src/worker/render/counter.ts?raw";

declare const __APP_CSS__: string;
declare const __TOKENS_CSS__: string;

describe("This week: the line under a tile", () => {
  it("each item is a name and its count as one unit; the name truncates, the count stays whole", () => {
    expect(weekSrc).toContain('<span class="by-loc-item" key={x.label}><span class="nm">{x.label}</span><span class="n">{"\\u00a0"}{x.n}</span></span>');
    expect(weekSrc).toContain('{k > 0 && " · "}');
    expect(__APP_CSS__).toContain(".by-loc-item { display: inline-flex; max-width: 100%; vertical-align: top; }");
    expect(__APP_CSS__).toContain(".by-loc-item .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
    expect(__APP_CSS__).toContain(".by-loc-item .n { flex: none;");
  });
  it("at most two lines", () => {
    expect(__APP_CSS__).toMatch(/\.by-loc \{[^}]*-webkit-line-clamp: 2; overflow: hidden; \}/);
  });
  it("no caption can widen a column: the phone grid is minmax(0, 1fr) and a tile may shrink", () => {
    expect(__APP_CSS__).toContain(".wall { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }");
    expect(__APP_CSS__).toContain(".week-tile { min-width: 0; }");
    // the wider grid's columns have a fixed 210px minimum, which content can't raise
    expect(__APP_CSS__).toContain("repeat(auto-fill, minmax(210px, 1fr))");
  });
});

describe("A post: Where they came in", () => {
  it("the name truncates on one line and the count never shrinks", () => {
    expect(__APP_CSS__).toContain(".receipt li > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
    expect(__APP_CSS__).toContain(".receipt .num { flex: none; }");
    // and the page's one column can't be widened by it
    expect(__APP_CSS__).toContain(".post-grid { grid-template-columns: minmax(0, 1fr); gap: var(--s5); }");
  });
});

describe("every other line with a name", () => {
  it("a long word breaks inside the line, in the app and on the pages the Worker draws (tap page, staff screen)", () => {
    expect(__TOKENS_CSS__).toMatch(/body \{[^}]*overflow-wrap: break-word; \}/);
    expect(BASE_CSS).toMatch(/body\{[^}]*overflow-wrap:break-word\}/);
  });
  it("the tap page's and staff screen's header lines break a long name instead of widening the header", () => {
    for (const src of [tapSrc, counterSrc]) {
      expect(src).toContain(".hd>div{min-width:0}");
      expect(src).toContain(".hn{font-size:13px;color:var(--ink-2);line-height:1.3;margin-top:3px;overflow-wrap:anywhere}");
    }
    expect(counterSrc).toContain(".mk{margin-left:auto;min-width:0;overflow-wrap:anywhere;text-align:right}");
  });
});
