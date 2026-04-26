// opencode-pilot Codex Plugin — MCP Server
// Thin proxy to the already-running opencode-pilot HTTP server.
// Tools: pilot.status, pilot.open_dashboard, pilot.configure_hooks

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { join } from "node:path"
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs"
import * as os from "node:os"

// ─── Constants ────────────────────────────────────────────────────────────────

const PILOT_DEFAULT_URL = "http://localhost:4097"
const PLUGIN_VERSION = "1.18.1"
const FETCH_TIMEOUT_MS = 5000
const MARKER_COMMENT = "# Added by opencode-pilot Codex Plugin v" + PLUGIN_VERSION + " — do not edit manually."
const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop"]

// ─── Token / connection resolution ────────────────────────────────────────────

function getStateFilePath() {
  // test-only override
  if (process.env.PILOT_STATE_FILE) return process.env.PILOT_STATE_FILE
  const xdg = process.env.XDG_STATE_HOME
  const dir = xdg ? join(xdg, "opencode-pilot") : join(os.homedir(), ".opencode-pilot")
  return join(dir, "pilot-state.json")
}

function resolveConnection() {
  // 1. State file (preferred — auto-discovery from running pilot)
  const stateFilePath = getStateFilePath()
  if (existsSync(stateFilePath)) {
    try {
      const state = JSON.parse(readFileSync(stateFilePath, "utf8"))
      if (state.token && state.host && state.port) {
        // Browsers + MCP can't reliably hit 0.0.0.0; use 127.0.0.1 instead
        const host = state.host === "0.0.0.0" ? "127.0.0.1" : state.host
        return {
          url: `http://${host}:${state.port}`,
          token: state.token,
          source: "state-file",
        }
      }
    } catch {
      // fall through to env vars
    }
  }

  // 2. Env vars (power-user override)
  if (process.env.PILOT_URL && process.env.PILOT_TOKEN) {
    return {
      url: process.env.PILOT_URL,
      token: process.env.PILOT_TOKEN,
      source: "env",
    }
  }

  // 3. Default URL, no token (will fail with AUTH_FAILED on any authed endpoint)
  return { url: PILOT_DEFAULT_URL, token: undefined, source: "default" }
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

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
    try {
      data = await res.json()
    } catch {
      data = null
    }
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

// ─── Tool implementations ─────────────────────────────────────────────────────

async function pilotStatus() {
  const conn = resolveConnection()
  const { url, token, source } = conn

  // GET /health (no auth required)
  const healthRes = await pilotFetch(url, null, "/health")

  if (!healthRes.ok) {
    if (healthRes.timeout) {
      return {
        running: false,
        error: {
          code: "NOT_RUNNING",
          message: `opencode-pilot is not reachable at ${url} (connection timed out)`,
          hint: createOSStartHint(),
        },
      }
    }
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
  const features = {
    tunnel: health.tunnel ?? false,
    telegram: health.telegram ?? false,
    push: health.push ?? false,
  }

  // If no token available, skip the auth probe
  if (!token || source === "default") {
    return {
      running: true,
      url,
      version,
      source,
      token_valid: null,
      features,
    }
  }

  // Probe /connect-info to validate the token
  const connectRes = await pilotFetch(url, token, "/connect-info")

  if (!connectRes.ok) {
    if (connectRes.timeout) {
      return {
        running: true,
        url,
        version,
        source,
        token_valid: null,
        features,
        error: {
          code: "PROBE_TIMEOUT",
          message: "Pilot is running but token validation timed out",
          hint: "Retry pilot.status; if persistent, check pilot logs for slow handlers",
        },
      }
    }
    if (connectRes.status === 401) {
      return {
        running: true,
        error: {
          code: "AUTH_FAILED",
          message: "Pilot is running but rejected the auth token",
          hint: "Set PILOT_TOKEN env var to the value in ~/.opencode-pilot/pilot-banner.txt, or restart opencode-pilot to refresh state file",
        },
      }
    }
    // Other error on connect-info — pilot may be unhealthy
    return {
      running: true,
      url,
      version,
      source,
      token_valid: null,
      features,
    }
  }

  return {
    running: true,
    url,
    version,
    source,
    token_valid: true,
    features,
  }
}

async function pilotOpenDashboard() {
  const conn = resolveConnection()
  const { url, token } = conn

  const connectRes = await pilotFetch(url, token, "/connect-info")

  if (!connectRes.ok) {
    if (connectRes.timeout) {
      return {
        running: false,
        error: {
          code: "NOT_RUNNING",
          message: `opencode-pilot is not reachable at ${url} (connection timed out)`,
          hint: createOSStartHint(),
        },
      }
    }
    if (connectRes.status === 401) {
      return {
        running: true,
        error: {
          code: "AUTH_FAILED",
          message: "Pilot is running but rejected the auth token",
          hint: "Set PILOT_TOKEN env var to the value in ~/.opencode-pilot/pilot-banner.txt, or restart opencode-pilot to refresh state file",
        },
      }
    }
    return {
      running: false,
      error: {
        code: "NOT_RUNNING",
        message: `opencode-pilot is not reachable at ${url}`,
        hint: createOSStartHint(),
      },
    }
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

async function pilotConfigureHooks({ scope = "project", confirm = false } = {}) {
  const conn = resolveConnection()
  const { url, token } = conn

  // Determine config file path
  const targetPath = scope === "global"
    ? join(os.homedir(), ".codex", "config.toml")
    : join(process.cwd(), ".codex", "config.toml")

  const targetExists = existsSync(targetPath)

  // Check idempotency — look for our marker comment
  let alreadyConfigured = false
  if (targetExists) {
    try {
      const existing = readFileSync(targetPath, "utf8")
      const hasMarker = existing.includes(MARKER_COMMENT)
      const hookCount = (existing.match(/\[\[hooks\.\w+\.hooks\]\]/g) ?? []).length
      alreadyConfigured = hasMarker && hookCount >= HOOK_EVENTS.length
    } catch {
      // fall through
    }
  }

  // Build the TOML snippet — we need a token for this
  if (!token && confirm) {
    return {
      running: false,
      error: {
        code: "PILOT_NOT_RUNNING",
        message: "Cannot configure hooks: opencode-pilot token is not available",
        hint: createOSStartHint(),
      },
    }
  }

  // Use the URL from resolveConnection, but substitute 0.0.0.0 → 127.0.0.1
  // (already done in resolveConnection, but default URL is already 127.0.0.1)
  const hookUrl = url

  // Generate TOML snippet
  const tomlSnippet = generateHooksToml(hookUrl, token ?? "<TOKEN>")

  // Dry-run path
  if (!confirm) {
    let diffPreview = ""
    if (alreadyConfigured) {
      diffPreview = "No changes — hooks already configured with our marker."
    } else if (targetExists) {
      diffPreview = `The following [hooks] block will be APPENDED to ${targetPath}:\n\n${tomlSnippet}`
    } else {
      diffPreview = `A new file will be created at ${targetPath} with:\n\n${tomlSnippet}`
    }

    return {
      would_write: !alreadyConfigured,
      target_path: targetPath,
      target_exists: targetExists,
      already_configured: alreadyConfigured,
      toml_snippet: tomlSnippet,
      diff_preview: diffPreview,
      next_step: "Call this tool again with { confirm: true, scope: \"" + scope + "\" } to write the config.",
    }
  }

  // Confirm path
  if (alreadyConfigured) {
    return {
      written: false,
      reason: "already_configured",
      target_path: targetPath,
      next_step: "No changes needed.",
    }
  }

  // Ensure parent directory exists
  const targetDir = join(targetPath, "..")
  try {
    mkdirSync(targetDir, { recursive: true })
  } catch (err) {
    return {
      written: false,
      error: {
        code: "PERMISSION_DENIED",
        message: `Cannot write to ${targetDir}: ${err.message}`,
        hint: "Check directory permissions and try again.",
      },
    }
  }

  // Backup existing file
  let backupPath = null
  if (targetExists) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    backupPath = `${targetPath}.bak.${ts}`
    try {
      copyFileSync(targetPath, backupPath)
    } catch (err) {
      return {
        written: false,
        error: {
          code: "PERMISSION_DENIED",
          message: `Cannot create backup at ${backupPath}: ${err.message}`,
          hint: "Check file permissions and try again.",
        },
      }
    }
  }

  // Write the config — append hooks block if file exists, create new if not
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
    const code = err.code === "EACCES" ? "PERMISSION_DENIED" : "WRITE_ERROR"
    return {
      written: false,
      error: {
        code,
        message: `Cannot write to ${targetPath}: ${err.message}`,
        hint: "Check file permissions and try again.",
      },
    }
  }

  return {
    written: true,
    target_path: targetPath,
    backup_path: backupPath,
    next_step: "Codex hooks configured. Restart codex for the hooks to load, then start a new session.",
  }
}

function generateHooksToml(url, token) {
  const events = HOOK_EVENTS
  const lines = [
    MARKER_COMMENT,
    "# Re-run `pilot.configure_hooks` to update.",
    "[hooks]",
  ]

  for (const event of events) {
    lines.push(`  [[hooks.${event}]]`)
    lines.push(`    [[hooks.${event}.hooks]]`)
    lines.push(`      type = "command"`)
    lines.push(`      command = "curl -fsS -X POST ${url}/codex/hooks/${event} -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d @-"`)
    lines.push("")
  }

  return lines.join("\n")
}

// ─── MCP Server setup ─────────────────────────────────────────────────────────

const server = new Server(
  { name: "opencode-pilot", version: PLUGIN_VERSION },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "pilot.status",
        description: "Check opencode-pilot health, validate auth token, and discover connection URL. Run this first before any other tool.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "pilot.open_dashboard",
        description: "Get the URL to open the opencode-pilot web dashboard. Returns primary URL (tunnel > LAN > localhost), alternatives, and optional ASCII QR code.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "pilot.configure_hooks",
        description: "Write the [hooks] block to codex config.toml, connecting codex lifecycle hooks to the pilot bridge. Dry-run by default — set confirm:true to write. Always creates a timestamped backup before writing.",
        inputSchema: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              enum: ["project", "global"],
              description: "Where to write the config. 'project' = <cwd>/.codex/config.toml (default). 'global' = ~/.codex/config.toml.",
            },
            confirm: {
              type: "boolean",
              description: "If false (default), returns a dry-run preview. If true, writes the config file.",
            },
          },
          required: [],
        },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  let result

  try {
    switch (name) {
      case "pilot.status":
        result = await pilotStatus()
        break
      case "pilot.open_dashboard":
        result = await pilotOpenDashboard()
        break
      case "pilot.configure_hooks":
        result = await pilotConfigureHooks(args ?? {})
        break
      default:
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        }
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      isError: true,
    }
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
