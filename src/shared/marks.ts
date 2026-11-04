// Channel marks (look.md section 5): Simple Icons logomarks for Buffer's
// services, a two-letter monogram for anything else, "+N" beyond three.

export const SERVICE_NAMES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  googlebusiness: "Google Business Profile",
  twitter: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  substack: "Substack",
  startPage: "Start Page",
  whatsapp: "WhatsApp",
};

/** Buffer `Service` enum value → symbol id in channel-marks.svg, or null for the monogram. */
export const MARK_IDS: Record<string, string> = {
  instagram: "mark-instagram",
  facebook: "mark-facebook",
  googlebusiness: "mark-google",
  twitter: "mark-x",
  linkedin: "mark-linkedin",
  tiktok: "mark-tiktok",
  youtube: "mark-youtube",
  pinterest: "mark-pinterest",
  threads: "mark-threads",
  bluesky: "mark-bluesky",
  mastodon: "mark-mastodon",
  substack: "mark-substack",
};

export function serviceName(service: string): string {
  return SERVICE_NAMES[service] ?? service.charAt(0).toUpperCase() + service.slice(1);
}

export function markId(service: string): string | null {
  return MARK_IDS[service] ?? null;
}

/** "SP" for Start Page: the service's first two letters, uppercase. */
export function monogram(service: string): string {
  const name = serviceName(service).replace(/[^A-Za-z0-9]/g, "");
  return name.slice(0, 2).toUpperCase();
}

/** "See it on Instagram" (plan 3.9). */
export function seeItOn(service: string): string {
  return `See it on ${serviceName(service)}`;
}
