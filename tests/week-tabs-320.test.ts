// look.md, "The Today tab": on a small phone (up to 359px; the 15px row needs 348 and a Fold cover is 344) the tabs are 14px with 8px gaps, never wrapping
// or scrolling. The small-phone rule must come after the base rule, or the base 15px wins at the same weight.
import { describe, it, expect } from "vitest";

declare const __APP_CSS__: string;

describe("This week's range tabs on a 320px phone", () => {
  it("the 359px rule (14px, 8px gaps) comes after the base .range-tab rule", () => {
    const base = __APP_CSS__.indexOf(".range-tab { padding: 8px 0;");
    const small = __APP_CSS__.indexOf("@media (max-width: 359px) { .range-tabs { gap: 8px; } .range-tab { font-size: 14px; } }");
    expect(base).toBeGreaterThan(-1);
    expect(small).toBeGreaterThan(base);
  });
});
