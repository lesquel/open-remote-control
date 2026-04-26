// Tests for queue integration + auth precedence (codex-hooks-bridge)
import { describe, expect, test } from "bun:test"
import type { RouteDeps, RouteContext } from "../routes"
import { listPermissions, respondPermission } from "./permissions"
import { createPermissionQueue } from "../../../core/permissions/queue"
import type { Logger } from "../../../infra/logger/index"

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

function makePermissionDeps(opts?: {
  codexPermissionQueue?: ReturnType<typeof createPermissionQueue>
}): RouteDeps {
  const mainQueue = createPermissionQueue(30_000)
  const codexQueue = opts?.codexPermissionQueue ?? createPermissionQueue(30_000)
  return {
    client: {} as RouteDeps["client"],
    project: {} as RouteDeps["project"],
    directory: "/tmp",
    worktree: "/tmp",
    config: {
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
    },
    token: "main-token",
    rotateToken: () => {},
    tunnelUrl: null,
    audit: { log: () => {} } as RouteDeps["audit"],
    eventBus: {} as RouteDeps["eventBus"],
    permissionQueue: mainQueue,
    codexPermissionQueue: codexQueue,
    telegram: {} as RouteDeps["telegram"],
    push: {} as RouteDeps["push"],
    logger: silentLogger,
    settingsStore: { load: () => ({}), save: () => ({}), reset: () => {}, filePath: () => "/tmp/c.json" } as RouteDeps["settingsStore"],
    shellEnv: {},
    envFileApplied: [],
  }
}

function makeCtx(deps: RouteDeps, req?: Request, params?: Record<string, string>): RouteContext {
  const r = req ?? new Request("http://test/permissions")
  return {
    req: r,
    url: new URL(r.url),
    params: params ?? {},
    deps,
  }
}

// ─── Phase 4: Permission-Queue Integration ───────────────────────────────────

describe("listPermissions — merges both queues", () => {
  test("returns empty list when both queues are empty", async () => {
    const deps = makePermissionDeps()
    const res = await listPermissions(makeCtx(deps))
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test("returns items from both mainQueue and codexQueue", async () => {
    const codexQueue = createPermissionQueue(30_000)
    const deps = makePermissionDeps({ codexPermissionQueue: codexQueue })

    // Enqueue in mainQueue
    void deps.permissionQueue.waitForResponse("main-1", { title: "Main permission" })
    // Enqueue in codexQueue
    void codexQueue.waitForResponse("codex-1", { title: "Codex permission" })

    const res = await listPermissions(makeCtx(deps))
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ permissionID: string }>
    const ids = body.map(p => p.permissionID)
    expect(ids).toContain("main-1")
    expect(ids).toContain("codex-1")
  })
})

describe("respondPermission — tries both queues", () => {
  test("resolves a main queue permission", async () => {
    const deps = makePermissionDeps()

    const mainResults: Array<{ action: "allow" | "deny" } | null> = []
    deps.permissionQueue.waitForResponse("main-id-1", {}).then((r: { action: "allow" | "deny" } | null) => { mainResults.push(r) })

    const req = new Request("http://test/permissions/main-id-1", {
      method: "POST",
      body: JSON.stringify({ action: "allow" }),
    })
    const res = await respondPermission(makeCtx(deps, req, { id: "main-id-1" }))
    expect(res.status).toBe(200)

    // Give promise microtasks a chance to resolve
    await new Promise(r => setTimeout(r, 10))
    expect(mainResults[0]?.action).toBe("allow")
  })

  test("resolves a codex queue permission via /permissions/:id", async () => {
    const codexQueue = createPermissionQueue(30_000)
    const deps = makePermissionDeps({ codexPermissionQueue: codexQueue })

    const codexResults: Array<{ action: "allow" | "deny" } | null> = []
    codexQueue.waitForResponse("codex-id-1", {}).then((r: { action: "allow" | "deny" } | null) => { codexResults.push(r) })

    const req = new Request("http://test/permissions/codex-id-1", {
      method: "POST",
      body: JSON.stringify({ action: "deny" }),
    })
    const res = await respondPermission(makeCtx(deps, req, { id: "codex-id-1" }))
    expect(res.status).toBe(200)

    await new Promise(r => setTimeout(r, 10))
    expect(codexResults[0]?.action).toBe("deny")
  })

  test("returns 404 PERMISSION_NOT_FOUND when ID is not in either queue", async () => {
    const deps = makePermissionDeps()
    const req = new Request("http://test/permissions/nonexistent", {
      method: "POST",
      body: JSON.stringify({ action: "allow" }),
    })
    const res = await respondPermission(makeCtx(deps, req, { id: "nonexistent" }))
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("PERMISSION_NOT_FOUND")
  })
})

// ─── Phase 5: Auth Precedence ────────────────────────────────────────────────

import { validateHookToken as validateCodexToken } from "../../../infra/http/auth"

function makeAuthRequest(token?: string): Request {
  const headers: Record<string, string> = {}
  if (token) headers["Authorization"] = `Bearer ${token}`
  return new Request("http://test/codex/hooks/SessionStart", { method: "POST", headers })
}

describe("validateCodexToken — auth precedence", () => {
  test("(a) hookToken set → request with hookToken accepted", () => {
    const result = validateCodexToken(makeAuthRequest("hook-secret"), "hook-secret", "main-token")
    expect(result).toBe(true)
  })

  test("(b) hookToken set → request with main token also accepted", () => {
    const result = validateCodexToken(makeAuthRequest("main-token"), "hook-secret", "main-token")
    expect(result).toBe(true)
  })

  test("(c) hookToken set → invalid token → false", () => {
    const result = validateCodexToken(makeAuthRequest("wrong"), "hook-secret", "main-token")
    expect(result).toBe(false)
  })

  test("(d) missing Bearer → false", () => {
    const result = validateCodexToken(makeAuthRequest(), "hook-secret", "main-token")
    expect(result).toBe(false)
  })

  test("(e) hookToken unset → falls back to main token comparison only", () => {
    const result = validateCodexToken(makeAuthRequest("main-token"), undefined, "main-token")
    expect(result).toBe(true)
  })

  test("(e2) hookToken unset → wrong token → false", () => {
    const result = validateCodexToken(makeAuthRequest("wrong"), undefined, "main-token")
    expect(result).toBe(false)
  })
})
