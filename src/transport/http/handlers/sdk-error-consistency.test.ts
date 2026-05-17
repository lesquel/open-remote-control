// sdk-error-consistency.test.ts — TDD for SDK result.error handling
// Verifies that all SDK-backed read handlers propagate SDK errors correctly
// instead of silently returning 200 with empty data.
//
// Reference pattern: deleteSession (sessions.ts:112+) and postSessionPrompt.
// Generic SDK failure → 500 SDK_ERROR + deps.logger.error called.
// Not-found SDK error → 404 NOT_FOUND.
// Success path → unchanged 200 with existing shape (byte-identical fallback kept).

import { describe, expect, test } from "bun:test"
import type { RouteDeps, RouteContext } from "../routes"
import type { Logger } from "../../../infra/logger/index"
import {
  listSessions,
  getSessionMessages,
  getSessionDiff,
  getSessionChildren,
} from "./sessions"
import { listTools } from "./sdk-proxy"
import { getStatus } from "./system"

// ─── Shared test fixtures ─────────────────────────────────────────────────────

function makeSpyLogger(): Logger & { errorCalls: Array<[string, unknown]> } {
  const errorCalls: Array<[string, unknown]> = []
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (msg: string, ctx?: unknown) => { errorCalls.push([msg, ctx]) },
    errorCalls,
  }
}

const BASE_CONFIG: RouteDeps["config"] = {
  port: 4097,
  host: "127.0.0.1",
  permissionTimeoutMs: 300_000,
  tunnel: "off",
  telegram: null,
  dev: false,
  vapid: null,
  enableGlobOpener: false,
  fetchTimeoutMs: 10_000,
  projectStateMode: "auto",
  codexPermissionTimeoutMs: 300_000,
}

const BASE_SETTINGS_LOADER: RouteDeps["settingsLoader"] = {
  loadEffective: () => ({
    effective: {
      port: 4097,
      host: "127.0.0.1",
      permissionTimeoutMs: 300_000,
      tunnel: "off" as const,
      telegram: null,
      dev: false,
      vapid: null,
      enableGlobOpener: false,
      fetchTimeoutMs: 10_000,
      projectStateMode: "auto" as const,
      codexPermissionTimeoutMs: 300_000,
    },
    settings: {
      port: 4097,
      host: "127.0.0.1",
      permissionTimeoutMs: 300_000,
      tunnel: "off" as const,
      telegramToken: "",
      telegramChatId: "",
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "",
      enableGlobOpener: false,
      fetchTimeoutMs: 10_000,
      projectStateMode: "auto" as const,
      hookTokenConfigured: false,
    },
    sources: {},
  }),
  envKeyFor: () => "",
  restartRequiredFields: [],
}

function makeDeps(
  client: Partial<RouteDeps["client"]>,
  logger: Logger = makeSpyLogger(),
): RouteDeps {
  return {
    client: client as RouteDeps["client"],
    project: {} as RouteDeps["project"],
    directory: "/tmp",
    worktree: "/tmp",
    config: BASE_CONFIG,
    token: "tok",
    rotateToken: () => {},
    tunnelUrl: null,
    audit: { log: () => {} } as RouteDeps["audit"],
    eventBus: {
      clientCount: () => 0,
      emit: () => {},
      subscribe: () => () => {},
    } as unknown as RouteDeps["eventBus"],
    permissionQueue: {} as RouteDeps["permissionQueue"],
    codexPermissionQueue: {} as RouteDeps["codexPermissionQueue"],
    telegram: { enabled: () => false } as unknown as RouteDeps["telegram"],
    push: { isEnabled: () => false } as unknown as RouteDeps["push"],
    logger,
    settingsStore: {
      load: () => ({}),
      save: () => ({}),
      reset: () => {},
      filePath: () => "/tmp/c.json",
    } as unknown as RouteDeps["settingsStore"],
    shellEnv: {},
    envFileApplied: [],
    pilotVersion: "0.0.0-test",
    settingsLoader: BASE_SETTINGS_LOADER,
  }
}

function makeCtx(deps: RouteDeps, path = "/sessions", params: Record<string, string> = {}): RouteContext {
  return {
    req: new Request(`http://test${path}`),
    url: new URL(`http://test${path}`),
    params,
    deps,
  }
}

// ─── listSessions ─────────────────────────────────────────────────────────────

describe("listSessions — SDK error propagation", () => {
  test("500 + logger.error when session.list returns an error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        session: {
          list: async () => ({ data: undefined, error: { message: "IPC down" } }),
          status: async () => ({ data: {}, error: null }),
        } as unknown as RouteDeps["client"]["session"],
      },
      logger,
    )
    const ctx = makeCtx(deps)
    const res = await listSessions(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
    expect(logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("500 + logger.error when session.status returns an error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        session: {
          list: async () => ({ data: [], error: null }),
          status: async () => ({ data: undefined, error: { message: "IPC down" } }),
        } as unknown as RouteDeps["client"]["session"],
      },
      logger,
    )
    const ctx = makeCtx(deps)
    const res = await listSessions(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
    expect(logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("200 with correct shape when both SDK calls succeed", async () => {
    const deps = makeDeps({
      session: {
        list: async () => ({ data: [{ id: "s1" }], error: null }),
        status: async () => ({ data: { s1: "running" }, error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps)
    const res = await listSessions(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { sessions: unknown[]; statuses: Record<string, unknown> }
    expect(body.sessions).toEqual([{ id: "s1" }])
    expect(body.statuses).toEqual({ s1: "running" })
  })

  test("200 with empty arrays/objects when SDK returns no data but no error", async () => {
    const deps = makeDeps({
      session: {
        list: async () => ({ data: undefined, error: null }),
        status: async () => ({ data: undefined, error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps)
    const res = await listSessions(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { sessions: unknown[]; statuses: Record<string, unknown> }
    // Genuinely empty (no error) → fallback to [] / {} as before
    expect(Array.isArray(body.sessions)).toBe(true)
    expect(typeof body.statuses).toBe("object")
  })
})

// ─── getSessionMessages ───────────────────────────────────────────────────────

describe("getSessionMessages — SDK error propagation", () => {
  test("500 + logger.error when session.messages returns an error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        session: {
          messages: async () => ({ data: undefined, error: { message: "session gone" } }),
        } as unknown as RouteDeps["client"]["session"],
      },
      logger,
    )
    const ctx = makeCtx(deps, "/sessions/s1/messages", { id: "s1" })
    const res = await getSessionMessages(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
    expect(logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("404 when session.messages returns a not-found error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        session: {
          messages: async () => ({ data: undefined, error: { message: "404 not found" } }),
        } as unknown as RouteDeps["client"]["session"],
      },
      logger,
    )
    const ctx = makeCtx(deps, "/sessions/s1/messages", { id: "s1" })
    const res = await getSessionMessages(ctx)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")
  })

  test("200 with messages array when SDK succeeds", async () => {
    const deps = makeDeps({
      session: {
        messages: async () => ({ data: [{ id: "m1" }], error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/sessions/s1/messages", { id: "s1" })
    const res = await getSessionMessages(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body).toEqual([{ id: "m1" }])
  })

  test("200 with empty array when SDK returns no data but no error", async () => {
    const deps = makeDeps({
      session: {
        messages: async () => ({ data: undefined, error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/sessions/s1/messages", { id: "s1" })
    const res = await getSessionMessages(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

// ─── getSessionDiff ───────────────────────────────────────────────────────────

describe("getSessionDiff — SDK error propagation", () => {
  test("500 + logger.error when session.diff returns an error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        session: {
          diff: async () => ({ data: undefined, error: { message: "IPC down" } }),
        } as unknown as RouteDeps["client"]["session"],
      },
      logger,
    )
    const ctx = makeCtx(deps, "/sessions/s1/diff", { id: "s1" })
    const res = await getSessionDiff(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
    expect(logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("404 when session.diff returns a not-found error", async () => {
    const deps = makeDeps({
      session: {
        diff: async () => ({ data: undefined, error: { message: "session not found" } }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/sessions/s1/diff", { id: "s1" })
    const res = await getSessionDiff(ctx)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")
  })

  test("200 with diff data when SDK succeeds", async () => {
    const deps = makeDeps({
      session: {
        diff: async () => ({ data: ["diff-line-1"], error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/sessions/s1/diff", { id: "s1" })
    const res = await getSessionDiff(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body).toEqual(["diff-line-1"])
  })

  test("200 with empty array when SDK returns no data but no error", async () => {
    const deps = makeDeps({
      session: {
        diff: async () => ({ data: undefined, error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/sessions/s1/diff", { id: "s1" })
    const res = await getSessionDiff(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

// ─── getSessionChildren ───────────────────────────────────────────────────────

describe("getSessionChildren — SDK error propagation", () => {
  test("500 + logger.error when session.children returns an error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        session: {
          children: async () => ({ data: undefined, error: { message: "IPC down" } }),
        } as unknown as RouteDeps["client"]["session"],
      },
      logger,
    )
    const ctx = makeCtx(deps, "/sessions/s1/children", { id: "s1" })
    const res = await getSessionChildren(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
    expect(logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("404 when session.children returns a not-found error", async () => {
    const deps = makeDeps({
      session: {
        children: async () => ({ data: undefined, error: { message: "404 session not found" } }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/sessions/s1/children", { id: "s1" })
    const res = await getSessionChildren(ctx)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("NOT_FOUND")
  })

  test("200 with children array when SDK succeeds", async () => {
    const deps = makeDeps({
      session: {
        children: async () => ({ data: [{ id: "child-1" }], error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/sessions/s1/children", { id: "s1" })
    const res = await getSessionChildren(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body).toEqual([{ id: "child-1" }])
  })

  test("200 with empty array when SDK returns no data but no error", async () => {
    const deps = makeDeps({
      session: {
        children: async () => ({ data: undefined, error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/sessions/s1/children", { id: "s1" })
    const res = await getSessionChildren(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

// ─── listTools ────────────────────────────────────────────────────────────────

describe("listTools — SDK error propagation", () => {
  test("500 + logger.error when tool.ids returns an error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        tool: {
          ids: async () => ({ data: undefined, error: { message: "IPC down" } }),
        } as unknown as RouteDeps["client"]["tool"],
      },
      logger,
    )
    const ctx = makeCtx(deps, "/tools")
    const res = await listTools(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
    expect(logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("200 with tool IDs when SDK succeeds", async () => {
    const deps = makeDeps({
      tool: {
        ids: async () => ({ data: ["bash", "python"], error: null }),
      } as unknown as RouteDeps["client"]["tool"],
    })
    const ctx = makeCtx(deps, "/tools")
    const res = await listTools(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body).toEqual(["bash", "python"])
  })

  test("200 with empty array when SDK returns no data but no error", async () => {
    const deps = makeDeps({
      tool: {
        ids: async () => ({ data: undefined, error: null }),
      } as unknown as RouteDeps["client"]["tool"],
    })
    const ctx = makeCtx(deps, "/tools")
    const res = await listTools(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

// ─── getStatus ────────────────────────────────────────────────────────────────

describe("getStatus — SDK error propagation", () => {
  test("500 + logger.error when session.list returns an error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        session: {
          list: async () => ({ data: undefined, error: { message: "IPC down" } }),
          status: async () => ({ data: {}, error: null }),
        } as unknown as RouteDeps["client"]["session"],
      },
      logger,
    )
    const ctx = makeCtx(deps, "/status")
    const res = await getStatus(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
    expect(logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("500 + logger.error when session.status returns an error", async () => {
    const logger = makeSpyLogger()
    const deps = makeDeps(
      {
        session: {
          list: async () => ({ data: [], error: null }),
          status: async () => ({ data: undefined, error: { message: "IPC down" } }),
        } as unknown as RouteDeps["client"]["session"],
      },
      logger,
    )
    const ctx = makeCtx(deps, "/status")
    const res = await getStatus(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
    expect(logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("200 with correct shape when both SDK calls succeed", async () => {
    const deps = makeDeps({
      session: {
        list: async () => ({ data: [{ id: "s1" }, { id: "s2" }], error: null }),
        status: async () => ({ data: { s1: "running", s2: "idle" }, error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/status")
    const res = await getStatus(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as {
      pilot: { version: string; uptime: number }
      sessions: { total: number; statuses: Record<string, unknown> }
      clients: number
    }
    expect(body.sessions.total).toBe(2)
    expect(body.sessions.statuses).toEqual({ s1: "running", s2: "idle" })
    expect(body.pilot.version).toBe("0.0.0-test")
  })

  test("200 with zero sessions when SDK returns no data but no error", async () => {
    const deps = makeDeps({
      session: {
        list: async () => ({ data: undefined, error: null }),
        status: async () => ({ data: undefined, error: null }),
      } as unknown as RouteDeps["client"]["session"],
    })
    const ctx = makeCtx(deps, "/status")
    const res = await getStatus(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as {
      sessions: { total: number; statuses: Record<string, unknown> }
    }
    // Genuinely empty → fallback 0 / {}
    expect(body.sessions.total).toBe(0)
    expect(typeof body.sessions.statuses).toBe("object")
  })
})
