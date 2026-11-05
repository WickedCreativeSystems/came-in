// Location tabs (plan 3.13): chips under the header on the Wall, This week and A post, shown only
// when the shop has two or more locations. All locations first, then one chip per location.
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function LocationTabs({ locations, value, onChange }: { locations: { id: string; name: string }[]; value: string | null; onChange: (id: string | null) => void }): JSX.Element | null {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    row.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  if (locations.length < 2) return null;
  const chips: [string | null, string][] = [[null, "All locations"], ...locations.map((l) => [l.id, l.name] as [string, string])];
  return (
    <nav class="loc-tabs-wrap" aria-label="Location">
      <div class="loc-tabs" ref={row}>
        {chips.map(([id, name]) => (
          <button key={id ?? "all"} class="loc-chip" aria-pressed={value === id} onClick={() => onChange(id)} title={name}>
            <span>{name}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
