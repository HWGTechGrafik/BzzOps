/* BzzOps – Service Worker für den Offline-Betrieb der gehosteten Web-App.
   Strategie „Netz zuerst": online kommt immer der neueste Stand (kein
   Cache-Hochzählen bei Updates nötig), offline liefert der Zwischenspeicher
   alles, was schon einmal geladen wurde. Der Cache-Name hängt am Ordner
   (scope), damit mehrere Kunden unter derselben Domain getrennt bleiben. */
const CACHE = "bzzops-" + self.registration.scope;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const anfrage = e.request;
  if (anfrage.method !== "GET" || !anfrage.url.startsWith(self.registration.scope)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const antwort = await fetch(anfrage, { cache: "no-cache" });
      if (antwort.ok) cache.put(anfrage, antwort.clone());
      return antwort;
    } catch (fehler) {
      const gespeichert = await cache.match(anfrage, { ignoreSearch: true });
      if (gespeichert) return gespeichert;
      if (anfrage.mode === "navigate") {
        const start = (await cache.match("./")) || (await cache.match("./index.html"));
        if (start) return start;
      }
      throw fehler;
    }
  })());
});
