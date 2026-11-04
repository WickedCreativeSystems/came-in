// Came In's service worker (plan section 2): the app shell for offline
// starts, and the bell's notification on the owner's phone (P9).
const SHELL = "came-in-shell-v1";
const APP_PATHS = ["/wall", "/week", "/setup", "/sample", "/sample/week", "/sample/setup"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/wall"]).catch(() => undefined)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Network first for the app's pages and bundles; the cache only when offline.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isShell = req.mode === "navigate" && APP_PATHS.includes(url.pathname);
  const isAsset = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/");
  if (!isShell && !isAsset) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(isShell ? "/wall" : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(isShell ? "/wall" : req).then((r) => r || Response.error())),
  );
});

self.addEventListener("push", (event) => {
  let note = { title: "Came In", body: "Someone just came in.", icon: "/icons/icon-192.png", url: "/wall", tag: undefined };
  try {
    note = { ...note, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(note.title, {
      body: note.body,
      icon: note.icon,
      badge: "/icons/icon-192.png",
      tag: note.tag,
      renotify: !!note.tag,
      data: { url: note.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/wall", location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url === target && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
