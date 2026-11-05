import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (shop.isSample) return;
    fetchLocations().then(setLocs).catch(() => undefined);
  }, [shop.id]);
  useEffect(() => {
    if (!menu) return;
    // Focus moves into the menu: Down and Up move, Home and End jump, Enter chooses, Escape closes.
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        btnRef.current?.focus();
        return;
      }
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
      items[next].focus();
    };
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
          <div class={`shop-text${many ? " has-switch" : ""}`}>
            {many ? (
              <div class="switcher">
                <button ref={btnRef} class="shop-name switch-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                  <span class="sw-name">{shop.name}</span>
                  <Icon name="chevron" size={12} />
                </button>
                {menu && (
                  <div class="switch-menu" role="menu" ref={menuRef}>
                    {locs!.shops.filter((s) => s.id !== shop.id).map((s) => (
                      <button key={s.id} role="menuitem" class="switch-item" onClick={() => void switchTo(s.id)}>
                        <Avatar name={s.name} url={s.avatarUrl} size={28} />
                        <span>{s.name}</span>
                      </button>
                    ))}
                    <div class="switch-rule" role="separator" />
                    <a role="menuitem" class="switch-item" href="/setup/add">
                      <Icon name="plus" size={18} />
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
