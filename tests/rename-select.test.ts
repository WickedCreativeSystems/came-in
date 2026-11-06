// look.md, Setup LOCATIONS: "Rename" turns the row into a 40px input, focused and selected, 24 characters.
import { describe, it, expect } from "vitest";
import setupSrc from "../src/app/pages/Setup.tsx?raw";

describe("Setup's Rename opens its input focused and selected", () => {
  it("the input selects the name when it opens, once, and still stops at 24", () => {
    expect(setupSrc).toMatch(/maxLength=\{24\} ref=\{selectOnOpen\}/);
    expect(setupSrc).toMatch(/function selectOnOpen\(el: HTMLInputElement \| null\) \{[\s\S]*?el\.focus\(\);\s*el\.select\(\);/);
  });
});
