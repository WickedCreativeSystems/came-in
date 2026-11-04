// The live connection to the shop's room. Reconnects with backoff 1, 2, 4,
// 8 s, max 30 s, and refetches counts on reconnect (plan 1.4).
import type { RoomMessage } from "@shared/types";

export function connectRoom(path: string, onMessage: (m: RoomMessage) => void, onReconnect: () => void): () => void {
  let ws: WebSocket | null = null;
  let tries = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let everOpened = false;

  const open = () => {
    if (closed) return;
    const url = new URL(path, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(url.toString());
    ws.onopen = () => {
      if (everOpened) onReconnect();
      everOpened = true;
      tries = 0;
      ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      try {
        onMessage(JSON.parse(e.data));
      } catch {}
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (closed) return;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(tries, 5));
      tries++;
      timer = setTimeout(open, delay);
    };
  };
  open();
  const onVisible = () => {
    if (document.visibilityState === "visible" && ws && ws.readyState > 1) {
      clearTimeout(timer);
      open();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(ping);
    document.removeEventListener("visibilitychange", onVisible);
    ws?.close();
  };
}
