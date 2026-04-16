// sw.js — Service Worker: app shell caching, never caches API calls
const CACHE_NAME = "pilot-v1"
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./main.js",
  "./state.js",
  "./api.js",
  "./auth.js",
  "./sse.js",
  "./markdown.js",
  "./diff.js",
  "./messages.js",
  "./sessions.js",
  "./multi-view.js",
  "./permissions.js",
  "./settings.js",
  "./shortcuts.js",
  "./toast.js",
  "./connect.js",
  "./manifest.json",
  "./icons/icon.svg",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)

  // Never cache API calls — those go to the plugin server (same-origin or tunnel)
  const apiPaths = [
    "/sessions",
    "/events",
    "/permissions",
    "/status",
    "/tools",
    "/project",
  ]
  const isApiCall = apiPaths.some((p) => url.pathname.startsWith(p))
  if (isApiCall) return // Pass through, browser handles natively

  // Cache-first for app shell assets
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit

      return fetch(event.request)
        .then((res) => {
          // Cache successful same-origin or CDN responses for static assets
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone))
          }
          return res
        })
        .catch(() => {
          // Offline fallback: return index.html for navigations
          if (event.request.mode === "navigate") {
            return caches.match("./index.html")
          }
        })
    })
  )
})
