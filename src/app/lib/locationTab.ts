// The location tab chosen on the Wall, This week and A post (plan 3.13): one choice for the three
// screens, kept per shop in this browser. Storage can be blocked, so every touch is guarded.
const key = (shopId: string) => `ci_loc_${shopId}`;

export function readTab(shopId: string): string | null {
  try {
    const v = localStorage.getItem(key(shopId));
    return v && /^[a-z]{10}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveTab(shopId: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(key(shopId), id);
    else localStorage.removeItem(key(shopId));
  } catch {
    /* the choice just won't be remembered */
  }
}

/** The query string for a chosen location ("" for all). */
export function locQuery(id: string | null, joiner: "?" | "&" = "?"): string {
  return id ? `${joiner}loc=${encodeURIComponent(id)}` : "";
}
