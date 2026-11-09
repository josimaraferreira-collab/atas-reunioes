// Guarda só os arquivos do app para abrir mais rápido. Login, API, áudios e atas sempre vão à rede.
const escopo = new URL(self.registration.scope);
const CACHE = "solven-atas-v1";
const ARQUIVOS = ["", "app.js", "style.css", "icons/icon-192.png", "icons/apple-touch-icon.png", "brand/solven-logo-horizontal-color.webp"].map((p) => new URL(p, escopo).href);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== escopo.origin || !url.pathname.startsWith(escopo.pathname)) return;
  const resto = url.pathname.slice(escopo.pathname.length);
  if (resto.startsWith("api/") || resto.startsWith("auth/")) return;
  // rede primeiro (pega atualizações); sem internet, usa a cópia
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(escopo.href))),
  );
});
