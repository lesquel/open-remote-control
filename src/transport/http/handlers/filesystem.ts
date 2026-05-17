import { readFileSync, statSync, realpathSync } from "fs"
import { join } from "path"
import { isAbsolute } from "path"
import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { extractDirectory } from "./system"
import { MSG } from "../../../core/strings"

// ─── File browser ────────────────────────────────────────────────────────────

const GLOB_DEFAULT_LIMIT = 1000
const GLOB_MAX_LIMIT = 5000

function parseLimit(raw: string | null, def: number, max: number): number {
  if (!raw) return def
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(n, max)
}

/** Resolve an absolute path and ensure it resides under one of the allowed roots. */
function resolveSafePath(
  raw: string,
  allowedRoots: string[],
): { ok: true; resolved: string } | { ok: false; error: string } {
  if (!isAbsolute(raw)) return { ok: false, error: "path must be absolute" }

  let resolved: string
  try {
    resolved = realpathSync(raw)
  } catch {
    return { ok: false, error: "path not found" }
  }

  for (const root of allowedRoots) {
    if (!root) continue
    let realRoot: string
    try {
      realRoot = realpathSync(root)
    } catch {
      continue
    }
    if (resolved === realRoot || resolved.startsWith(realRoot + "/")) {
      return { ok: true, resolved }
    }
  }
  return { ok: false, error: "path is outside allowed roots" }
}

export async function listFileTree({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)

  const path = url.searchParams.get("path")
  if (!path) return jsonError("MISSING_PATH", "path is required", 400, CORS_HEADERS)

  // Block directory traversal in path param
  if (path.includes(".."))
    return jsonError("FORBIDDEN", "Path traversal not allowed", 403, CORS_HEADERS)

  try {
    const result = await deps.client.file.list({
      query: { path, ...dirParam },
    })
    return json(result.data ?? [], 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: file.list", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function readFileContent({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)

  const path = url.searchParams.get("path")
  if (!path) return jsonError("MISSING_PATH", "path is required", 400, CORS_HEADERS)

  // Block directory traversal
  if (path.includes(".."))
    return jsonError("FORBIDDEN", "Path traversal not allowed", 403, CORS_HEADERS)

  try {
    const result = await deps.client.file.read({
      query: { path, ...dirParam },
    })
    return json(result.data ?? null, result.data ? 200 : 404, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: file.read", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function globFiles({ url, deps }: RouteContext): Promise<Response> {
  if (!deps.config.enableGlobOpener) {
    return jsonError(
      "GLOB_DISABLED",
      MSG.GLOB_DISABLED,
      403,
      CORS_HEADERS,
    )
  }

  const pattern = url.searchParams.get("pattern")
  if (!pattern) return jsonError("MISSING_PATTERN", "pattern is required", 400, CORS_HEADERS)

  const cwdParam = url.searchParams.get("cwd")
  const cwd = cwdParam && cwdParam.length > 0 ? cwdParam : deps.directory
  const limit = parseLimit(url.searchParams.get("limit"), GLOB_DEFAULT_LIMIT, GLOB_MAX_LIMIT)

  const allowedRoots = [deps.directory, deps.worktree].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  )
  const cwdSafe = resolveSafePath(cwd, allowedRoots)
  if (!cwdSafe.ok) {
    return jsonError("FORBIDDEN", `cwd rejected: ${cwdSafe.error}`, 403, CORS_HEADERS)
  }

  try {
    const glob = new Bun.Glob(pattern)
    const results: Array<{ path: string; absolute: string; mtime: number; size: number }> = []
    for await (const rel of glob.scan({ cwd: cwdSafe.resolved, onlyFiles: true })) {
      const abs = join(cwdSafe.resolved, rel)
      let mtime = 0
      let size = 0
      try {
        const st = statSync(abs)
        mtime = st.mtimeMs
        size = st.size
      } catch {}
      results.push({ path: rel, absolute: abs, mtime, size })
      if (results.length >= limit) break
    }
    results.sort((a, b) => b.mtime - a.mtime)
    deps.audit.log("glob.search", {
      pattern,
      cwd: cwdSafe.resolved,
      count: results.length,
    })
    return json(
      { pattern, cwd: cwdSafe.resolved, count: results.length, files: results },
      200,
      CORS_HEADERS,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("glob scan failed", { error: message })
    return jsonError("GLOB_ERROR", "Glob scan failed", 500, CORS_HEADERS)
  }
}

const READ_MAX_BYTES = 2 * 1024 * 1024

export async function readFileAbs({ url, deps }: RouteContext): Promise<Response> {
  if (!deps.config.enableGlobOpener) {
    return jsonError(
      "GLOB_DISABLED",
      MSG.GLOB_DISABLED,
      403,
      CORS_HEADERS,
    )
  }

  const path = url.searchParams.get("path")
  if (!path) return jsonError("MISSING_PATH", "path is required", 400, CORS_HEADERS)

  const allowedRoots = [deps.directory, deps.worktree].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  )
  const safe = resolveSafePath(path, allowedRoots)
  if (!safe.ok) {
    return jsonError("FORBIDDEN", `path rejected: ${safe.error}`, 403, CORS_HEADERS)
  }

  try {
    const st = statSync(safe.resolved)
    if (!st.isFile()) {
      return jsonError("NOT_A_FILE", "path is not a file", 400, CORS_HEADERS)
    }
    if (st.size > READ_MAX_BYTES) {
      return jsonError("FILE_TOO_LARGE", "File exceeds 2 MB limit", 413, CORS_HEADERS)
    }
    const content = readFileSync(safe.resolved, "utf-8")
    deps.audit.log("fs.read", { path: safe.resolved })
    return json({ path: safe.resolved, content, size: st.size }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("fs read failed", { error: message, path: safe.resolved })
    return jsonError("READ_ERROR", "Failed to read file", 500, CORS_HEADERS)
  }
}
