const CACHE = "atas-v5";
const ARQUIVOS = ["/", "/index.html", "/style.css?v=4", "/pdf.css?v=3", "/app.js?v=5", "/pdf.js?v=3", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/brand/solven-logo-horizontal-color.webp", "/brand/solven-step-marker.png", "/brand/solven-list-marker.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase, Gemini etc. sempre pela rede
  // rede primeiro (pega atualizações), cache se estiver sem internet
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))),
  );
});
