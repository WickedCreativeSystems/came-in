// Payloads shared by the Worker and the owner app.

export type Theme = "system" | "day" | "night";
export type TapAnswer = "post" | "walked_past" | "friend" | "google";
export type TapSource = "card" | "counter" | "online" | "sample";

export interface ShopSummary {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  timezone: string;
  theme: Theme;
  isSample: boolean;
  markWinners: boolean;
  tapUrl: string;
  createdAt: string;
}

export interface WallTile {
  id: string;
  name: string; // the sentence name, e.g. "Tuesday's sourdough post"
  nickname: string | null;
  subject: string | null;
  text: string;
  firstSentAt: string;
  hasImage: boolean;
  imageUrl: string | null;
  kind: "photo" | "video" | "text" | "link";
  isStory: boolean;
  isLive: boolean;
  services: string[];
  links: { service: string; url: string }[];
  count: number;
  /** Our note is on the post in Buffer. */
  noted: boolean;
  hidden: boolean;
}

export type SyncStatus = "idle" | "running" | "failed";

export interface WallData {
  shop: ShopSummary;
  tiles: WallTile[];
  countToday: number;
  countThisWeek: number;
  hasTapped: boolean;
  sync: { status: SyncStatus; count: number; startedAt: string | null };
  strips: { rateLimited: boolean; reconnect: boolean };
  checklist: { connected: boolean; card: boolean; counter: boolean; phone: boolean; thankYou: boolean; review: boolean };
  /** The shop's locations, and the one these counts are for (null: all locations). Tabs show with two or more. */
  locations: { id: string; name: string }[];
  location: string | null;
  now: string;
}

export interface ChannelRow {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  avatar: string | null;
  enabled: boolean;
  onCard: boolean;
}

export interface RingMessage {
  type: "ring";
  tileId: string | null;
  sentence: string;
  where: string;
  count: number;
  countToday: number;
  imageUrl: string | null;
  at: string;
  /** The location the tap was at, or null for an online tap (plan 1.4). */
  locationId?: string | null;
}

export interface PostsMessage {
  type: "posts";
  reason: "sync" | "poll" | "refresh";
  count?: number;
}

export interface SyncMessage {
  type: "sync";
  status: SyncStatus;
  count: number;
  done?: boolean;
}

export type RoomMessage = RingMessage | PostsMessage | SyncMessage | { type: "hello"; now: string };

export interface TapResponse {
  ok: boolean;
  counted: boolean;
  again: boolean;
  name: string | null;
  ticket: { text: string; at: string } | null;
  reviewUrl: string | null;
  error?: string;
}
