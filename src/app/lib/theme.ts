import type { Theme } from "@shared/types";

/** Setup's switch: Day · After close · Follow my phone (plan 3.8). The default follows the system. */
export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t === "day" ? "light" : t === "night" ? "dark" : "system";
}

export function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
