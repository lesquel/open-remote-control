// events.test.ts — streamEvents auth tests (V1: timing-safe query token)
import { describe, expect, test } from "bun:test"
import type { RouteDeps, RouteContext } from "../routes"
import { streamEvents } from "./events"
import type { Logger } from "../../../infra/logger/index"

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

function makeEventsDeps(
  token = "valid-token",
  onCreateSSE?: (lastEventId: string | null | undefined) => void,
): RouteDeps {
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
    token,
    rotateToken: () => {},
    tunnelUrl: null,
    audit: { log: () => {} } as RouteDeps["audit"],
    eventBus: {
      createSSEResponse: (_headers?: Record<string, string>, lastEventId?: string | null) => {
        onCreateSSE?.(lastEventId)
        return new Response("data: ping\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
      emit: () => {},
      hasClients: () => false,
      clientCount: () => 0,
      closeAll: () => {},
    } as RouteDeps["eventBus"],
    permissionQueue: {} as RouteDeps["permissionQueue"],
    codexPermissionQueue: {} as RouteDeps["codexPermissionQueue"],
    telegram: {} as RouteDeps["telegram"],
    push: {} as RouteDeps["push"],
    logger: silentLogger,
    settingsStore: {
      load: () => ({}),
      save: (_p: unknown) => ({}),
      reset: () => {},
      filePath: () => "/tmp/c.json",
    } as unknown as RouteDeps["settingsStore"],
    shellEnv: {},
    envFileApplied: [],
    pilotVersion: "0.0.0-test",
    settingsLoader: {
      loadEffective: () => ({
        effective: {} as RouteDeps["config"],
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

function makeEventsCtx(
  deps: RouteDeps,
  opts?: { bearerToken?: string | null; queryToken?: string | null },
): RouteContext {
  const params = new URLSearchParams()
  if (opts?.queryToken !== undefined && opts.queryToken !== null) {
    params.set("token", opts.queryToken)
  }

  const url = new URL(`http://test/events?${params.toString()}`)
  const headers: Record<string, string> = {}
  if (opts?.bearerToken !== null && opts?.bearerToken !== undefined) {
    headers["Authorization"] = `Bearer ${opts.bearerToken}`
  }

  const req = new Request(url.toString(), { headers })
  return { req, url, params: {}, deps }
}

// ─── V1: query token uses timing-safe comparison ─────────────────────────────

describe("streamEvents — ?token= query auth (V1 timing-safe)", () => {
  test("correct query token → 200 SSE response", async () => {
    const deps = makeEventsDeps("my-secret-token")
    const ctx = makeEventsCtx(deps, { queryToken: "my-secret-token" })
    const res = await streamEvents(ctx)
    expect(res.status).toBe(200)
  })

  test("wrong query token → 401", async () => {
    const deps = makeEventsDeps("my-secret-token")
    const ctx = makeEventsCtx(deps, { queryToken: "wrong-token" })
    const res = await streamEvents(ctx)
    expect(res.status).toBe(401)
  })

  test("null query token with no bearer → 401", async () => {
    const deps = makeEventsDeps("my-secret-token")
    const ctx = makeEventsCtx(deps, { bearerToken: null, queryToken: null })
    const res = await streamEvents(ctx)
    expect(res.status).toBe(401)
  })

  test("empty query token → 401 (reject non-public hosts)", async () => {
    const deps = makeEventsDeps("my-secret-token")
    const ctx = makeEventsCtx(deps, { bearerToken: null, queryToken: "" })
    const res = await streamEvents(ctx)
    expect(res.status).toBe(401)
  })

  test("correct Bearer header → 200 (bearer path still works)", async () => {
    const deps = makeEventsDeps("my-secret-token")
    const ctx = makeEventsCtx(deps, { bearerToken: "my-secret-token" })
    const res = await streamEvents(ctx)
    expect(res.status).toBe(200)
  })

  test("wrong Bearer header → 401", async () => {
    const deps = makeEventsDeps("my-secret-token")
    const ctx = makeEventsCtx(deps, { bearerToken: "wrong" })
    const res = await streamEvents(ctx)
    expect(res.status).toBe(401)
  })

  test("forwards the dashboard replay cursor to the event bus", async () => {
    let received: string | null | undefined
    const deps = makeEventsDeps("my-secret-token", (lastEventId) => {
      received = lastEventId
    })
    const ctx = makeEventsCtx(deps, { queryToken: "my-secret-token" })
    ctx.url.searchParams.set("lastEventId", "host-generation:17")

    const res = await streamEvents(ctx)
    expect(res.status).toBe(200)
    expect(received).toBe("host-generation:17")
  })
})
