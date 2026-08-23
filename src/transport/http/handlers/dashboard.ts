import { readFileSync, readdirSync, existsSync, statSync } from "fs"
import { join, dirname, extname } from "path"
import { fileURLToPath } from "url"
import type { RouteContext } from "../routes"
import { jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"

// ─── Dashboard path ─────────────────────────────────────────────────────────
// The dashboard lives at src/dashboard/ (moved from src/server/dashboard/ in Commit 5).
// __dirname arithmetic: this file is at src/transport/http/handlers/dashboard.ts.
// 3 levels up (../../../) reaches src/, then into dashboard/.

const __dirname = dirname(fileURLToPath(import.meta.url))

/** The directory that contains the split dashboard. */
const DASHBOARD_DIR = join(__dirname, "../../../dashboard")

/** Path to the dashboard entry point. */
const DASHBOARD_INDEX_PATH = join(DASHBOARD_DIR, "index.html")

let cachedHtml: string | null = null

function getDashboardHtml(dev: boolean): string {
  if (!dev && cachedHtml !== null) return cachedHtml
  const html = readFileSync(DASHBOARD_INDEX_PATH, "utf-8")
  if (!dev) cachedHtml = html
  return html
}

/** MIME types for static dashboard assets. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
}

/**
 * Cache-Control used for every dashboard asset.
 *
 * `no-cache` does NOT mean "do not cache" (that's `no-store`). It means
 * "cache freely, but revalidate with the origin before using". The browser
 * will still hit the server on every load and we'll respond with a fresh
 * copy from the in-memory snapshot. This costs us a round-trip per asset
 * in exchange for making every user pick up a new version on the next
 * refresh — no more users stuck on an old bundle for a month because their
 * service worker intercepted the request before it hit the network.
 */
const DASHBOARD_CACHE_HEADERS = {
  "Cache-Control": "no-cache, must-revalidate",
} as const

/**
 * In-memory cache of dashboard files.
 *
 * Previously we read each file from disk on every request. That broke
 * catastrophically if someone deleted the plugin's cache directory while
 * the server was running (e.g. `npx init` while OpenCode is alive) — the
 * HTTP server kept serving but every asset request returned 404, leaving
 * the user's browser stuck on whatever it had cached before.
 *
 * We now snapshot every file under DASHBOARD_DIR into memory at boot.
 * Responses serve from memory, so cache-wipe operations can't break a
 * running dashboard.
 *
 * Dev mode (`PILOT_DEV=true`) bypasses the cache so live edits to
 * dashboard files show up without a plugin restart.
 */
type CachedAsset = { content: Buffer; mime: string }
const assetCache = new Map<string, CachedAsset>()

function loadAssetsIntoMemory(): void {
  if (!existsSync(DASHBOARD_DIR)) return
  const walk = (dir: string, prefix: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full, `${prefix}${entry}/`)
        continue
      }
      const ext = extname(full)
      const mime = MIME[ext] ?? "text/plain"
      try {
        assetCache.set(`${prefix}${entry}`, {
          content: readFileSync(full),
          mime,
        })
      } catch {
        // Skip unreadable files — they just return 404 at request time.
        // Critical assets are checked after the full walk (see below).
      }
    }
  }
  walk(DASHBOARD_DIR, "")

  // Post-load assertion: verify that critical assets are in the cache.
  // A corrupted or missing critical file (e.g. main.js, styles.css, sw.js)
  // would silently produce 404s at request time, leaving the dashboard
  // visually broken with no indication of why.
  // We do NOT crash here — the server can still run and might serve partial
  // content — but we log a clear warning so the problem is visible immediately
  // at startup rather than only when a user opens the dashboard.
  const CRITICAL_ASSETS = ["main.js", "styles.css", "sw.js"]
  const missing = CRITICAL_ASSETS.filter((name) => !assetCache.has(name))
  if (missing.length > 0) {
    console.error(
      `[opencode-pilot] warn: dashboard asset cache is missing critical files after load: [${missing.join(", ")}]. ` +
      `These will return 404 at runtime and leave the dashboard broken. ` +
      `Check that the package is installed correctly (try: bunx @lesquel/opencode-pilot@latest init).`,
    )
  }
}

// Lazy-load on first dashboard request so import order doesn't matter.
let assetsLoaded = false
function ensureAssetsLoaded(): void {
  if (assetsLoaded) return
  assetsLoaded = true
  loadAssetsIntoMemory()
}

/**
 * Apply per-file template substitutions. The service worker receives a
 * version-scoped cache name and index.html receives the same version as its
 * asset-generation marker. Keeping both derived from the injected package
 * version removes a manual release-time synchronization point.
 *
 * Keep this function pure and O(1) per file — it runs inside every
 * response path.
 */
function applyTemplating(relativePath: string, content: Buffer, pilotVersion: string): Buffer {
  if (relativePath === "index.html") {
    const replaced = content
      .toString("utf-8")
      .replace(/__PILOT_ASSET_GENERATION__/g, pilotVersion)
    return Buffer.from(replaced, "utf-8")
  }
  if (relativePath === "sw.js") {
    const replaced = content
      .toString("utf-8")
      .replace(/__PILOT_CACHE_VERSION__/g, `pilot-v${pilotVersion}`)
    return Buffer.from(replaced, "utf-8")
  }
  return content
}

/**
 * Serve a static dashboard file given a relative path within DASHBOARD_DIR.
 */
async function serveDashboardFile(
  relativePath: string,
  pathname: string,
  deps: RouteContext["deps"],
): Promise<Response> {
  // Prevent path traversal
  if (relativePath.includes("..")) {
    return jsonError("FORBIDDEN", "Forbidden", 403, CORS_HEADERS)
  }

  // Dev mode: re-read every request so live edits show up.
  if (deps.config.dev) {
    const filePath = join(DASHBOARD_DIR, relativePath)
    if (!existsSync(filePath)) {
      return jsonError("NOT_FOUND", "Not found", 404, CORS_HEADERS)
    }
    try {
      const raw = readFileSync(filePath)
      const content = applyTemplating(relativePath, raw, deps.pilotVersion)
      const mime = MIME[extname(filePath)] ?? "text/plain"
      return new Response(new Uint8Array(content), {
        headers: {
          "Content-Type": mime,
          ...DASHBOARD_CACHE_HEADERS,
          ...CORS_HEADERS,
        },
      })
    } catch {
      deps.audit.log("error", { path: pathname, error: "Failed to read file" })
      return jsonError("INTERNAL_ERROR", "Failed to read file", 500, CORS_HEADERS)
    }
  }

  // Production: serve from the in-memory snapshot.
  ensureAssetsLoaded()
  const asset = assetCache.get(relativePath)
  if (!asset) {
    return jsonError("NOT_FOUND", "Not found", 404, CORS_HEADERS)
  }
  const content = applyTemplating(relativePath, asset.content, deps.pilotVersion)
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": asset.mime,
      ...DASHBOARD_CACHE_HEADERS,
      ...CORS_HEADERS,
    },
  })
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export async function serveDashboard({ deps }: RouteContext): Promise<Response> {
  const html = Buffer.from(getDashboardHtml(deps.config.dev), "utf-8")
  const content = applyTemplating("index.html", html, deps.pilotVersion)
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...DASHBOARD_CACHE_HEADERS,
      ...CORS_HEADERS,
    },
  })
}

/**
 * Serve static files from the dashboard/ directory.
 * Path: /dashboard/<file>  →  src/dashboard/<file>
 * This handler is registered for GET /dashboard/*.
 */
export async function serveDashboardStatic({
  url,
  deps,
}: RouteContext): Promise<Response> {
  const relativePath = url.pathname.replace(/^\/dashboard\//, "")
  return serveDashboardFile(relativePath, url.pathname, deps)
}

/**
 * Serve dashboard static files from the root path.
 * Path: /<file>  →  src/dashboard/<file>
 * This allows relative imports from index.html to resolve correctly
 * (e.g. ./styles.css, ./main.js, ./sw.js, ./manifest.json, ./icons/*).
 */
export async function serveDashboardRootStatic({
  url,
  deps,
}: RouteContext): Promise<Response> {
  const relativePath = url.pathname.replace(/^\//, "")
  return serveDashboardFile(relativePath, url.pathname, deps)
}
