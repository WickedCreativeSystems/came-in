// Add a location (plan 3.13): another store of the shop, sharing its posts by default, or its own
// Buffer account as a separate shop.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { WallData } from "@shared/types";
import { api, ApiError } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { fetchLocations, type Locations } from "../lib/locations";
import { Header } from "../ui/Header";
import { HeaderSkeleton } from "../ui/Skeleton";

type Choice = "same" | "own";

export function AddLocation({ sample }: { sample: boolean }): JSX.Element {
  const [wall, setWall] = useState<WallData | null>(null);
  const [locs, setLocs] = useState<Locations | null>(null);
  const [name, setName] = useState("");
  const [first, setFirst] = useState("");
  const [choice, setChoice] = useState<Choice>("same");
  const [errName, setErrName] = useState<string | null>(null);
  const [errFirst, setErrFirst] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"form" | "consent">("form");
  const state = new URLSearchParams(location.search).get("state");

  useEffect(() => {
    api<WallData>(sample ? "/api/sample/wall" : "/api/wall")
      .then((w) => {
        setWall(w);
        applyTheme(w.shop.theme);
      })
      .catch((e) => e instanceof ApiError && e.status === 401 && (location.href = "/"));
    if (!sample)
      fetchLocations()
        .then((l) => {
          setLocs(l);
          const mine = l.locations ?? [];
          if (mine.length === 1) setFirst(mine[0].name);
        })
        .catch(() => undefined);
  }, []);

  if (!wall)
    return (
      <>
        <HeaderSkeleton />
        <main class="page" />
      </>
    );

  if (sample)
    return (
      <>
        <Header shop={wall.shop} today={wall.countToday} tab="setup" base="/sample" />
        <main class="page add-loc">
          <h1 class="h1">Add a location</h1>
          <div class="strip">
            <span>The sample bakery has one location. Connect your own Buffer to add yours.</span>
          </div>
          <p>
            <a class="btn primary" href="/auth/start">
              Connect your own Buffer
            </a>
          </p>
        </main>
      </>
    );

  const mine = locs?.locations ?? [];
  const full = mine.length >= (locs?.cap ?? 10);
  const shopName = wall.shop.name;

  async function submit(e: Event) {
    e.preventDefault();
    setErrName(null);
    setErrFirst(null);
    const nm = name.replace(/\s+/g, " ").trim();
    if (!nm) return setErrName("Give it a name.");
    if (choice === "own") {
      if ([...nm].length > 24) return setErrName("Use 24 characters or fewer.");
      setStep("consent");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ next: string }>("/api/shop/locations", { json: { name: nm, firstName: mine.length === 1 ? first : undefined } });
      location.href = r.next;
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        const msg = typeof err.body.error === "string" ? err.body.error : "Something's wrong on our side. Try again in a minute.";
        if (err.body.field === "firstName") setErrFirst(msg);
        else setErrName(msg);
      } else setErrName("Something's wrong on our side. Try again in a minute.");
    }
  }

  return (
    <>
      <Header shop={wall.shop} today={wall.countToday} tab="setup" base="" />
      <main class="page add-loc">
        {state === "none" && (
          <div class="strip">
            <span>Every shop in this Buffer is already added. To add a store that shares its posts, choose Same posts.</span>
            <a class="btn sm" href="/auth/start?add=1">
              Connect a different Buffer account
            </a>
          </div>
        )}
        {state === "reconnected" && (
          <div class="strip" role="status">
            <span>Reconnected.</span>
          </div>
        )}
        <h1 class="h1">Add a location</h1>
        {step === "consent" ? (
          <div class="add-form">
            <p class="small muted">You'll sign in to Buffer again, so each shop keeps its own connection.</p>
            <p class="btn-row">
              <a class="btn primary" href={`/auth/start?add=1&name=${encodeURIComponent(name.replace(/\s+/g, " ").trim())}`}>
                Connect Buffer
              </a>
              <button class="btn quiet" onClick={() => setStep("form")}>
                Back
              </button>
            </p>
          </div>
        ) : (
          <form class="add-form" onSubmit={submit} noValidate>
            <p>Another store of yours? Give it a name and print its card. You'll see who comes in there.</p>
            <div class="field">
              <label class="small strong" for="loc-name">
                Name it
              </label>
              <input id="loc-name" class={`input${errName ? " error" : ""}`} value={name} maxLength={24} placeholder="Eastside" onInput={(e) => { setName((e.target as HTMLInputElement).value); setErrName(null); }} />
              {errName && (
                <div class="input-error" role="alert">
                  {errName}
                </div>
              )}
            </div>
            {mine.length === 1 && choice === "same" && (
              <div class="field">
                <label class="small strong" for="loc-first">
                  And the one you have now
                </label>
                <input id="loc-first" class={`input${errFirst ? " error" : ""}`} value={first} maxLength={24} onInput={(e) => { setFirst((e.target as HTMLInputElement).value); setErrFirst(null); }} />
                {errFirst && (
                  <div class="input-error" role="alert">
                    {errFirst}
                  </div>
                )}
              </div>
            )}
            <fieldset class="posts-choice">
              <legend class="body-strong">Its posts</legend>
              <label class={`radio-row${choice === "same" ? " on" : ""}`}>
                <input type="radio" name="posts" checked={choice === "same"} onChange={() => setChoice("same")} />
                <span>
                  <strong>Same posts as {shopName}</strong>
                  <span class="small muted">It shares your Buffer and your wall. It gets its own card and counts.</span>
                </span>
              </label>
              <label class={`radio-row${choice === "own" ? " on" : ""}`}>
                <input type="radio" name="posts" checked={choice === "own"} onChange={() => setChoice("own")} />
                <span>
                  <strong>Its own Buffer account</strong>
                  <span class="small muted">For a store with its own Instagram or Facebook. You'll sign in to Buffer again.</span>
                </span>
              </label>
            </fieldset>
            <div class="btn-row">
              {full ? (
                <p class="small muted">A shop can have up to 10 locations.</p>
              ) : (
                <button class="btn primary" type="submit" disabled={busy}>
                  {busy && <span class="spin" aria-hidden="true" />}
                  Add location
                </button>
              )}
              <a class="btn quiet" href="/setup#locations">
                Not now
              </a>
            </div>
          </form>
        )}
      </main>
    </>
  );
}
