// sw.js — Service Worker: app shell caching, never caches API calls
const CACHE_NAME = "pilot-v13"
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
  ]
  const isApiCall = apiPaths.some((p) => url.pathname.startsWith(p))
  if (isApiCall) return // Pass through, browser handles natively

  // Cache-first for app shell assets
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit

      return fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone))
          }
          return res
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html")
          }
        })
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
