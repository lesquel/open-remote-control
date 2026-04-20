// sw.js — Service Worker: app shell caching, never caches API calls
//
// Bump CACHE_NAME on every release that changes frontend files (.js/.css/
// .html). The `activate` handler below deletes any older named caches, so
// bumping this name is the primary mechanism for flushing a stale app
// shell from users' browsers.
//
// Fetch strategy is stale-while-revalidate for the app shell: the cached
// copy renders instantly, and in parallel we fetch a fresh copy so the
// NEXT load gets the new code. Prior versions used cache-first with no
// revalidation, which locked users onto an old bundle until the cache
// name changed — that's how the `message.part.delta` handler in 1.13.2
// was invisible to already-open tabs.
const CACHE_NAME = "pilot-v21"
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
  "./command-palette.js",
  "./subagents.js",
  "./files-changed.js",
  "./files-changed-bridge.js",
  "./references.js",
  "./label-strip.js",
  "./usage-indicator.js",
  "./agent-panel.js",
  "./right-panel.js",
  "./debug-modal.js",
  "./todo-dock.js",
  "./push-notifications.js",
  "./command-history.js",
  "./file-browser.js",
  "./notif-sound.js",
  "./project-tabs.js",
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
    "/push",
    "/fs",
    "/settings",
  ]
  const isApiCall = apiPaths.some((p) => url.pathname.startsWith(p))
  if (isApiCall) return // Pass through, browser handles natively

  // Stale-while-revalidate for app shell assets: serve the cache instantly
  // (if present), and in parallel fetch from the network to refresh the
  // cache for the next request. This is the fix for the 1.13.2 situation
  // where fresh JS (message.part.delta handler, optimistic rendering,
  // etc.) was sitting on disk but browsers kept running the cached copy.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request)
      const networkFetch = fetch(event.request)
        .then((res) => {
          // Only cache successful, same-origin basic responses (skip opaque
          // cross-origin + error responses to avoid polluting the cache).
          if (res && res.ok && res.type === "basic") {
            cache.put(event.request, res.clone()).catch(() => {})
          }
          return res
        })
        .catch(() => null)

      if (cached) {
        // Kick off the revalidation but don't wait for it — the user gets
        // the cached bytes right now, the fresh bytes land for next time.
        networkFetch.catch(() => {})
        return cached
      }

      // No cache yet — wait on the network, fall back to index.html for
      // navigation requests if we're offline.
      const res = await networkFetch
      if (res) return res
      if (event.request.mode === "navigate") {
        return (await caches.match("./index.html")) ?? Response.error()
      }
      return Response.error()
    })
  )
})

// ── Push ───────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let payload = { title: "OpenCode Pilot", body: "", data: {} }
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() }
    } catch (_) {
      try {
        payload.body = event.data.text()
      } catch (_2) {}
    }
  }
  const { title, body, data } = payload
  event.waitUntil(
    self.registration.showNotification(title || "OpenCode Pilot", {
      body: body || "",
      icon: "./icons/icon.svg",
      badge: "./icons/icon.svg",
      data: data || {},
      requireInteraction: true,
      actions: [
        { action: "open", title: "Open" },
        { action: "dismiss", title: "Dismiss" },
      ],
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  if (event.action === "dismiss") return

  const target = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const c of all) {
        try {
          const u = new URL(c.url)
          if (u.origin === self.location.origin) {
            await c.focus()
            if ("navigate" in c) {
              try { await c.navigate(target) } catch (_) {}
            }
            return
          }
        } catch (_) {}
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(target)
      }
    })()
  )
})
