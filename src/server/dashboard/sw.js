// sw.js — Service Worker: app shell caching, never caches API calls
//
// CACHE_NAME is templated at serve time — the literal string
// `__PILOT_CACHE_VERSION__` below gets replaced with `pilot-v<PILOT_VERSION>`
// by `serveDashboardFile` in `src/server/http/handlers.ts`. This means every
// plugin release produces a new cache key automatically, and the `activate`
// handler below deletes older caches without us ever having to remember to
// bump a literal.
//
// Before 1.13.15 this was a hardcoded `pilot-v21` that drifted version-over-
// version without anyone bumping it, which is how the "token inválido" bug
// in 1.13.14 stayed latent — browsers kept serving stale dashboard assets
// from a cache that outlived the plugin version that created it.
//
// Fetch strategy is stale-while-revalidate for the app shell: the cached
// copy renders instantly, and in parallel we fetch a fresh copy so the
// NEXT load gets the new code. Prior versions used cache-first with no
// revalidation, which locked users onto an old bundle until the cache
// name changed — that's how the `message.part.delta` handler in 1.13.2
// was invisible to already-open tabs.
const CACHE_NAME = "__PILOT_CACHE_VERSION__"
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

// Allowlist of URL patterns that are safe to cache. Anything not matching
// this list (API endpoints, SSE streams, mutations) falls through to the
// network without touching the cache. This replaces the old denylist that
// missed authenticated paths like /agents, /providers, /projects,
// /connect-info, /auth/rotate, /file/list, /file/content, /lsp/status,
// /mcp/status, etc. — a stale cached response to any of those could leak
// outdated token/session/project data across sessions.
const STATIC_ASSET_PATTERNS = [
  /^\/(?:index\.html)?$/,                                                    // bare origin root
  /^\/dashboard\/(?:index\.html)?$/,                                         // dashboard shell
  /\.(?:js|css|png|jpg|jpeg|svg|woff2?|ttf|otf|ico|webmanifest)(?:\?.*)?$/, // typed static files
  /^\/manifest\.json$/,                                                       // web app manifest
  /^\/sw\.js$/,                                                               // service worker itself
]

function isStaticAsset(url) {
  const path = new URL(url).pathname
  return STATIC_ASSET_PATTERNS.some((rx) => rx.test(path))
}

self.addEventListener("fetch", (event) => {
  const { request } = event

  // Only intercept GET — never cache mutations (POST, PATCH, DELETE, etc.)
  if (request.method !== "GET") return

  // Only intercept same-origin requests — avoids caching CDN / Cloudflared
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Only cache known static assets — everything else (API, SSE, etc.) falls
  // through to the network untouched, so the browser handles it natively.
  if (!isStaticAsset(request.url)) return

  // Stale-while-revalidate for app shell assets: serve the cache instantly
  // (if present), and in parallel fetch from the network to refresh the
  // cache for the next request. This is the fix for the 1.13.2 situation
  // where fresh JS (message.part.delta handler, optimistic rendering,
  // etc.) was sitting on disk but browsers kept running the cached copy.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      const networkFetch = fetch(request)
        .then((res) => {
          // Only cache successful, same-origin basic responses (skip opaque
          // cross-origin + error responses to avoid polluting the cache).
          if (res && res.ok && res.type === "basic") {
            cache.put(request, res.clone()).catch(() => {})
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
      if (request.mode === "navigate") {
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
