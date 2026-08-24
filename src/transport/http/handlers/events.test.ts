// events.test.ts — streamEvents auth tests (V1: timing-safe query token)
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDeviceStore } from "../../../core/devices/store"
import { createEventBus } from "../../../core/events/bus"
import type { RouteDeps, RouteContext } from "../routes"
import { streamEvents } from "./events"
import { revokeDevice, updateDevice } from "./devices"
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
      closeClientTag: () => {},
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

describe("streamEvents — device credential lifecycle", () => {
  test("revocation closes an already-open device stream before later events and rejects reconnect", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pilot-events-"))
    try {
      const deviceStore = createDeviceStore({
        filePath: join(directory, "devices.json"),
        logger: silentLogger,
      })
      const issued = deviceStore.issue({ name: "Revoked phone", role: "admin" })
      const eventBus = createEventBus()
      const deps = makeEventsDeps()
      deps.deviceStore = deviceStore
      deps.eventBus = eventBus

      const stream = await streamEvents(makeEventsCtx(deps, { bearerToken: issued.credential }))
      expect(stream.status).toBe(200)
      const reader = stream.body!.getReader()
      await reader.read()
      await reader.read()
      await reader.read()

      const revoke = await revokeDevice({
        ...makeEventsCtx(deps),
        params: { id: issued.device.id },
        principal: { kind: "legacy", id: "legacy", role: "admin", capabilities: [] },
      })
      expect(revoke.status).toBe(200)
      eventBus.emit({ type: "sensitive.event", properties: { secret: "must-not-arrive" } })

      expect((await reader.read()).done).toBe(true)
      const reconnect = await streamEvents(makeEventsCtx(deps, { bearerToken: issued.credential }))
      expect(reconnect.status).toBe(401)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("role downgrade closes the stale stream but permits a newly authorized stream", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pilot-events-"))
    try {
      const deviceStore = createDeviceStore({
        filePath: join(directory, "devices.json"),
        logger: silentLogger,
      })
      const issued = deviceStore.issue({ name: "Downgraded phone", role: "admin" })
      const eventBus = createEventBus()
      const deps = makeEventsDeps()
      deps.deviceStore = deviceStore
      deps.eventBus = eventBus

      const stream = await streamEvents(makeEventsCtx(deps, { bearerToken: issued.credential }))
      const reader = stream.body!.getReader()
      await reader.read()
      await reader.read()
      await reader.read()

      const update = await updateDevice({
        ...makeEventsCtx(deps),
        req: new Request("http://test/devices", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "read-only" }),
        }),
        params: { id: issued.device.id },
        principal: { kind: "legacy", id: "legacy", role: "admin", capabilities: [] },
      })
      expect(update.status).toBe(200)
      eventBus.emit({ type: "sensitive.event", properties: { secret: "must-not-arrive" } })

      expect((await reader.read()).done).toBe(true)
      const reconnect = await streamEvents(makeEventsCtx(deps, { bearerToken: issued.credential }))
      expect(reconnect.status).toBe(200)
      await reconnect.body?.cancel()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
