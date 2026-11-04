import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ShopSummary } from "@shared/types";
import { Avatar, BellMono } from "./glyphs";
import { TickNumber } from "./Count";
import { Icon } from "./icons";
import { soundOn, setSound } from "../lib/bell";
import { fetchLocations, switchTo, type Locations } from "../lib/locations";

export type Tab = "wall" | "week" | "setup";

export function Header({ shop, today, tab, base }: { shop: ShopSummary; today: number | null; tab: Tab; base: string }): JSX.Element {
  const [sound, setSoundState] = useState(soundOn());
  // Once this browser holds two or more shops, the name becomes a switcher (plan 3.13).
  const [locs, setLocs] = useState<Locations | null>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (shop.isSample) return;
    fetchLocations().then(setLocs).catch(() => undefined);
  }, [shop.id]);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    const away = (e: MouseEvent) => !(e.target as HTMLElement).closest?.(".switcher") && setMenu(false);
    addEventListener("keydown", esc);
    addEventListener("click", away);
    return () => {
      removeEventListener("keydown", esc);
      removeEventListener("click", away);
    };
  }, [menu]);
  const many = !shop.isSample && !!locs && locs.shops.length >= 2;
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
            {many ? (
              <div class="switcher">
                <button class="shop-name switch-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                  {shop.name}
                  <Icon name="chevron" size={14} />
                </button>
                {menu && (
                  <div class="switch-menu" role="menu">
                    {locs!.shops.filter((s) => s.id !== shop.id).map((s) => (
                      <button key={s.id} role="menuitem" class="switch-item" onClick={() => void switchTo(s.id)}>
                        <Avatar name={s.name} url={s.avatarUrl} size={24} />
                        <span>{s.name}</span>
                      </button>
                    ))}
                    <div class="switch-rule" role="separator" />
                    <a role="menuitem" class="switch-item" href="/setup/add">
                      Add a location
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div class="shop-name">{shop.name}</div>
            )}
            <div class="shop-handle">{shop.isSample ? `Sample bakery · @${shop.handle}` : shop.handle ? `@${shop.handle}` : ""}</div>
          </div>
        </div>
        {nav("tabs")}
        <div class="tools">
          {today !== null && (
            <a class="today" href={`${base}/week?range=today`} title="People who came in because of a post today">
              <BellMono size={18} />
              <TickNumber value={today} class="n" />
              <span class="lbl">
                came in<span class="lbl-day"> today</span>
              </span>
            </a>
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
