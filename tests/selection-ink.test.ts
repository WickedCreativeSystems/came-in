// look.md, Color: "Selected text is ink, never the browser's blue" — ::selection is ink on paper across the whole app,
// inputs included, in both themes. The owner's app gets it from tokens.css; the server-drawn pages from BASE_CSS.
import { describe, it, expect } from "vitest";
import { call } from "./helpers";
import { BASE_CSS } from "../src/worker/render/html";

declare const __TOKENS_CSS__: string;

describe("Selected text is ink", () => {
  it("the app's tokens set ::selection to ink on paper, once, outside any theme block", () => {
    const rules = __TOKENS_CSS__.match(/::selection \{[^}]*\}/g) ?? [];
    expect(rules).toEqual(["::selection { background: var(--ink); color: var(--paper); }"]);
  });
  it("the server-drawn pages' base CSS sets it too", () => {
    expect(BASE_CSS).toContain("::selection{background:var(--ink);color:var(--paper)}");
  });
  it("the home page carries it", async () => {
    const html = await (await call("/")).text();
    expect(html).toContain("::selection{background:var(--ink);color:var(--paper)}");
  });
});
