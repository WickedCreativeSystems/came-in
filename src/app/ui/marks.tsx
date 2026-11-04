// Channel marks (look.md section 5): the Simple Icons sprite from
// LookieBot's channel-marks.svg, a monogram for any other service, "+N".
import type { JSX } from "preact";
import sprite from "@shared/channel-marks.svg?raw";
import { markId, monogram, serviceName } from "@shared/marks";

let injected = false;
export function injectMarkSprite(): void {
  if (injected) return;
  injected = true;
  const holder = document.createElement("div");
  holder.innerHTML = sprite.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const svg = holder.querySelector("svg");
  if (svg) {
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    document.body.prepend(svg);
  }
}

export function Mark({ service }: { service: string }): JSX.Element {
  const id = markId(service);
  return (
    <span class="mark" title={serviceName(service)}>
      {id ? (
        <svg width="12" height="12" aria-hidden="true">
          <use href={`#${id}`} />
        </svg>
      ) : (
        <span class="monogram">{monogram(service)}</span>
      )}
      <span class="sr">{serviceName(service)}</span>
    </span>
  );
}

/** First three marks, then a "+N" circle. */
export function Marks({ services }: { services: string[] }): JSX.Element {
  const shown = services.slice(0, 3);
  const more = services.length - shown.length;
  return (
    <span class="marks">
      {shown.map((s) => (
        <Mark key={s} service={s} />
      ))}
      {more > 0 && (
        <span class="mark more" title={services.slice(3).map(serviceName).join(", ")}>
          +{more}
        </span>
      )}
    </span>
  );
}
