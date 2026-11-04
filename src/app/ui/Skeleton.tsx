// The frame of an owner screen, drawn at once while its data loads (plan 3.4: a frame and
// tile placeholders within 300 ms, never a blank screen). index.html carries the same shapes
// before any script has run.
import type { JSX } from "preact";

export function HeaderSkeleton(): JSX.Element {
  return (
    <div class="sk-h" aria-hidden="true">
      <span class="sk-av" />
      <span class="sk-name" />
      <span class="sk-nav">
        <span>Wall</span>
        <span>This week</span>
        <span>Setup</span>
      </span>
    </div>
  );
}

export function TilesSkeleton(): JSX.Element {
  return (
    <div class="sk-g" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span class="sk-t" key={i} />
      ))}
    </div>
  );
}
