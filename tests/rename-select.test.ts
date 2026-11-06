// look.md, Setup LOCATIONS: "Rename" turns the row into a 40px input, focused and selected, 24 characters.
import { describe, it, expect } from "vitest";
import setupSrc from "../src/app/pages/Setup.tsx?raw";

describe("Setup's Rename opens its input focused and selected", () => {
  it("the input selects the name when it opens, once, and still stops at 24", () => {
    expect(setupSrc).toMatch(/maxLength=\{24\} ref=\{selectOnOpen\}/);
    expect(setupSrc).toMatch(/function selectOnOpen\(el: HTMLInputElement \| null\) \{[\s\S]*?el\.focus\(\);\s*el\.select\(\);/);
  });
});

describe("A double-click on Rename is harmless (Playner, PR 23)", () => {
  it("for 400ms after Rename opens, Save and Cancel ignore clicks and a press in the row can't move focus", () => {
    expect(setupSrc).toContain("export const RENAME_SETTLE_MS = 400;");
    expect(setupSrc).toContain("renameOpenedAt.current = performance.now(); setRenaming(l.id);");
    expect(setupSrc).toContain('onClick={() => { if (!settling()) void save(l.id); }}');
    expect(setupSrc).toContain('onClick={() => { if (!settling()) setRenaming(null); }}');
    expect(setupSrc).toMatch(/class="loc-row" key=\{l\.id\} onMouseDown=\{renaming === l\.id \? \(e\) => \{ if \(settling\(\)\) e\.preventDefault\(\); \}/);
  });
});
