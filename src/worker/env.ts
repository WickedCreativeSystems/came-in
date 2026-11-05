import type { ShopRoom } from "./shoproom";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  SHOP_ROOM: DurableObjectNamespace<ShopRoom>;
  ASSETS: Fetcher;
  APP_ENV: "production" | "staging" | "test" | "development";
  PUBLIC_ORIGIN: string;
  BUFFER_CLIENT_ID: string;
  BUFFER_CLIENT_SECRET: string;
  TOKEN_ENC_KEY: string;
  COOKIE_SECRET: string;
  VAPID_PUBLIC?: string;
  VAPID_PRIVATE?: string;
  VAPID_SUBJECT?: string;
  ANTHROPIC_API_KEY?: string;
  /** Locations (plan 3.13): the price for more than one shop, and Walker's Stripe Payment Link. Both optional. */
  PRICE_TEXT?: string;
  STRIPE_PAYMENT_LINK?: string;
  /** The landing's Contact line (plan 3.1). Set at deploy, never typed into the repo. */
  CONTACT_EMAIL?: string;
  /** "1" on staging: Post it again and Post this save Buffer drafts, never queue (plan section 2, P12). */
  BUFFER_DRAFTS?: string;
  /** Tests only: extra push hosts to accept, comma-separated. */
  PUSH_TEST_HOSTS?: string;
  /** Tests only: a base URL that stands in for Buffer. */
  BUFFER_API_URL?: string;
  BUFFER_AUTH_URL?: string;
}

export const BUFFER_API = "https://api.buffer.com";
export const BUFFER_AUTH = "https://auth.buffer.com";

export function bufferApiUrl(env: Env): string {
  return env.BUFFER_API_URL || BUFFER_API;
}
export function bufferAuthUrl(env: Env): string {
  return env.BUFFER_AUTH_URL || BUFFER_AUTH;
}
