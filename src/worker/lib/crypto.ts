// Random ids, hashing, signed cookies, token encryption and PKCE, all on WebCrypto.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** 10 random lowercase letters: shop ids (plan 1.3). */
export function shopId(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(10), (b) => letters[b % 26]).join("");
}

/** 32 random url-safe chars: counter tokens, session ids. */
export function randomToken(chars = 32): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(randomBytes(chars), (b) => alphabet[b % alphabet.length]).join("");
}

export function uuid(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** text_hash: sha-256 of the text lowercased, whitespace collapsed, URLs removed (plan 1.3). */
export async function textHash(text: string): Promise<string> {
  const norm = text.replace(/https?:\/\/\S+/gi, "").toLowerCase().replace(/\s+/g, " ").trim();
  return sha256Hex(norm);
}

/** device_hash = sha-256 of deviceId + shopId (plan 1.3). */
export async function deviceHash(deviceId: string, shopId: string): Promise<string> {
  return sha256Hex(`${deviceId}${shopId}`);
}

// ---- HMAC-signed values (cookies) ----

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(value: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return `${value}.${base64url(mac)}`;
}

export async function verify(signed: string | undefined | null, secret: string): Promise<string | null> {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 1) return null;
  const value = signed.slice(0, i);
  const mac = signed.slice(i + 1);
  const key = await hmacKey(secret);
  let macBytes: Uint8Array<ArrayBuffer>;
  try {
    macBytes = fromBase64url(mac);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("HMAC", key, macBytes, enc.encode(value));
  return ok ? value : null;
}

// ---- AES-GCM for Buffer tokens (plan 1.3) ----

async function aesKey(secretB64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer> = fromBase64url(secretB64.trim());
  if (raw.length !== 32) {
    // Any other secret shape is hashed to 32 bytes, so a wrong length can't weaken the key silently.
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(secretB64)));
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** "iv.ciphertext", both base64url. */
export async function encrypt(plain: string, secretB64: string): Promise<string> {
  const key = await aesKey(secretB64);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  return `${base64url(iv)}.${base64url(ct)}`;
}

export async function decrypt(stored: string, secretB64: string): Promise<string> {
  const [ivB64, ctB64] = stored.split(".");
  if (!ivB64 || !ctB64) throw new Error("bad ciphertext");
  const key = await aesKey(secretB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(ivB64) }, key, fromBase64url(ctB64));
  return dec.decode(pt);
}

// ---- PKCE (S256), required by Buffer ----

export function codeVerifier(): string {
  // 43 url-safe characters (plan 1.2).
  return base64url(randomBytes(32)).slice(0, 43);
}

export async function codeChallenge(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
