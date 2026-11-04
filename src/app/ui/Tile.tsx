import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { WallTile } from "@shared/types";
import { dayBadge, textOnlyCaption, firstLine } from "@shared/names";
import { Marks } from "./marks";
import { Sticker } from "./Count";
import { Icon } from "./icons";

export function Tile({ tile, index, now, tz, flash, href }: { tile: WallTile; index: number; now: Date; tz: string; flash: boolean; href?: string }): JSX.Element {
  const [broken, setBroken] = useState(false);
  const sent = new Date(tile.firstSentAt);
  const showImage = tile.imageUrl && !broken;
  const label = `${tile.name}. ${tile.count === 1 ? "1 person" : `${tile.count} people`} came in.`;
  const Tag = (href ? "a" : "div") as "a";
  return (
    <Tag class={`tile${tile.isLive ? " live" : ""}${tile.hidden ? " off-card" : ""}`} data-id={tile.id} href={href} aria-label={tile.hidden ? `${label} Hidden from the card.` : label} title={tile.hidden ? "Hidden from the card" : undefined}>
      {showImage ? (
        <img src={tile.imageUrl!} alt="" loading={index < 10 ? "eager" : "lazy"} decoding="async" onError={() => setBroken(true)} />
      ) : (
        // A tile whose image failed to load becomes a text tile; the count is unaffected.
        <div class="text-only">
          <span class="first">{firstLine(tile.text) || tile.name}</span>
          <small>{textOnlyCaption(sent, now, tz)}</small>
        </div>
      )}
      <div class="top">
        <span class={`day${tile.isLive ? " live" : ""}`}>{dayBadge(sent, now, tz, tile.isLive, "wall")}</span>
        {tile.hidden ? <span class="day off-badge">Off the card</span> : <Marks services={tile.services} />}
      </div>
      <Sticker count={tile.count} index={index} flash={flash} onPaper={!showImage} />
      {tile.tagged && (
        <span class="tagged" title={`Tagged "Came in" in Buffer`}>
          <Icon name="tag" size={12} />
          <span class="lbl">In Buffer</span>
        </span>
      )}
    </Tag>
  );
}
