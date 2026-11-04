// This week, Setup and a post's page are built in later phases (plan section 5).
// Until then the tab opens a page that says so plainly.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { WallData } from "@shared/types";
import { api } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { Header, type Tab } from "../ui/Header";

export function Later({ tab, sample, title, phase }: { tab: Tab; sample: boolean; title: string; phase: number }): JSX.Element {
  const [data, setData] = useState<WallData | null>(null);
  useEffect(() => {
    api<WallData>(sample ? "/api/sample/wall" : "/api/wall")
      .then((d) => {
        setData(d);
        applyTheme(d.shop.theme);
      })
      .catch(() => (location.href = "/"));
  }, []);
  if (!data) return <main class="page" />;
  return (
    <>
      <Header shop={data.shop} today={data.countToday} tab={tab} base={sample ? "/sample" : ""} />
      <main class="page">
        <h1 class="h1">{title}</h1>
        <p class="muted">This part of Came In is built in phase {phase}.</p>
      </main>
    </>
  );
}
