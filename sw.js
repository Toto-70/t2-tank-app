const CACHE_NAME = "tank-tracker-v51";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./version.json",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(refreshAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === "REFRESH_APP_SHELL") {
    const replyPort = event.ports[0];
    event.waitUntil(
      refreshAppShell()
        .then(() => replyPort?.postMessage({ ok: true }))
        .catch((error) => replyPort?.postMessage({ ok: false, message: error.message })),
    );
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  if (!isSameOrigin) {
    return;
  }

  const isManualUpdateCheck =
    requestUrl.pathname.endsWith("/version.json") &&
    requestUrl.searchParams.has("check");

  event.respondWith(isManualUpdateCheck ? fetch(event.request) : cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === "navigate") {
      const fallbackResponse = await caches.match("./index.html");
      if (fallbackResponse) {
        return fallbackResponse;
      }
    }
    throw new Error(`Nicht im Offline-Cache: ${request.url}`);
  }
}

async function refreshAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    APP_SHELL.map(async (resource) => {
      const resourceUrl = new URL(resource, self.registration.scope);
      const response = await fetch(resourceUrl, { cache: "reload" });
      if (!response.ok) {
        throw new Error(`${resource} konnte nicht geladen werden (${response.status}).`);
      }
      await cache.put(resourceUrl, response);
    }),
  );
}
