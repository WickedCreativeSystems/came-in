// The bell's sound (look.md section 7): a small brass shop bell, two strikes
// 130 ms apart, inharmonic partials of 1568 Hz, fast decay, a clapper click.
// This is the sample's WebAudio synthesis, shipped as-is (plan section 2).
// It plays only after the owner has interacted with the page once.
import { storage } from "./device";

let ctx: AudioContext | null = null;
let unlocked = false;

export function soundOn(): boolean {
  return storage("ci_sound") !== "off";
}
export function setSound(on: boolean): void {
  storage("ci_sound", on ? "on" : "off");
}

function unlock() {
  unlocked = true;
  try {
    ctx = ctx ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {}
}

/** Any press on the page counts as the first interaction (plan section 2). */
export function listenForFirstInteraction(): void {
  const once = () => {
    unlock();
    window.removeEventListener("pointerdown", once, true);
    window.removeEventListener("keydown", once, true);
  };
  window.addEventListener("pointerdown", once, true);
  window.addEventListener("keydown", once, true);
}

export function ringSound(): void {
  if (!unlocked || !soundOn() || !ctx) return;
  try {
    const c = ctx;
    const t0 = c.currentTime;
    const master = c.createGain();
    master.gain.value = 0.5;
    master.connect(c.destination);
    const strike = (t: number, amp: number, detune: number) => {
      for (const [r, a] of [[1, 1], [2.0, 0.5], [2.4, 0.32], [3.0, 0.22], [4.2, 0.1]] as const) {
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.value = 1568 * r * detune;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * amp, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0005, t + (r < 2 ? 1.1 : 0.5));
        o.connect(g);
        g.connect(master);
        o.start(t);
        o.stop(t + 1.2);
      }
      const n = c.createBufferSource();
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.02), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      n.buffer = buf;
      const ng = c.createGain();
      ng.gain.value = 0.25 * amp;
      n.connect(ng);
      ng.connect(master);
      n.start(t);
    };
    strike(t0, 1, 1);
    strike(t0 + 0.13, 0.6, 1.02);
  } catch {}
}
