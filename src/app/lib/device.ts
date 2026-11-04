// The device id the tap page also uses (plan 1.3), so the owner's own
// device is never rung by its own tap (plan 1.4).
export function storage(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
    return value;
  } catch {
    return null;
  }
}

export function deviceId(key = "ci_device"): string {
  let id = storage(key);
  if (!id) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    id = Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
    storage(key, id);
  }
  return id;
}
