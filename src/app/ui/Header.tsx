import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { ShopSummary } from "@shared/types";
import { Avatar, BellMono } from "./glyphs";
import { TickNumber } from "./Count";
import { Icon } from "./icons";
import { soundOn, setSound } from "../lib/bell";

export type Tab = "wall" | "week" | "setup";

export function Header({ shop, today, tab, base }: { shop: ShopSummary; today: number | null; tab: Tab; base: string }): JSX.Element {
  const [sound, setSoundState] = useState(soundOn());
  const tabs: [Tab, string, string][] = [
    ["wall", "Wall", base === "/sample" ? "/sample" : "/wall"],
    ["week", "This week", `${base === "/sample" ? "/sample" : ""}/week`],
    ["setup", "Setup", `${base === "/sample" ? "/sample" : ""}/setup`],
  ];
  const nav = (cls: string) => (
    <nav class={cls} aria-label="Sections">
      {tabs.map(([k, label, href]) => (
        <a key={k} href={href} aria-current={tab === k ? "page" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
  return (
    <>
      <header class="sign">
        <div class="shop">
          <Avatar name={shop.name} url={shop.avatarUrl} size={36} />
          <div class="shop-text">
            <div class="shop-name">{shop.name}</div>
            <div class="shop-handle">{shop.isSample ? `Sample bakery · @${shop.handle}` : shop.handle ? `@${shop.handle}` : ""}</div>
          </div>
        </div>
        {nav("tabs")}
        <div class="tools">
          {today !== null && (
            <div class="today" title="People who came in because of a post today">
              <BellMono size={18} />
              <TickNumber value={today} class="n" />
              <span class="lbl">came in today</span>
            </div>
          )}
          <button
            class="btn quiet"
            aria-pressed={sound}
            title={sound ? "Bell sound on" : "Bell sound off"}
            onClick={() => {
              setSound(!sound);
              setSoundState(!sound);
            }}
          >
            <Icon name={sound ? "sound" : "soundOff"} size={20} />
            <span class="sr">{sound ? "Bell sound on" : "Bell sound off"}</span>
          </button>
        </div>
      </header>
      {nav("bottombar")}
    </>
  );
}
