import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { Config } from "../../../server/config"
import type { AuditLog } from "../../../core/audit/log"
import { createEventBus } from "../../../core/events/bus"
import { createPermissionQueue } from "../../../core/permissions/queue"
import { createTelegramChannel } from "../../../notifications/pipeline"
import { createPushService } from "../../../notifications/pipeline"
import type { Logger } from "../../../infra/logger/index"
import type { RouteDeps } from "../routes"
import { createRemoteServer, type RemoteServer } from "../server"

// ─── Helpers ─────────────────────────────────────────────────────────────

const TOKEN = "test-token-64-hex-chars-goes-here-xxxxxxxxxxxxxxxxxxxxxxxxx"

/**
 * Find a free port by asking the OS for port 0, reading the assigned port,
 * then stopping the probe server immediately. The caller then starts the
 * real server on that port. Small race window exists but is acceptable
 * for a loopback-only test.
 */
function findFreePort(): number {
  const probe = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("probe"),
  })
  const port = probe.port
  probe.stop(true)
  if (typeof port !== "number") {
    throw new Error("failed to allocate a free port for the test server")
  }
  return port
}

/** No-op audit log — satisfies the AuditLog contract without side effects. */
function createNoopAudit(): AuditLog {
  return { log: () => {} }
}

/** No-op logger — satisfies the Logger contract without side effects. */
function createNoopLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

/**
 * Minimal OpenCode client mock. Only implements the endpoints the tests
 * actually hit. Everything else throws so regressions are obvious.
 *
 * Handlers that accept a `query.directory` param receive it transparently —
 * the mock stores the last call args so tests can inspect forwarding.
 */
export let lastListSessionsArgs: unknown = undefined
export let lastListAgentsArgs: unknown = undefined

export let lastFileListArgs: unknown = undefined
export let lastFileReadArgs: unknown = undefined

function createClientMock(): PluginInput["client"] {
  const ok = <T>(data: T) => ({ data, error: null })

  const mock = {
    session: {
      list: async (args?: unknown) => {
        lastListSessionsArgs = args
        return ok([])
      },
      status: async () => ok({}),
      create: async () => ok({ id: "sess-new", title: "new" }),
      get: async (args: { path: { id: string } }) =>
        args.path.id === "missing"
          ? { data: null, error: { code: "NOT_FOUND" } }
          : ok({ id: args.path.id, title: "mock" }),
      messages: async () => ok([]),
      diff: async () => ok([]),
      children: async () => ok([]),
      prompt: async () => ok({ ok: true }),
      abort: async () => ok({ ok: true }),
    },
    tool: {
      ids: async () => ok([]),
    },
    app: {
      log: async () => ok({ ok: true }),
      agents: async (args?: unknown) => {
        lastListAgentsArgs = args
        return ok([])
      },
    },
    tui: {
      showToast: async () => ok({ ok: true }),
    },
    provider: {
      list: async () => ok({ all: [], default: {}, connected: [] }),
    },
    mcp: {
      status: async () => ok({}),
    },
    project: {
      list: async () => ok([]),
      current: async () =>
        ok({
          id: "proj-1",
          name: "test-project",
          path: "/tmp/test",
          createdAt: 0,
        }),
    },
    lsp: {
      status: async () => ok([]),
    },
    file: {
      list: async (args?: unknown) => {
        lastFileListArgs = args
        return ok([
          { name: "README.md", path: "README.md", absolute: "/tmp/test/README.md", type: "file", ignored: false },
        ])
      },
      read: async (args?: unknown) => {
        lastFileReadArgs = args
        return ok({ type: "text", content: "# Hello" })
      },
      status: async () => ok([]),
    },
  }

  return mock as unknown as PluginInput["client"]
}

function buildDeps(port: number): RouteDeps {
  const config: Config = {
    port,
    host: "127.0.0.1",
    permissionTimeoutMs: 5_000,
    tunnel: "off",
    telegram: null,
    dev: false,
    vapid: null,
    enableGlobOpener: false,
    fetchTimeoutMs: 10_000,
    projectStateMode: "auto",
    codexPermissionTimeoutMs: 300_000,
  }

  const eventBus = createEventBus()
  const permissionQueue = createPermissionQueue(config.permissionTimeoutMs)
  const codexPermissionQueue = createPermissionQueue(config.codexPermissionTimeoutMs)
  const telegram = createTelegramChannel(null, permissionQueue, codexPermissionQueue)
  const audit = createNoopAudit()
  const logger = createNoopLogger()
  const push = createPushService({ config, audit, logger })
  const settingsStore = {
    load: () => ({}),
    save: () => ({}),
    reset: () => {},
    filePath: () => "/tmp/pilot-test-config.json",
  }

  const deps: RouteDeps = {
    client: createClientMock(),
    project: { worktree: "/tmp/test" } as unknown as PluginInput["project"],
    directory: "/tmp/test",
    worktree: "/tmp/test" as unknown as PluginInput["worktree"],
    config,
    token: TOKEN,
    rotateToken(newToken: string) {
      deps.token = newToken
    },
    tunnelUrl: null,
    audit,
    eventBus,
    permissionQueue,
    codexPermissionQueue,
    telegram,
    push,
    logger,
    settingsStore,
    shellEnv: {},
    envFileApplied: [],
  }
  return deps
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("HTTP server integration", () => {
  let server: RemoteServer
  let baseUrl: string

  beforeAll(() => {
    const port = findFreePort()
    const deps = buildDeps(port)
    server = createRemoteServer(deps)
    server.start()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    server.stop()
  })

  test("GET /status without token returns 401", async () => {
    const res = await fetch(`${baseUrl}/status`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  test("GET /status with token returns 200", async () => {
    const res = await fetch(`${baseUrl}/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty("pilot")
    expect(body).toHaveProperty("sessions")
    expect(body).toHaveProperty("clients")
  })

  test("GET /sessions returns sessions array", async () => {
    const res = await fetch(`${baseUrl}/sessions`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessions: unknown[]; statuses: unknown }
    expect(Array.isArray(body.sessions)).toBe(true)
  })

  test("GET /tools returns array", async () => {
    const res = await fetch(`${baseUrl}/tools`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown
    expect(Array.isArray(body)).toBe(true)
  })

  test("POST /permissions/:id with invalid action returns 400", async () => {
    const res = await fetch(`${baseUrl}/permissions/does-not-exist`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "invalid" }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("INVALID_ACTION")
  })

  test("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/this/does/not/exist`)
    expect(res.status).toBe(404)
  })

  test("GET /events without token returns 401", async () => {
    const res = await fetch(`${baseUrl}/events`)
    expect(res.status).toBe(401)
  })

  test("GET /events with token streams SSE", async () => {
    const controller = new AbortController()
    const res = await fetch(`${baseUrl}/events?token=${TOKEN}`, {
      signal: controller.signal,
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")

    // Read one chunk so we know the stream actually emits something
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()

    const { value, done } = await reader!.read()
    expect(done).toBe(false)
    const chunk = new TextDecoder().decode(value)
    // Server sends a `data: {...pilot.connected...}` on connect
    expect(chunk.startsWith("data:") || chunk.startsWith(":")).toBe(true)

    controller.abort()
    try {
      await reader!.cancel()
    } catch {
      // abort/cancel can throw; ignore
    }
  })

  test("GET / returns HTML dashboard", async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
    const body = await res.text()
    expect(body.length).toBeGreaterThan(0)
  })

  test("GET /sw.js substitutes CACHE_NAME placeholder with versioned value (1.13.15)", async () => {
    // Regression: before 1.13.15, sw.js shipped a hardcoded `pilot-v21`
    // that drifted release-over-release and left browsers holding stale
    // cached dashboard assets (a contributor to the "token inválido"
    // symptom family). `serveDashboardFile` now runs `applyTemplating`
    // which replaces `__PILOT_CACHE_VERSION__` with `pilot-v<version>`.
    // This test confirms the end-to-end serve path does the substitution.
    const res = await fetch(`${baseUrl}/sw.js`)
    expect(res.status).toBe(200)
    const body = await res.text()
    // Placeholder must be fully expanded — zero instances left in output.
    expect(body).not.toContain("__PILOT_CACHE_VERSION__")
    // Expansion must produce the version-scoped cache key.
    expect(body).toMatch(/const\s+CACHE_NAME\s*=\s*"pilot-v\d+\.\d+\.\d+"/)
  })

  test("OPTIONS / preflight returns CORS headers", async () => {
    const res = await fetch(`${baseUrl}/`, { method: "OPTIONS" })
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("access-control-allow-methods")).toContain("GET")
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization")
  })

  // ─── R5: /health endpoint ─────────────────────────────────────────────

  test("GET /health returns 200 without auth", async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      uptimeMs: number
      version: string
      services: { tunnel: string; telegram: string; sdk: string }
    }
    expect(body.status === "ok" || body.status === "degraded").toBe(true)
    expect(typeof body.uptimeMs).toBe("number")
    expect(typeof body.version).toBe("string")
    expect(body.services).toBeDefined()
    expect(["up", "down", "disabled"]).toContain(body.services.tunnel)
    expect(["up", "down", "disabled"]).toContain(body.services.telegram)
    expect(["up", "down"]).toContain(body.services.sdk)
  })

  test("GET /health reports tunnel=disabled when tunnel=off", async () => {
    const res = await fetch(`${baseUrl}/health`)
    const body = (await res.json()) as { services: { tunnel: string } }
    // config.tunnel is "off" in buildDeps
    expect(body.services.tunnel).toBe("disabled")
  })

  test("GET /health reports telegram=disabled when no telegram config", async () => {
    const res = await fetch(`${baseUrl}/health`)
    const body = (await res.json()) as { services: { telegram: string } }
    // config.telegram is null in buildDeps
    expect(body.services.telegram).toBe("disabled")
  })

  // ─── SDK proxy endpoints ──────────────────────────────────────────────────

  test("GET /agents without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/agents`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  test("GET /agents with auth returns 200 with agents array", async () => {
    const res = await fetch(`${baseUrl}/agents`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { agents: unknown[] }
    expect(body).toHaveProperty("agents")
    expect(Array.isArray(body.agents)).toBe(true)
  })

  test("GET /providers without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/providers`)
    expect(res.status).toBe(401)
  })

  test("GET /providers with auth returns 200", async () => {
    const res = await fetch(`${baseUrl}/providers`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty("all")
    expect(body).toHaveProperty("connected")
  })

  test("GET /mcp/status without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp/status`)
    expect(res.status).toBe(401)
  })

  test("GET /mcp/status with auth returns 200 with servers object", async () => {
    const res = await fetch(`${baseUrl}/mcp/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { servers: Record<string, unknown> }
    expect(body).toHaveProperty("servers")
    expect(typeof body.servers).toBe("object")
  })

  test("GET /projects without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/projects`)
    expect(res.status).toBe(401)
  })

  test("GET /projects with auth returns 200 with projects array", async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { projects: unknown[] }
    expect(body).toHaveProperty("projects")
    expect(Array.isArray(body.projects)).toBe(true)
  })

  test("GET /project/current without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/project/current`)
    expect(res.status).toBe(401)
  })

  test("GET /project/current with auth returns 200 with project object", async () => {
    const res = await fetch(`${baseUrl}/project/current`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { project: Record<string, unknown> | null }
    expect(body).toHaveProperty("project")
    expect(body.project).not.toBeNull()
  })

  // ─── Deliverable 1: GET /lsp/status ──────────────────────────────────────

  test("GET /lsp/status without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/lsp/status`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  test("GET /lsp/status with auth returns 200 with clients array", async () => {
    const res = await fetch(`${baseUrl}/lsp/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { clients: unknown[] }
    expect(body).toHaveProperty("clients")
    expect(Array.isArray(body.clients)).toBe(true)
  })

  // ─── Deliverable 2: directory param forwarding ───────────────────────────

  test("GET /sessions?directory=/test/path forwards directory to SDK", async () => {
    lastListSessionsArgs = undefined
    const res = await fetch(`${baseUrl}/sessions?directory=/test/path`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const args = lastListSessionsArgs as { query?: { directory?: string } } | undefined
    expect(args?.query?.directory).toBe("/test/path")
  })

  test("GET /sessions without directory param does not forward directory", async () => {
    lastListSessionsArgs = undefined
    const res = await fetch(`${baseUrl}/sessions`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const args = lastListSessionsArgs as { query?: { directory?: string } } | undefined
    expect(args?.query?.directory).toBeUndefined()
  })

  test("GET /sessions?directory=../etc returns 400 for path traversal", async () => {
    const res = await fetch(`${baseUrl}/sessions?directory=../etc`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("INVALID_DIRECTORY")
  })

  test("GET /sessions with overlong directory returns 400", async () => {
    const longDir = "/".padEnd(513, "a")
    const res = await fetch(`${baseUrl}/sessions?directory=${encodeURIComponent(longDir)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("INVALID_DIRECTORY")
  })

  test("GET /agents?directory=/other/project forwards directory to SDK", async () => {
    lastListAgentsArgs = undefined
    const res = await fetch(`${baseUrl}/agents?directory=/other/project`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const args = lastListAgentsArgs as { query?: { directory?: string } } | undefined
    expect(args?.query?.directory).toBe("/other/project")
  })

  // ─── File browser endpoints ───────────────────────────────────────────────

  test("GET /file/list without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/file/list?path=.`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  test("GET /file/list with auth and path returns 200 with file array", async () => {
    lastFileListArgs = undefined
    const res = await fetch(`${baseUrl}/file/list?path=.`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ name: string; type: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toHaveProperty("name")
    expect(body[0]).toHaveProperty("type")
  })

  test("GET /file/list without path returns 400", async () => {
    const res = await fetch(`${baseUrl}/file/list`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("MISSING_PATH")
  })

  test("GET /file/list with directory traversal in path returns 403", async () => {
    const res = await fetch(`${baseUrl}/file/list?path=../../etc/passwd`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })

  test("GET /file/content with auth and path returns file content", async () => {
    lastFileReadArgs = undefined
    const res = await fetch(`${baseUrl}/file/content?path=/tmp/test/README.md`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { type: string; content: string }
    expect(body).toHaveProperty("type")
    expect(body).toHaveProperty("content")
    expect(body.type).toBe("text")
  })

  test("GET /file/content without auth returns 401", async () => {
    const res = await fetch(`${baseUrl}/file/content?path=/tmp/test/README.md`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  test("GET /file/content with directory traversal returns 403", async () => {
    const res = await fetch(`${baseUrl}/file/content?path=../../../etc/passwd`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })
})

// ─── Route isolation: Codex routes must NOT be in the central static table ───
// Codex now self-registers via codexIntegration.setup({ registerRoute }) —
// the central matchRoute should NOT find codex paths (regression guard).
import { matchRoute } from "../routes"

describe("Route isolation — Codex must not be in central routes table", () => {
  test("POST /codex/hooks/SessionStart is NOT in the central static routes table", () => {
    const match = matchRoute("POST", "/codex/hooks/SessionStart")
    expect(match).toBeNull()
  })

  test("GET /codex/hooks/SessionStart does NOT match (wrong method)", () => {
    const match = matchRoute("GET", "/codex/hooks/SessionStart")
    expect(match).toBeNull()
  })
})
