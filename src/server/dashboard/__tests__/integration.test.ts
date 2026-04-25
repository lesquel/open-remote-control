// integration.test.ts — End-to-end HTTP integration tests for critical flows.
// Tests run against a real Bun.serve instance with a fake OpenCode SDK client.
// Mirrors the pattern in src/server/http/server.test.ts.

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { Config } from "../../config"
import type { AuditLog } from "../../../core/audit/log"
import { createEventBus } from "../../../core/events/bus"
import { createPermissionQueue } from "../../../core/permissions/queue"
import { createTelegramBot } from "../../../notifications/channels/telegram/index"
import { createPushService } from "../../../notifications/channels/push/service"
import type { Logger } from "../../../infra/logger/index"
import type { RouteDeps } from "../../http/routes"
import { createRemoteServer, type RemoteServer } from "../../http/server"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TOKEN = "integration-test-token-64-hex-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

function findFreePort(): number {
  const probe = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("probe"),
  })
  const port = probe.port
  probe.stop(true)
  if (typeof port !== "number") {
    throw new Error("failed to allocate a free port")
  }
  return port
}

function createNoopAudit(): AuditLog {
  return { log: () => {} }
}

function createNoopLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function createClientMock(): PluginInput["client"] {
  const ok = <T>(data: T) => ({ data, error: null })

  return {
    session: {
      list: async () => ok([]),
      status: async () => ok({}),
      create: async () => ok({ id: "sess-created-1", title: "new session" }),
      get: async (args: { path: { id: string } }) =>
        args.path.id === "missing-session-id"
          ? { data: null, error: { code: "NOT_FOUND", message: "not found" } }
          : ok({ id: args.path.id, title: "mock session" }),
      messages: async () => ok([]),
      diff: async () => ok([]),
      children: async () => ok([]),
      prompt: async () => ok({ ok: true }),
      abort: async () => ok({ ok: true }),
      delete: async (args: { path: { id: string } }) => {
        if (args.path.id === "sess-to-delete") {
          return ok({ ok: true })
        }
        return { data: null, error: { code: "NOT_FOUND", message: "not found" } }
      },
      update: async () => ok({ ok: true }),
    },
    tool: {
      ids: async () => ok([]),
    },
    app: {
      log: async () => ok({ ok: true }),
      agents: async () => ok([]),
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
        ok({ id: "proj-1", name: "test", path: "/tmp/test", createdAt: 0 }),
    },
    lsp: {
      status: async () => ok([]),
    },
    file: {
      list: async () => ok([]),
      read: async () => ok({ type: "text", content: "hello" }),
      status: async () => ok([]),
    },
  } as unknown as PluginInput["client"]
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
  const telegram = createTelegramBot(null, permissionQueue, codexPermissionQueue)
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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("integration: critical flows", () => {
  let server: RemoteServer
  let base: string

  beforeAll(() => {
    const port = findFreePort()
    const deps = buildDeps(port)
    server = createRemoteServer(deps)
    server.start()
    base = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    server.stop()
  })

  // ─── health ──────────────────────────────────────────────────────────────

  it("GET /health returns 200 with expected shape", async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.status).toBe("string")
    expect(body.status === "ok" || body.status === "degraded").toBe(true)
    expect(typeof body.version).toBe("string")
    expect(typeof body.uptime_s).toBe("number")
    expect(body.uptime_s).toBeGreaterThanOrEqual(0)
    expect(typeof body.started_at).toBe("string")
    // started_at must be a valid ISO date
    expect(new Date(body.started_at as string).getTime()).not.toBeNaN()
    expect(typeof body.sse_clients).toBe("number")
    expect(typeof body.push_configured).toBe("boolean")
    // telegram_ok is null when telegram is not configured
    expect(body.telegram_ok === null || typeof body.telegram_ok === "boolean").toBe(true)
  })

  it("GET /health is accessible without auth token", async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
  })

  // ─── auth ─────────────────────────────────────────────────────────────────

  it("endpoints reject requests without Bearer token", async () => {
    const endpoints = [
      { method: "GET", path: "/sessions" },
      { method: "GET", path: "/agents" },
      { method: "GET", path: "/providers" },
      { method: "POST", path: "/sessions" },
    ]

    for (const { method, path } of endpoints) {
      const res = await fetch(`${base}${path}`, { method })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe("UNAUTHORIZED")
    }
  })

  it("endpoints accept requests with valid Bearer token", async () => {
    const res = await fetch(`${base}/sessions`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
  })

  it("endpoints reject requests with wrong token", async () => {
    const res = await fetch(`${base}/sessions`, {
      headers: { Authorization: "Bearer wrong-token" },
    })
    expect(res.status).toBe(401)
  })

  // ─── validation ──────────────────────────────────────────────────────────

  it("POST /sessions with invalid payload (title too long) returns 400", async () => {
    const res = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "x".repeat(201) }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_FAILED")
  })

  it("POST /sessions with valid optional title passes", async () => {
    const res = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "My session" }),
    })
    expect(res.status).toBe(201)
  })

  it("POST /sessions with no body passes (title is optional)", async () => {
    const res = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(201)
  })

  it("POST /sessions with empty body but JSON content-type passes (regression: v1.6.0 dashboard sent this combo and got 400)", async () => {
    const res = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    })
    expect(res.status).toBe(201)
  })

  it("PATCH /sessions/:id with missing title returns 400", async () => {
    const res = await fetch(`${base}/sessions/some-id`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_FAILED")
  })

  // ─── delete_session ───────────────────────────────────────────────────────

  it("DELETE /sessions/:id returns 200 for existing session", async () => {
    const res = await fetch(`${base}/sessions/sess-to-delete`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it("GET /sessions/:id for non-existent session returns 404", async () => {
    const res = await fetch(`${base}/sessions/missing-session-id`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })

  // ─── payload_size ─────────────────────────────────────────────────────────

  it("POST /sessions/:id/prompt with text >50000 chars returns 400", async () => {
    const res = await fetch(`${base}/sessions/any-id/prompt`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "a".repeat(50_001) }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_FAILED")
  })

  it("POST /sessions/:id/prompt with empty message returns 400", async () => {
    const res = await fetch(`${base}/sessions/any-id/prompt`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "" }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("VALIDATION_FAILED")
  })

  it("POST /sessions/:id/prompt with valid message returns 200", async () => {
    const res = await fetch(`${base}/sessions/any-id/prompt`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "hello" }),
    })
    expect(res.status).toBe(200)
  })

  // ─── push_endpoints_gated ────────────────────────────────────────────────

  it("POST /push/test without VAPID configured returns 503", async () => {
    const res = await fetch(`${base}/push/test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("PUSH_DISABLED")
  })

  it("GET /push/public-key without VAPID configured returns 503", async () => {
    const res = await fetch(`${base}/push/public-key`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("PUSH_DISABLED")
  })

  it("POST /push/subscribe without VAPID configured returns 503", async () => {
    const res = await fetch(`${base}/push/subscribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: "https://push.example.com/sub",
        keys: { p256dh: "abc", auth: "def" },
      }),
    })
    expect(res.status).toBe(503)
  })
})
