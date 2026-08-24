// Tests for queue integration + auth precedence (codex-hooks-bridge)
import { describe, expect, test } from "bun:test"
import type { RouteDeps, RouteContext } from "../routes"
import { listPermissions, respondPermission } from "./permissions"
import { createPermissionQueue } from "../../../core/permissions/queue"
import type { Logger } from "../../../infra/logger/index"
import type { AgentAttentionService } from "../../../core/types/agent-attention"

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

function makePermissionDeps(opts?: {
  codexPermissionQueue?: ReturnType<typeof createPermissionQueue>
  attentionService?: AgentAttentionService
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
    attentionService: opts?.attentionService,
    telegram: {} as RouteDeps["telegram"],
    push: {} as RouteDeps["push"],
    logger: silentLogger,
    settingsStore: { load: () => ({}), save: () => ({}), reset: () => {}, filePath: () => "/tmp/c.json" } as RouteDeps["settingsStore"],
    shellEnv: {},
    envFileApplied: [],
    pilotVersion: "0.0.0-test",
    settingsLoader: {
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
    },
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
    void deps.permissionQueue.waitForResponse("main-1", { title: "Main permission", integrationID: "opencode", projectID: "/tmp", directory: "/tmp", sessionID: "main-session" })
    // Enqueue in codexQueue
    void codexQueue.waitForResponse("codex-1", { title: "Codex permission", integrationID: "codex", projectID: "/tmp", directory: "/tmp", sessionID: "codex-session" })

    const res = await listPermissions(makeCtx(deps))
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ permissionID: string }>
    const ids = body.map(p => p.permissionID)
    expect(ids).toContain("main-1")
    expect(ids).toContain("codex-1")
  })

  test("includes OpenCode v2 native pending permissions without duplicating hook-owned IDs", async () => {
    const nativePermission = {
      id: "native-1",
      sessionID: "session-1",
      permission: "bash",
      patterns: ["rm file"],
      metadata: {},
      always: [],
    }
    const attentionService = {
      listPermissions: async () => [nativePermission],
    } as unknown as AgentAttentionService
    const deps = makePermissionDeps({ attentionService })
    void deps.permissionQueue.waitForResponse("native-1", { title: "Hook owns this ID", integrationID: "opencode", projectID: "/tmp", directory: "/tmp", sessionID: "session-1" })

    const res = await listPermissions(makeCtx(deps))
    const body = await res.json() as Array<{ permissionID: string }>
    expect(body.filter((permission) => permission.permissionID === "native-1")).toHaveLength(1)
  })
})

describe("respondPermission — tries both queues", () => {
  test("resolves a main queue permission", async () => {
    const deps = makePermissionDeps()

    const mainResults: Array<{ action: "allow" | "deny" } | null> = []
    deps.permissionQueue.waitForResponse("main-id-1", { integrationID: "opencode", projectID: "/tmp", directory: "/tmp", sessionID: "session-main" }).then((r: { action: "allow" | "deny" } | null) => { mainResults.push(r) })

    const req = new Request("http://test/permissions/main-id-1", {
      method: "POST",
      body: JSON.stringify({ action: "allow", integrationID: "opencode", sessionID: "session-main" }),
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
    codexQueue.waitForResponse("codex-id-1", { integrationID: "codex", projectID: "/tmp", directory: "/tmp", sessionID: "session-codex" }).then((r: { action: "allow" | "deny" } | null) => { codexResults.push(r) })

    const req = new Request("http://test/permissions/codex-id-1", {
      method: "POST",
      body: JSON.stringify({ action: "deny", integrationID: "codex", sessionID: "session-codex" }),
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

  test("returns a typed 400 for malformed JSON", async () => {
    const deps = makePermissionDeps()
    const req = new Request("http://test/permissions/bad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })
    const res = await respondPermission(makeCtx(deps, req, { id: "bad" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_JSON" } })
  })

  test("replies through OpenCode v2 when the permission is native", async () => {
    const replies: unknown[] = []
    const attentionService = {
      listPermissions: async () => [{
        id: "native-only",
        sessionID: "session-1",
        permission: "edit",
        patterns: ["file.ts"],
        metadata: {},
        always: [],
      }],
      replyPermission: async (...args: unknown[]) => { replies.push(args) },
    } as unknown as AgentAttentionService
    const deps = makePermissionDeps({ attentionService })
    const req = new Request("http://test/permissions/native-only?directory=/projects/a", {
      method: "POST",
      body: JSON.stringify({ action: "allow" }),
    })

    const res = await respondPermission(makeCtx(deps, req, { id: "native-only" }))

    expect(res.status).toBe(200)
    expect(replies).toEqual([["native-only", "once", "/projects/a"]])
  })

  test("returns 409 without resolving when both integrations contain the same ID", async () => {
    const deps = makePermissionDeps()
    void deps.permissionQueue.waitForResponse("collision", { integrationID: "opencode", projectID: "/tmp", directory: "/tmp", sessionID: "open-session" })
    void deps.codexPermissionQueue.waitForResponse("collision", { integrationID: "codex", projectID: "/tmp", directory: "/tmp", sessionID: "codex-session" })
    const req = new Request("http://test/permissions/collision", {
      method: "POST",
      body: JSON.stringify({ action: "allow" }),
    })
    const res = await respondPermission(makeCtx(deps, req, { id: "collision" }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: "AMBIGUOUS_PERMISSION_ID" } })
    expect(deps.permissionQueue.pending().map((item) => item.permissionID)).toContain("collision")
    expect(deps.codexPermissionQueue.pending().map((item) => item.permissionID)).toContain("collision")
  })

  test("returns 404 when a permission expires between lookup and resolution", async () => {
    const deps = makePermissionDeps()
    deps.permissionQueue = {
      waitForResponse: async () => null,
      pending: () => [{ permissionID: "expiring", createdAt: Date.now(), resolved: false }],
      resolve: () => false,
    }
    const req = new Request("http://test/permissions/expiring", {
      method: "POST",
      body: JSON.stringify({ action: "deny" }),
    })
    const res = await respondPermission(makeCtx(deps, req, { id: "expiring" }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: "PERMISSION_NOT_FOUND" } })
  })

  test("lists and resolves only the selected project when IDs collide", async () => {
    const deps = makePermissionDeps()
    const a = deps.permissionQueue.waitForResponse("same-id", { integrationID: "opencode", projectID: "/projects/a", directory: "/projects/a", sessionID: "session-a" })
    const b = deps.permissionQueue.waitForResponse("same-id", { integrationID: "codex", projectID: "/projects/b", directory: "/projects/b", sessionID: "session-b" })

    const list = await listPermissions(makeCtx(deps, new Request("http://test/permissions?directory=/projects/a")))
    expect(await list.json()).toEqual([expect.objectContaining({ permissionID: "same-id", integrationID: "opencode", directory: "/projects/a" })])

    const wrongProject = await respondPermission(makeCtx(deps, new Request("http://test/permissions/same-id?directory=/projects/b", {
      method: "POST",
      body: JSON.stringify({ action: "allow", integrationID: "opencode", sessionID: "session-a" }),
    }), { id: "same-id" }))
    expect(wrongProject.status).toBe(404)
    expect(deps.permissionQueue.pending()).toHaveLength(2)

    const allowed = await respondPermission(makeCtx(deps, new Request("http://test/permissions/same-id?directory=/projects/a", {
      method: "POST",
      body: JSON.stringify({ action: "allow", integrationID: "opencode", sessionID: "session-a" }),
    }), { id: "same-id" }))
    expect(allowed.status).toBe(200)
    expect(await a).toEqual({ action: "allow" })
    expect(deps.permissionQueue.pending()).toEqual([expect.objectContaining({ directory: "/projects/b", integrationID: "codex" })])

    expect(deps.permissionQueue.resolve("same-id", "deny", { integrationID: "codex", projectID: "/projects/b", directory: "/projects/b", sessionID: "session-b" })).toBe(true)
    expect(await b).toEqual({ action: "deny" })
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
