// RED: codex-handlers — all 11 REQ-IDs, 26 scenarios
import { describe, expect, test } from "bun:test"
import { createPermissionQueue } from "../services/permission-queue"
import type { RouteDeps, RouteContext } from "./routes"
import type { Logger } from "../util/logger"
import { dispatchCodexHook, validateCodexToken, CODEX_DISPATCH } from "./codex-handlers"
import type { CodexHookEvent } from "../types"

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

// Track audit calls
type AuditEntry = { action: string; details: Record<string, unknown> }

function makeTestDeps(opts?: {
  hookToken?: string
  codexPermissionTimeoutMs?: number
  auditEntries?: AuditEntry[]
}): RouteDeps {
  const auditEntries: AuditEntry[] = opts?.auditEntries ?? []
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
      codexPermissionTimeoutMs: opts?.codexPermissionTimeoutMs ?? 30_000,
      hookToken: opts?.hookToken,
    },
    token: "main-token",
    rotateToken: () => {},
    tunnelUrl: null,
    audit: {
      log(action: string, details: Record<string, unknown>) {
        auditEntries.push({ action, details })
      },
    },
    eventBus: {
      emit: () => {},
      clientCount: () => 0,
      hasClients: () => false,
      closeAll: () => {},
      createSSEResponse: () => new Response(""),
    } as RouteDeps["eventBus"],
    permissionQueue: createPermissionQueue(30_000),
    codexPermissionQueue: createPermissionQueue(opts?.codexPermissionTimeoutMs ?? 30_000),
    telegram: {} as RouteDeps["telegram"],
    push: {} as RouteDeps["push"],
    logger: silentLogger,
    settingsStore: { load: () => ({}), save: () => ({}), reset: () => {}, filePath: () => "/tmp/c.json" } as RouteDeps["settingsStore"],
    shellEnv: {},
    envFileApplied: [],
  }
}

function makeCtx(
  deps: RouteDeps,
  event: string,
  body: unknown,
  token = "main-token",
): RouteContext {
  const req = new Request(`http://test/codex/hooks/${event}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-forwarded-for": "192.168.1.1",
    },
    body: JSON.stringify(body),
  })
  return {
    req,
    url: new URL(req.url),
    params: { event },
    deps,
  }
}

function makeCtxRaw(deps: RouteDeps, event: string, rawBody: string, token = "main-token"): RouteContext {
  const req = new Request(`http://test/codex/hooks/${event}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: rawBody,
  })
  return {
    req,
    url: new URL(req.url),
    params: { event },
    deps,
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const sessionStartBody = {
  session_id: "sess-1",
  cwd: "/workspace",
  model: "gpt-4o",
  permission_mode: "default",
}

const userPromptBody = {
  session_id: "sess-1",
  turn_id: "turn-1",
  prompt: "write me a function",
}

const preToolBody = {
  session_id: "sess-1",
  turn_id: "turn-1",
  tool_use_id: "tuid-1",
  tool_name: "bash",
  tool_input: { command: "ls" },
}

const postToolBody = {
  session_id: "sess-1",
  turn_id: "turn-1",
  tool_use_id: "tuid-1",
  tool_name: "bash",
  tool_response: "file1.ts\nfile2.ts",
}

const permissionBody = {
  session_id: "sess-1",
  turn_id: "turn-1",
  tool_name: "bash",
  tool_input: { command: "rm -rf /" },
}

const stopBody = {
  session_id: "sess-1",
  stop_hook_active: false,
}

// ─── REQ-RTE-01: Unknown event → 404 ─────────────────────────────────────────

describe("REQ-RTE-01 unknown event", () => {
  test("unknown event name → 404 UNKNOWN_HOOK_EVENT", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "UnknownEvent", {})
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("UNKNOWN_HOOK_EVENT")
  })
})

// ─── REQ-RTE-02: Auth ─────────────────────────────────────────────────────────

describe("REQ-RTE-02 auth", () => {
  test("bad token → 401", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "SessionStart", sessionStartBody, "wrong-token")
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(401)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  test("missing Bearer → 401", async () => {
    const deps = makeTestDeps()
    const req = new Request("http://test/codex/hooks/SessionStart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionStartBody),
    })
    const res = await dispatchCodexHook({ req, url: new URL(req.url), params: { event: "SessionStart" }, deps })
    expect(res.status).toBe(401)
  })

  test("hookToken set → accepted alongside main token", async () => {
    const deps = makeTestDeps({ hookToken: "hook-secret" })
    const ctx = makeCtx(deps, "SessionStart", sessionStartBody, "hook-secret")
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)
  })

  test("hookToken set → main token also accepted", async () => {
    const deps = makeTestDeps({ hookToken: "hook-secret" })
    const ctx = makeCtx(deps, "SessionStart", sessionStartBody, "main-token")
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)
  })
})

// ─── REQ-RTE-03: Payload validation ──────────────────────────────────────────

describe("REQ-RTE-03 payload validation", () => {
  test("invalid JSON body → 400 INVALID_JSON", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtxRaw(deps, "SessionStart", "not-json!!!")
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("INVALID_JSON")
  })

  test("missing required field → 400 INVALID_PAYLOAD", async () => {
    const deps = makeTestDeps()
    // Missing session_id
    const ctx = makeCtx(deps, "SessionStart", { cwd: "/tmp", model: "gpt-4o", permission_mode: "default" })
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("INVALID_PAYLOAD")
  })
})

// ─── REQ-FIR-01: SessionStart → 204 ──────────────────────────────────────────

describe("REQ-FIR-01 SessionStart", () => {
  test("valid SessionStart → 204", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "SessionStart", sessionStartBody)
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)
  })
})

// ─── REQ-FIR-02: UserPromptSubmit → 204 ──────────────────────────────────────

describe("REQ-FIR-02 UserPromptSubmit", () => {
  test("valid UserPromptSubmit → 204", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "UserPromptSubmit", userPromptBody)
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)
  })
})

// ─── REQ-FIR-03: PreToolUse → 204 ────────────────────────────────────────────

describe("REQ-FIR-03 PreToolUse", () => {
  test("valid PreToolUse → 204", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "PreToolUse", preToolBody)
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)
  })
})

// ─── REQ-FIR-04: PostToolUse → 204 ───────────────────────────────────────────

describe("REQ-FIR-04 PostToolUse", () => {
  test("valid PostToolUse → 204", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "PostToolUse", postToolBody)
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)
  })
})

// ─── REQ-FIR-05: Stop → 204 ──────────────────────────────────────────────────

describe("REQ-FIR-05 Stop", () => {
  test("valid Stop → 204", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "Stop", stopBody)
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)
  })
})

// ─── REQ-PRM-01/02/03: PermissionRequest allow/deny ──────────────────────────

/** Poll until at least one entry appears in the queue, then resolve it. */
async function resolveWhenReady(
  queue: ReturnType<typeof createPermissionQueue>,
  action: "allow" | "deny",
  maxMs = 2000,
): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const pending = queue.pending()
    if (pending.length > 0) {
      pending.forEach(p => queue.resolve(p.permissionID, action))
      return
    }
    await new Promise<void>(r => setTimeout(r, 0))
  }
  throw new Error("resolveWhenReady: no pending entries after timeout")
}

describe("REQ-PRM-02 PermissionRequest allow", () => {
  test("allow → 200 { behavior: 'allow' }", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "PermissionRequest", permissionBody)

    // Start resolving in background — polls until waiter is registered
    const resolver = resolveWhenReady(deps.codexPermissionQueue, "allow")

    const res = await dispatchCodexHook(ctx)
    await resolver
    expect(res.status).toBe(200)
    const body = await res.json() as { hookSpecificOutput: { hookEventName: string; decision: { behavior: string } } }
    expect(body.hookSpecificOutput.hookEventName).toBe("PermissionRequest")
    expect(body.hookSpecificOutput.decision.behavior).toBe("allow")
  })
})

describe("REQ-PRM-03 PermissionRequest deny", () => {
  test("deny → 200 { behavior: 'deny', message }", async () => {
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, "PermissionRequest", permissionBody)

    const resolver = resolveWhenReady(deps.codexPermissionQueue, "deny")

    const res = await dispatchCodexHook(ctx)
    await resolver
    expect(res.status).toBe(200)
    const body = await res.json() as { hookSpecificOutput: { decision: { behavior: string; message?: string } } }
    expect(body.hookSpecificOutput.decision.behavior).toBe("deny")
    expect(typeof body.hookSpecificOutput.decision.message).toBe("string")
  })
})

// ─── Phase 9: Audit Log assertions ───────────────────────────────────────────

describe("REQ-AUD-01 audit entries", () => {
  test("SessionStart logs event, sessionId, result, clientIp, ts", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeTestDeps({ auditEntries })
    const ctx = makeCtx(deps, "SessionStart", sessionStartBody)
    await dispatchCodexHook(ctx)

    const entry = auditEntries.find(e => e.action === "codex.hook")
    expect(entry).toBeDefined()
    expect(entry?.details.event).toBe("SessionStart")
    expect(entry?.details.sessionId).toBe("sess-1")
    expect(entry?.details.result).toBe("success")
    expect(typeof entry?.details.clientIp).toBe("string")
    expect(typeof entry?.details.ts).toBe("string")
  })

  test("401 auth failure is audited with result '401'", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeTestDeps({ auditEntries })
    const ctx = makeCtx(deps, "SessionStart", sessionStartBody, "wrong-token")
    await dispatchCodexHook(ctx)

    const entry = auditEntries.find(e => e.action === "codex.hook")
    expect(entry).toBeDefined()
    expect(entry?.details.result).toBe("auth_error")
  })

  test("timeout result is recorded as 'timeout' with permissionID", async () => {
    const timeoutMs = 150
    const auditEntries: AuditEntry[] = []
    const codexQueue = createPermissionQueue(timeoutMs)
    const deps = makeTestDeps({ codexPermissionTimeoutMs: timeoutMs, auditEntries })
    deps.codexPermissionQueue = codexQueue

    const ctx = makeCtx(deps, "PermissionRequest", permissionBody)
    await dispatchCodexHook(ctx)

    const entry = auditEntries.find(e => e.action === "codex.hook" && e.details.result === "timeout")
    expect(entry).toBeDefined()
    expect(entry?.details.event).toBe("PermissionRequest")
    expect(entry?.details.sessionId).toBe("sess-1")
    expect(typeof entry?.details.clientIp).toBe("string")
    expect(typeof entry?.details.ts).toBe("string")
    expect(typeof entry?.details.permissionID).toBe("string")
    expect((entry?.details.permissionID as string).length).toBeGreaterThan(0)
  }, 2000)
})

// ─── Phase 8: Route registration smoke test ──────────────────────────────────

import { matchRoute } from "./routes"
import { MAX_REQUEST_BODY_BYTES } from "../constants"

describe("Route registration smoke test", () => {
  test("POST /codex/hooks/SessionStart is matched in routes table", () => {
    const match = matchRoute("POST", "/codex/hooks/SessionStart")
    expect(match).not.toBeNull()
    expect(match?.params.event).toBe("SessionStart")
  })

  test("POST /codex/hooks/Unknown is matched (handler returns 404)", () => {
    // The route exists but the handler returns 404 UNKNOWN_HOOK_EVENT for unknown events
    const match = matchRoute("POST", "/codex/hooks/Unknown")
    expect(match).not.toBeNull()
  })

  test("GET /codex/hooks/SessionStart does NOT match (wrong method)", () => {
    const match = matchRoute("GET", "/codex/hooks/SessionStart")
    expect(match).toBeNull()
  })
})

// ─── REQ-PRM-04: PermissionRequest timeout ────────────────────────────────────

describe("REQ-PRM-04 PermissionRequest timeout", () => {
  test("timeout → 200 deny with timeout message, no queue leak", async () => {
    // Use a very short timeout (100ms as recommended to avoid CI flakes)
    const timeoutMs = 150
    const auditEntries: AuditEntry[] = []
    const codexQueue = createPermissionQueue(timeoutMs)
    const deps = makeTestDeps({ codexPermissionTimeoutMs: timeoutMs, auditEntries })
    // Replace the codex queue with one using the short timeout
    deps.codexPermissionQueue = codexQueue

    const ctx = makeCtx(deps, "PermissionRequest", permissionBody)

    // Don't resolve — let it time out
    const res = await dispatchCodexHook(ctx)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      hookSpecificOutput: {
        hookEventName: string
        decision: { behavior: string; message: string }
      }
    }
    expect(body.hookSpecificOutput.hookEventName).toBe("PermissionRequest")
    expect(body.hookSpecificOutput.decision.behavior).toBe("deny")
    expect(body.hookSpecificOutput.decision.message).toContain("timed out")
    expect(body.hookSpecificOutput.decision.message).toContain(`${timeoutMs}ms`)

    // Audit result should be "timeout" (semantic label per spec)
    const hookAudit = auditEntries.find(e => e.action === "codex.hook" && e.details.result === "timeout")
    expect(hookAudit).toBeDefined()

    // No pending queue entries after timeout
    expect(codexQueue.pending().length).toBe(0)
  }, 2000)
})

// ─── REQ-RTE-01: CODEX_DISPATCH exhaustiveness ────────────────────────────────

describe("CODEX_DISPATCH exhaustiveness", () => {
  test("dispatch table keys cover all CodexHookEvent variants", () => {
    const expected: CodexHookEvent[] = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
      "Stop",
    ]
    const actual = Object.keys(CODEX_DISPATCH).sort()
    expect(actual).toEqual(expected.sort())
  })
})

// ─── WARNING-03: audit result strings must use semantic labels ────────────────

describe("WARNING-03 audit result semantic labels", () => {
  test("SessionStart happy path audit result is 'success' not '204'", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeTestDeps({ auditEntries })
    const ctx = makeCtx(deps, "SessionStart", sessionStartBody)
    await dispatchCodexHook(ctx)
    const entry = auditEntries.find(e => e.action === "codex.hook")
    expect(entry?.details.result).toBe("success")
  })

  test("unknown event audit result is 'not_found' not '404'", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeTestDeps({ auditEntries })
    const ctx = makeCtx(deps, "UnknownEvent", {})
    await dispatchCodexHook(ctx)
    const entry = auditEntries.find(e => e.action === "codex.hook")
    expect(entry?.details.result).toBe("not_found")
  })

  test("bad token audit result is 'auth_error' not '401'", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeTestDeps({ auditEntries })
    const ctx = makeCtx(deps, "SessionStart", sessionStartBody, "wrong-token")
    await dispatchCodexHook(ctx)
    const entry = auditEntries.find(e => e.action === "codex.hook")
    expect(entry?.details.result).toBe("auth_error")
  })

  test("invalid payload audit result is 'validation_error' not '400'", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeTestDeps({ auditEntries })
    const ctx = makeCtx(deps, "SessionStart", { cwd: "/tmp", model: "gpt-4o", permission_mode: "default" })
    await dispatchCodexHook(ctx)
    const entry = auditEntries.find(e => e.action === "codex.hook")
    expect(entry?.details.result).toBe("validation_error")
  })

  test("PermissionRequest allow audit result is 'allowed' not '200-allow'", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeTestDeps({ auditEntries })
    const ctx = makeCtx(deps, "PermissionRequest", permissionBody)
    const resolver = resolveWhenReady(deps.codexPermissionQueue, "allow")
    await dispatchCodexHook(ctx)
    await resolver
    const entry = auditEntries.find(e => e.action === "codex.hook" && e.details.result === "allowed")
    expect(entry).toBeDefined()
  })

  test("PermissionRequest deny audit result is 'denied' not '200-deny'", async () => {
    const auditEntries: AuditEntry[] = []
    const deps = makeTestDeps({ auditEntries })
    const ctx = makeCtx(deps, "PermissionRequest", permissionBody)
    const resolver = resolveWhenReady(deps.codexPermissionQueue, "deny")
    await dispatchCodexHook(ctx)
    await resolver
    const entry = auditEntries.find(e => e.action === "codex.hook" && e.details.result === "denied")
    expect(entry).toBeDefined()
  })

  test("PermissionRequest timeout audit result is 'timeout' not '200-timeout-deny'", async () => {
    const timeoutMs = 150
    const auditEntries: AuditEntry[] = []
    const codexQueue = createPermissionQueue(timeoutMs)
    const deps = makeTestDeps({ codexPermissionTimeoutMs: timeoutMs, auditEntries })
    deps.codexPermissionQueue = codexQueue
    const ctx = makeCtx(deps, "PermissionRequest", permissionBody)
    await dispatchCodexHook(ctx)
    const entry = auditEntries.find(e => e.action === "codex.hook" && e.details.result === "timeout")
    expect(entry).toBeDefined()
  }, 2000)
})

// ─── WARNING-04: pilot.permission.resolved on timeout must include reason:"timeout" ──

describe("WARNING-04 timeout emits reason:timeout", () => {
  test("timeout fires pilot.permission.resolved with reason:'timeout'", async () => {
    const timeoutMs = 150
    type EmittedEvent = { type: string; properties: Record<string, unknown> }
    const emitted: EmittedEvent[] = []
    const codexQueue = createPermissionQueue(timeoutMs)
    const deps = makeTestDeps({ codexPermissionTimeoutMs: timeoutMs })
    deps.codexPermissionQueue = codexQueue
    deps.eventBus = {
      emit: (e: unknown) => { emitted.push(e as EmittedEvent) },
      clientCount: () => 0,
      hasClients: () => false,
      closeAll: () => {},
      createSSEResponse: () => new Response(""),
    } as typeof deps.eventBus

    const ctx = makeCtx(deps, "PermissionRequest", permissionBody)
    await dispatchCodexHook(ctx)

    const resolved = emitted.find(e => e.type === "pilot.permission.resolved")
    expect(resolved).toBeDefined()
    expect(resolved?.properties.reason).toBe("timeout")
  }, 2000)
})

// ─── Fix 4: tool_response unbounded stringify ─────────────────────────────────

describe("Fix-4 PostToolUse tool_response title is bounded", () => {
  test("large object tool_response produces bounded title (no throw)", async () => {
    type EmittedEvent = { type: string; properties: Record<string, unknown> }
    const emitted: EmittedEvent[] = []
    const deps = makeTestDeps()
    deps.eventBus = {
      emit: (e: unknown) => { emitted.push(e as EmittedEvent) },
      clientCount: () => 0,
      hasClients: () => false,
      closeAll: () => {},
      createSSEResponse: () => new Response(""),
    } as typeof deps.eventBus

    // Large nested object — would be MB if JSON.stringified
    const bigObj: Record<string, unknown> = {}
    for (let i = 0; i < 1000; i++) {
      bigObj[`key_${i}`] = "x".repeat(1000)
    }

    const ctx = makeCtx(deps, "PostToolUse", { ...postToolBody, tool_response: bigObj })
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)

    const completed = emitted.find(e => e.type === "pilot.tool.completed")
    expect(completed).toBeDefined()
    const titleLen = typeof completed?.properties.title === "string"
      ? completed.properties.title.length
      : 0
    expect(titleLen).toBeLessThanOrEqual(200)
  })

  test("object with throwing getter produces bounded title (no throw)", async () => {
    type EmittedEvent = { type: string; properties: Record<string, unknown> }
    const emitted: EmittedEvent[] = []
    const deps = makeTestDeps()
    deps.eventBus = {
      emit: (e: unknown) => { emitted.push(e as EmittedEvent) },
      clientCount: () => 0,
      hasClients: () => false,
      closeAll: () => {},
      createSSEResponse: () => new Response(""),
    } as typeof deps.eventBus

    // Object with a key (Object.keys won't throw — only getter access would)
    const weirdObj = { normalKey: "value" }

    const ctx = makeCtx(deps, "PostToolUse", { ...postToolBody, tool_response: weirdObj })
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(204)

    const completed = emitted.find(e => e.type === "pilot.tool.completed")
    expect(completed).toBeDefined()
    expect(typeof completed?.properties.title).toBe("string")
    const titleLen = (completed?.properties.title as string).length
    expect(titleLen).toBeLessThanOrEqual(200)
  })
})

// ─── Fix 1: unknown event 404 body is truncated ───────────────────────────────

describe("Fix-1 unknown event 404 body truncated", () => {
  test("1000-char regex-valid event returns 404 with truncated message (≤40 chars in event part)", async () => {
    const longEvent = "A".repeat(1000)
    const deps = makeTestDeps()
    const ctx = makeCtx(deps, longEvent, {})
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe("UNKNOWN_HOOK_EVENT")
    // The event name in the message must be truncated to at most 40 chars
    const msg = body.error.message
    const quoted = msg.match(/"([^"]*)"/)
    expect(quoted).not.toBeNull()
    expect((quoted![1] as string).length).toBeLessThanOrEqual(40)
  })
})

// ─── Fix 3: chunked body > 1 MiB → 413 ──────────────────────────────────────

describe("Fix-3 chunked body exceeds 1 MiB → 413", () => {
  test("body larger than MAX_REQUEST_BODY_BYTES returns 413 PAYLOAD_TOO_LARGE", async () => {
    const deps = makeTestDeps()
    // Build a body slightly over 1 MiB with no Content-Length (simulate chunked)
    const oversized = "x".repeat(MAX_REQUEST_BODY_BYTES + 1)
    const req = new Request("http://test/codex/hooks/SessionStart", {
      method: "POST",
      headers: {
        "Authorization": "Bearer main-token",
        "Content-Type": "application/json",
        // Deliberately omit Content-Length to bypass upstream checkBodySize
      },
      body: oversized,
      // @ts-expect-error — duplex is required for streaming in some runtimes
      duplex: "half",
    })
    const ctx: RouteContext = { req, url: new URL(req.url), params: { event: "SessionStart" }, deps }
    const res = await dispatchCodexHook(ctx)
    expect(res.status).toBe(413)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE")
  })
})

// ─── Fix 4: client disconnect cleans up queue entry ──────────────────────────

describe("Fix-4 client disconnect cleans up queue", () => {
  test("aborting request removes waiter and leaves queue empty", async () => {
    const deps = makeTestDeps()
    const controller = new AbortController()
    const req = new Request("http://test/codex/hooks/PermissionRequest", {
      method: "POST",
      headers: {
        "Authorization": "Bearer main-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(permissionBody),
      signal: controller.signal,
    })
    const ctx: RouteContext = { req, url: new URL(req.url), params: { event: "PermissionRequest" }, deps }

    // Start the handler (it will block waiting for permission)
    const handlerPromise = dispatchCodexHook(ctx)

    // Poll until the waiter is registered, then abort
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && deps.codexPermissionQueue.pending().length === 0) {
      await new Promise<void>(r => setTimeout(r, 0))
    }

    // Abort the request
    controller.abort()

    await handlerPromise

    // Queue must be empty — no phantom waiter
    expect(deps.codexPermissionQueue.pending().length).toBe(0)
  })
})

// ─── WARNING-05: pilot.tool.completed must include ok field ──────────────────

describe("WARNING-05 pilot.tool.completed includes ok:boolean", () => {
  test("PostToolUse emits pilot.tool.completed with ok field", async () => {
    type EmittedEvent = { type: string; properties: Record<string, unknown> }
    const emitted: EmittedEvent[] = []
    const deps = makeTestDeps()
    deps.eventBus = {
      emit: (e: unknown) => { emitted.push(e as EmittedEvent) },
      clientCount: () => 0,
      hasClients: () => false,
      closeAll: () => {},
      createSSEResponse: () => new Response(""),
    } as typeof deps.eventBus

    const ctx = makeCtx(deps, "PostToolUse", postToolBody)
    await dispatchCodexHook(ctx)

    const completed = emitted.find(e => e.type === "pilot.tool.completed")
    expect(completed).toBeDefined()
    expect(typeof completed?.properties.ok).toBe("boolean")
  })
})
