// mcp-server.test.mjs — bun test suite for the opencode-pilot MCP server tools
// Uses a mock Bun HTTP server on a random port to simulate the pilot HTTP server.
// Uses PILOT_STATE_FILE env override to isolate state file reads.

import { describe, test, expect, afterEach, beforeEach } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Start a mock pilot server. Returns { server, port, stop }. */
function startMockPilot(handlers = {}) {
  const server = Bun.serve({
    port: 0, // random available port
    fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname
      const authHeader = req.headers.get("authorization") ?? ""
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null

      if (path === "/health") {
        const handler = handlers["/health"]
        if (handler) return handler(req, token)
        return Response.json({ status: "ok", version: "1.18.1", tunnel: false, telegram: false, push: false })
      }

      if (path === "/connect-info") {
        const handler = handlers["/connect-info"]
        if (handler) return handler(req, token)
        return Response.json({
          localUrl: `http://127.0.0.1:${server.port}`,
          lanUrl: "http://192.168.1.100:4097",
          tunnelUrl: null,
          qrAscii: null,
        })
      }

      return new Response("Not found", { status: 404 })
    },
  })

  return {
    server,
    port: server.port,
    stop: () => server.stop(true),
  }
}

/** Resolve connection purely (sync version using explicit state file path). */
function resolveConnectionFromStateFile(stateFilePath, fallbackEnv = {}) {
  const PILOT_DEFAULT_URL = "http://localhost:4097"

  if (stateFilePath && existsSync(stateFilePath)) {
    try {
      const state = JSON.parse(readFileSync(stateFilePath, "utf8"))
      if (state.token && state.host && state.port) {
        const host = state.host === "0.0.0.0" ? "127.0.0.1" : state.host
        return { url: `http://${host}:${state.port}`, token: state.token, source: "state-file" }
      }
    } catch {}
  }

  if (fallbackEnv.PILOT_URL && fallbackEnv.PILOT_TOKEN) {
    return { url: fallbackEnv.PILOT_URL, token: fallbackEnv.PILOT_TOKEN, source: "env" }
  }

  return { url: PILOT_DEFAULT_URL, token: undefined, source: "default" }
}

/** The tools logic, extracted for testing without spawning the MCP server. */
const FETCH_TIMEOUT_MS = 5000
const PLUGIN_VERSION = "1.18.1"
const MARKER_COMMENT = `# Added by opencode-pilot Codex Plugin v${PLUGIN_VERSION} — do not edit manually.`
const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop"]

async function pilotFetch(baseUrl, token, path, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const headers = { "Content-Type": "application/json" }
    if (token) headers["Authorization"] = `Bearer ${token}`
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers ?? {}) },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` }
    }
    let data = null
    try { data = await res.json() } catch {}
    return { ok: true, data }
  } catch (err) {
    clearTimeout(timer)
    const isTimeout = err.name === "AbortError"
    return { ok: false, error: isTimeout ? "TIMEOUT" : err.message, timeout: isTimeout }
  }
}

function createOSStartHint() {
  return "Start it: opencode (in a separate terminal). The pilot auto-starts when opencode loads it as a plugin."
}

function generateHooksToml(url, token) {
  const lines = [
    MARKER_COMMENT,
    "# Re-run `pilot.configure_hooks` to update.",
    "[hooks]",
  ]
  for (const event of HOOK_EVENTS) {
    lines.push(`  [[hooks.${event}]]`)
    lines.push(`    [[hooks.${event}.hooks]]`)
    lines.push(`      type = "command"`)
    lines.push(`      command = "curl -fsS -X POST ${url}/codex/hooks/${event} -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d @-"`)
    lines.push("")
  }
  return lines.join("\n")
}

async function runPilotStatus(conn) {
  const { url, token, source } = conn

  const healthRes = await pilotFetch(url, null, "/health")
  if (!healthRes.ok) {
    return {
      running: false,
      error: {
        code: "NOT_RUNNING",
        message: `opencode-pilot is not reachable at ${url}`,
        hint: createOSStartHint(),
      },
    }
  }

  const health = healthRes.data ?? {}
  const version = health.version ?? "unknown"
  const features = { tunnel: health.tunnel ?? false, telegram: health.telegram ?? false, push: health.push ?? false }

  if (!token || source === "default") {
    return { running: true, url, version, source, token_valid: null, features }
  }

  const connectRes = await pilotFetch(url, token, "/connect-info")
  if (!connectRes.ok) {
    if (connectRes.status === 401) {
      return {
        running: true,
        error: { code: "AUTH_FAILED", message: "Pilot is running but rejected the auth token", hint: "..." },
      }
    }
    return { running: true, url, version, source, token_valid: null, features }
  }

  return { running: true, url, version, source, token_valid: true, features }
}

async function runPilotOpenDashboard(conn) {
  const { url, token } = conn
  const connectRes = await pilotFetch(url, token, "/connect-info")

  if (!connectRes.ok) {
    if (connectRes.status === 401) {
      return { running: true, error: { code: "AUTH_FAILED", message: "Pilot is running but rejected the auth token", hint: "..." } }
    }
    return { running: false, error: { code: "NOT_RUNNING", message: `opencode-pilot is not reachable at ${url}`, hint: createOSStartHint() } }
  }

  const info = connectRes.data ?? {}
  const tunnelUrl = info.tunnelUrl ?? info.tunnel_url ?? null
  const lanUrl = info.lanUrl ?? info.lan_url ?? null
  const localUrl = info.localUrl ?? info.local_url ?? url
  const qrAscii = info.qrAscii ?? info.qr_ascii ?? null

  const allUrls = [tunnelUrl, lanUrl, localUrl].filter(Boolean)
  const primaryUrl = tunnelUrl ?? lanUrl ?? localUrl
  const alternativeUrls = allUrls.filter(u => u !== primaryUrl)

  return {
    primary_url: primaryUrl,
    alternative_urls: alternativeUrls,
    qr_ascii: qrAscii,
    instructions: "Open this URL in your browser. Authentication is embedded; you'll be in immediately.",
  }
}

async function runPilotConfigureHooks(conn, { scope = "project", confirm = false } = {}, cwd = process.cwd()) {
  const { url, token } = conn
  const targetPath = scope === "global"
    ? join(tmpdir(), ".codex-global-test", "config.toml")
    : join(cwd, ".codex", "config.toml")

  const targetExists = existsSync(targetPath)
  let alreadyConfigured = false
  if (targetExists) {
    try {
      const existing = readFileSync(targetPath, "utf8")
      const hasMarker = existing.includes(MARKER_COMMENT)
      const hookCount = (existing.match(/\[\[hooks\.\w+\.hooks\]\]/g) ?? []).length
      alreadyConfigured = hasMarker && hookCount >= HOOK_EVENTS.length
    } catch {}
  }

  if (!token && confirm) {
    return { running: false, error: { code: "PILOT_NOT_RUNNING", message: "Cannot configure hooks: token not available", hint: createOSStartHint() } }
  }

  const tomlSnippet = generateHooksToml(url, token ?? "<TOKEN>")

  if (!confirm) {
    const diffPreview = alreadyConfigured
      ? "No changes — hooks already configured with our marker."
      : targetExists
        ? `The following [hooks] block will be APPENDED to ${targetPath}:\n\n${tomlSnippet}`
        : `A new file will be created at ${targetPath} with:\n\n${tomlSnippet}`

    return {
      would_write: !alreadyConfigured,
      target_path: targetPath,
      target_exists: targetExists,
      already_configured: alreadyConfigured,
      toml_snippet: tomlSnippet,
      diff_preview: diffPreview,
      next_step: `Call this tool again with { confirm: true, scope: "${scope}" } to write the config.`,
    }
  }

  if (alreadyConfigured) {
    return { written: false, reason: "already_configured", target_path: targetPath, next_step: "No changes needed." }
  }

  const targetDir = join(targetPath, "..")
  try { mkdirSync(targetDir, { recursive: true }) } catch (err) {
    return { written: false, error: { code: "PERMISSION_DENIED", message: `Cannot write to ${targetDir}: ${err.message}`, hint: "Check permissions." } }
  }

  let backupPath = null
  if (targetExists) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    backupPath = `${targetPath}.bak.${ts}`
    try { copyFileSync(targetPath, backupPath) } catch (err) {
      return { written: false, error: { code: "PERMISSION_DENIED", message: `Cannot create backup: ${err.message}`, hint: "Check permissions." } }
    }
  }

  try {
    let content = ""
    if (targetExists) {
      const existing = readFileSync(targetPath, "utf8")
      content = existing.trimEnd() + "\n\n" + tomlSnippet
    } else {
      content = tomlSnippet
    }
    writeFileSync(targetPath, content, "utf8")
  } catch (err) {
    return { written: false, error: { code: "WRITE_ERROR", message: `Cannot write to ${targetPath}: ${err.message}`, hint: "Check permissions." } }
  }

  return { written: true, target_path: targetPath, backup_path: backupPath, next_step: "Codex hooks configured. Restart codex for the hooks to load, then start a new session." }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pilot.status", () => {
  test("1. alive + valid token → running: true, token_valid: true", async () => {
    const VALID_TOKEN = "test-token-abc"
    const mock = startMockPilot({
      "/health": () => Response.json({ status: "ok", version: "1.18.1", tunnel: false, telegram: false, push: false }),
      "/connect-info": (req, token) => {
        if (token !== VALID_TOKEN) return new Response("Unauthorized", { status: 401 })
        return Response.json({ localUrl: `http://127.0.0.1:${mock.port}`, lanUrl: null, tunnelUrl: null, qrAscii: null })
      },
    })

    try {
      const conn = { url: `http://127.0.0.1:${mock.port}`, token: VALID_TOKEN, source: "state-file" }
      const result = await runPilotStatus(conn)

      expect(result.running).toBe(true)
      expect(result.token_valid).toBe(true)
      expect(result.version).toBe("1.18.1")
      expect(result.source).toBe("state-file")
    } finally {
      mock.stop()
    }
  })

  test("2. alive + invalid token → running: true, error: AUTH_FAILED", async () => {
    const mock = startMockPilot({
      "/health": () => Response.json({ status: "ok", version: "1.18.1", tunnel: false, telegram: false, push: false }),
      "/connect-info": () => new Response("Unauthorized", { status: 401 }),
    })

    try {
      const conn = { url: `http://127.0.0.1:${mock.port}`, token: "wrong-token", source: "state-file" }
      const result = await runPilotStatus(conn)

      expect(result.running).toBe(true)
      expect(result.error?.code).toBe("AUTH_FAILED")
    } finally {
      mock.stop()
    }
  })

  test("3. no mock pilot → running: false, error: NOT_RUNNING", async () => {
    // Use a port that nothing is listening on
    const conn = { url: "http://127.0.0.1:19999", token: "test-token", source: "state-file" }
    const result = await runPilotStatus(conn)

    expect(result.running).toBe(false)
    expect(result.error?.code).toBe("NOT_RUNNING")
  })
})

describe("pilot.open_dashboard", () => {
  test("4. alive → primary URL valid, alternative_urls populated", async () => {
    const VALID_TOKEN = "test-token-dash"
    const mock = startMockPilot({
      "/connect-info": (req, token) => {
        if (token !== VALID_TOKEN) return new Response("Unauthorized", { status: 401 })
        return Response.json({
          localUrl: `http://127.0.0.1:${mock.port}`,
          lanUrl: "http://192.168.1.100:4097",
          tunnelUrl: "https://tunnel.example.com",
          qrAscii: null,
        })
      },
    })

    try {
      const conn = { url: `http://127.0.0.1:${mock.port}`, token: VALID_TOKEN, source: "state-file" }
      const result = await runPilotOpenDashboard(conn)

      expect(result.primary_url).toBe("https://tunnel.example.com")
      expect(result.alternative_urls).toContain("http://192.168.1.100:4097")
      expect(result.alternative_urls).toContain(`http://127.0.0.1:${mock.port}`)
      expect(result.instructions).toBeTruthy()
    } finally {
      mock.stop()
    }
  })
})

describe("pilot.configure_hooks", () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pilot-hooks-test-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("5. dry-run → preview returned, file unchanged", async () => {
    const conn = { url: "http://127.0.0.1:4097", token: "test-token", source: "state-file" }
    const result = await runPilotConfigureHooks(conn, { scope: "project", confirm: false }, tmpDir)

    expect(result.would_write).toBe(true)
    expect(result.target_exists).toBe(false)
    expect(result.already_configured).toBe(false)
    expect(result.toml_snippet).toContain("[hooks]")
    expect(result.toml_snippet).toContain("[[hooks.SessionStart.hooks]]")
    expect(result.toml_snippet).toContain('type = "command"')
    // File should NOT exist
    const configPath = join(tmpDir, ".codex", "config.toml")
    expect(existsSync(configPath)).toBe(false)
  })

  test("6. confirm → file written with correct TOML structure, backup created", async () => {
    // Pre-create the file so backup is triggered
    const codexDir = join(tmpDir, ".codex")
    mkdirSync(codexDir, { recursive: true })
    const configPath = join(codexDir, "config.toml")
    writeFileSync(configPath, "# Existing config\n[model]\nname = \"gpt-4\"\n", "utf8")

    const conn = { url: "http://127.0.0.1:4097", token: "my-secret-token", source: "state-file" }
    const result = await runPilotConfigureHooks(conn, { scope: "project", confirm: true }, tmpDir)

    expect(result.written).toBe(true)
    expect(result.target_path).toBe(configPath)
    expect(result.backup_path).toBeTruthy()
    expect(result.backup_path).toContain(".bak.")
    // Backup should exist
    expect(existsSync(result.backup_path)).toBe(true)
    // Written file should contain hooks
    const written = readFileSync(configPath, "utf8")
    // Check all 6 event sections exist
    for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop"]) {
      expect(written).toContain(`[[hooks.${event}.hooks]]`)
    }
    // Check command format
    expect(written).toContain('type = "command"')
    expect(written).toContain("curl -fsS -X POST")
    expect(written).toContain("/codex/hooks/SessionStart")
    expect(written).toContain("my-secret-token")
    // Original content preserved
    expect(written).toContain("# Existing config")
  })
})

describe("token discovery", () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pilot-token-test-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("7a. state file with 0.0.0.0 host → url uses 127.0.0.1", () => {
    const stateFilePath = join(tmpDir, "pilot-state.json")
    writeFileSync(stateFilePath, JSON.stringify({
      token: "state-file-token",
      host: "0.0.0.0",
      port: 4097,
      startedAt: Date.now(),
      pid: 12345,
    }), "utf8")

    const conn = resolveConnectionFromStateFile(stateFilePath)
    expect(conn.source).toBe("state-file")
    expect(conn.url).toBe("http://127.0.0.1:4097")
    expect(conn.token).toBe("state-file-token")
  })

  test("7b. no state file + env vars → uses env", () => {
    const stateFilePath = join(tmpDir, "nonexistent-state.json")
    const conn = resolveConnectionFromStateFile(stateFilePath, {
      PILOT_URL: "http://custom.host:5000",
      PILOT_TOKEN: "env-token",
    })
    expect(conn.source).toBe("env")
    expect(conn.url).toBe("http://custom.host:5000")
    expect(conn.token).toBe("env-token")
  })

  test("7c. no state file + no env vars → default URL, no token", () => {
    const stateFilePath = join(tmpDir, "nonexistent-state.json")
    const conn = resolveConnectionFromStateFile(stateFilePath, {})
    expect(conn.source).toBe("default")
    expect(conn.url).toBe("http://localhost:4097")
    expect(conn.token).toBeUndefined()
  })
})
