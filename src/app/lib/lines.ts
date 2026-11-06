// The words a write-back says when it is done (plan 3.7, 3.9, 1.8). No screen code here, so the tests can read it.

export type Outcome = "queued" | "approval" | "draft" | "failed" | "saved";

/** What a write-back says when it's done (plan 3.7, 3.9, 1.8). */
export function outcomeLine(o: Outcome): string {
  switch (o) {
    case "queued":
      return "Added to your Buffer queue.";
    case "approval":
      return "Sent to Buffer, waiting for approval.";
    case "draft":
      return "Saved as a draft in Buffer (staging).";
    case "saved":
      return "Saved to your Buffer Ideas.";
    default:
      return "Buffer didn't take that. Try again in a minute.";
  }
}

export interface SheetResult {
  outcome: Outcome;
  ok: string[];
  failed: string[];
}

function and(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The sheet's line (plan 3.9). With the post's name, the line is about that post: "Tuesday's sourdough post is in
 * your Buffer queue. It goes out at your next slot." (on staging "Saved as a draft in your Buffer."); some channels
 * failing: "Added on Instagram and TikTok. YouTube didn't take it."; none: the failure line.
 */
export function resultLine(r: SheetResult, postName?: string): string {
  if (r.outcome === "failed" || !r.ok.length) return outcomeLine("failed");
  if (!r.failed.length) {
    if (!postName) return outcomeLine(r.outcome);
    if (r.outcome === "queued") return `${sentenceStart(postName)} is in your Buffer queue. It goes out at your next slot.`;
    if (r.outcome === "draft") return "Saved as a draft in your Buffer.";
    return outcomeLine(r.outcome);
  }
  const lead = r.outcome === "draft" ? `Saved as a draft on ${and(r.ok)} (staging).` : `Added on ${and(r.ok)}.`;
  return `${lead} ${and(r.failed)} didn't take it.`;
}

/** The post's name at the start of a sentence: its first letter up, the rest as the owner wrote it ("The sourdough post"). */
export function sentenceStart(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

