import type { JSX } from "preact";

/** The brass bell (look.md section 7). It is the logo and the one brass thing. */
export function Bell({ class: cls, size }: { class?: string; size?: number }): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <path d="M20 4.5c.9 0 1.6.7 1.6 1.6v1.2c5.3.8 9.2 5.3 9.2 10.8v7.3l3 4.2H6.2l3-4.2v-7.3C9.2 12.6 13.1 8.1 18.4 7.3V6.1c0-.9.7-1.6 1.6-1.6z" fill="var(--brass)" />
      <path d="M6.2 29.6h27.6v2.1H6.2z" fill="var(--brass-deep)" />
      <circle cx="20" cy="34.4" r="2.6" fill="var(--brass-deep)" />
      <path d="M12.5 17.8c.6-3.6 3.2-6.3 6.5-7.1" stroke="var(--brass-tint)" stroke-width="1.4" stroke-linecap="round" fill="none" opacity=".8" />
    </svg>
  );
}

/** The monochrome stroke bell (1.6px) for the header count and the Came In mark. */
export function BellMono({ size }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 3a1 1 0 0 1 1 1v.6a6.5 6.5 0 0 1 5.5 6.4v4.2L20 17.5H4l1.5-2.3V11A6.5 6.5 0 0 1 11 4.6V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M10 20.2a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

export function Avatar({ name, url, size }: { name: string; url: string | null; size: number }): JSX.Element {
  if (url) return <img class="avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const ini = ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
  return (
    <span class="avatar avatar-fallback" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}>
      {ini}
    </span>
  );
}
