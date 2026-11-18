/* Discharge Helper service worker — precaches the app shell so the app works
   offline after first load, and caches the local text-recogniser files
   lazily on first use so the first load stays small. */

const CACHE = "discharge-helper-shell";

const SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Fetch the entry HTML and cache every script/stylesheet it references,
      // so the shell is complete even though hashed asset names are unknown here.
      try {
        const html = await fetch("./").then((r) => r.text());
        const scope = self.registration?.scope ?? new URL("./", self.location.href).href;
        const urls = [...SHELL];
        for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
          const raw = m[1];
          if (!raw || raw.startsWith("http") || raw.startsWith("data:")) continue;
          if (/\.(js|css|woff2?|png|svg|ico)$/i.test(raw) || raw.includes("/assets/")) {
            try {
              urls.push(new URL(raw, scope).pathname);
            } catch {
              /* ignore malformed URL */
            }
          }
        }
        await cache.addAll(urls);
      } catch {
        // Best effort: at minimum the navigation fallback is cached below on
        // first fetch.
        await cache.addAll(SHELL);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // This app makes no cross-origin requests; anything cross-origin is not ours.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(caches.match("./index.html").then((c) => c ?? fetch(req)));
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (c) =>
        c ??
        fetch(req).then((res) => {
          // Cache same-origin assets (including the lazily loaded text
          // recogniser under /ocr/) so they keep working offline afterwards.
          if (res.ok && (url.pathname.includes("/assets/") || url.pathname.includes("/ocr/"))) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
