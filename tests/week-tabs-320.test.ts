// look.md, "The Today tab": the tabs are 14px with 8px gaps when their row has less than 320px (the 15px row needs 316),
// switched by a container query on the row's wrapper, so no screen width, font or zoom can make them stick out (plan section 0).
// The small rule must come after the base rule, or the base 15px wins at the same weight.
import { describe, it, expect } from "vitest";
import weekSrc from "../src/app/pages/Week.tsx?raw";

declare const __APP_CSS__: string;

describe("This week's range tabs on a small phone", () => {
  it("the tabs sit in a wrapper that is an inline-size container", () => {
    expect(__APP_CSS__).toContain(".range-wrap { container: range-tabs / inline-size; margin: 0 0 var(--s4); }");
    expect(weekSrc).toMatch(/<div class="range-wrap">\s*<nav class="range-tabs" aria-label="Range">/);
  });
  it("the under-320px container rule (14px, 8px gaps) comes after the base .range-tab rule", () => {
    const base = __APP_CSS__.indexOf(".range-tab { padding: 8px 0;");
    const small = __APP_CSS__.indexOf("@container range-tabs (max-width: 319.98px) { .range-tabs { gap: 8px; } .range-tab { font-size: 14px; } }");
    expect(base).toBeGreaterThan(-1);
    expect(small).toBeGreaterThan(base);
    expect(__APP_CSS__).not.toMatch(/@media \(max-width: 3[45]\dpx\) \{ \.range-tabs/);
  });
});
