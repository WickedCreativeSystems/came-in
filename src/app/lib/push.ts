// Ring my phone (plan 3.8; P9): permission, the service worker, the push
// subscription, and the cases where a phone can't ring.
import { api } from "./api";
import { deviceId } from "./device";

export type PhoneState = "idle" | "working" | "ok" | "denied" | "unsupported" | "ios" | "refused";

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function canPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** What Setup's PHONE section shows before anything is pressed. */
export function initialPhoneState(): PhoneState {
  if (!canPush()) return isIOS() && !isStandalone() ? "ios" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "idle";
}

/** Is this phone already set to ring? */
export async function thisPhoneRings(): Promise<boolean> {
  if (!canPush() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return !!(reg && (await reg.pushManager.getSubscription()));
  } catch {
    return false;
  }
}

export function registerServiceWorker(): void {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ringMyPhone(sample: boolean, publicKey: string | null): Promise<PhoneState> {
  if (!canPush()) return isIOS() && !isStandalone() ? "ios" : "unsupported";
  if (!publicKey) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  try {
    await api(sample ? "/api/sample/push/subscribe" : "/api/push/subscribe", { json: { device: deviceId(), subscription: sub.toJSON() } });
  } catch {
    return "refused";
  }
  return "ok";
}
