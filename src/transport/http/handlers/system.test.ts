// system.test.ts — Unit tests for rotateAuthToken handler
// TDD: these tests were written BEFORE the implementation was changed.
//
// Two bugs being fixed:
//   Bug 1: mode ignored — updateStateToken always passed mode="auto", ignoring
//          PILOT_PROJECT_STATE. If mode="off" and .opencode/ exists, token rotation
//          could still create or update the project file.
//   Bug 2: silent skip — when readState returns null (state deleted mid-session),
//          updateStateToken was a no-op and rotateAuthToken had no visibility.
//          The TUI /remote command would then use the OLD token from pilot-state.json.
//
// These tests use a real temp-dir for the filesystem assertions and stub
// audit/logger to verify the observable side-effect (structured log/audit call)
// on persist failure.

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { AuditLog } from "../../../core/audit/log"
import type { Logger } from "../../../infra/logger/index"
import { writeState, globalStatePath } from "../../../core/state/store"
import type { PilotState } from "../../../core/state/store"
import type { RouteDeps } from "../routes"
import type { Config } from "../../../core/types/config"
import type { PluginInput } from "@opencode-ai/plugin"
import { createEventBus } from "../../../core/events/bus"
import { createPermissionQueue } from "../../../core/permissions/queue"
import { createTelegramChannel } from "../../../notifications/channels/telegram/index"
import { createPushService } from "../../../notifications/channels/push/service"
import { getHealth, rotateAuthToken } from "./system"

// ─── Helpers ────────────────────────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pilot-rotate-test-"))
}

interface SpyAuditLog extends AuditLog {
  calls: Array<{ action: string; details: Record<string, unknown> }>
}

function createSpyAudit(): SpyAuditLog {
  const calls: Array<{ action: string; details: Record<string, unknown> }> = []
  return {
    calls,
    log(action: string, details: Record<string, unknown>) {
      calls.push({ action, details })
    },
  }
}

interface SpyLogger extends Logger {
  warnCalls: Array<unknown[]>
  errorCalls: Array<unknown[]>
}

function createSpyLogger(): SpyLogger {
  const warnCalls: Array<unknown[]> = []
  const errorCalls: Array<unknown[]> = []
  return {
    warnCalls,
    errorCalls,
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => { warnCalls.push(args) },
    error: (...args: unknown[]) => { errorCalls.push(args) },
  }
}

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 4097,
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
    ...overrides,
  }
}

function buildDeps(
  directory: string,
  config: Config,
  audit: AuditLog,
  logger: Logger,
): RouteDeps {
  const eventBus = createEventBus()
  const permissionQueue = createPermissionQueue(5_000)
  const codexPermissionQueue = createPermissionQueue(300_000)
  const telegram = createTelegramChannel(null, permissionQueue, codexPermissionQueue)
  const push = createPushService({ config, audit, logger })

  const deps: RouteDeps = {
    client: {
      session: {
        list: async () => ({ data: [], error: null }),
        status: async () => ({ data: {}, error: null }),
      },
      app: {
        log: async () => ({ data: { ok: true }, error: null }),
        agents: async () => ({ data: [], error: null }),
      },
    } as unknown as PluginInput["client"],
    project: { worktree: directory } as unknown as PluginInput["project"],
    directory,
    worktree: directory as unknown as PluginInput["worktree"],
    config,
    token: "initial-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
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
    settingsStore: {
      load: () => ({}),
      save: () => ({}),
      reset: () => {},
      filePath: () => "/tmp/pilot-rotate-test-config.json",
    } as unknown as RouteDeps["settingsStore"],
    shellEnv: {},
    envFileApplied: [],
    pilotVersion: "0.0.0-test",
    settingsLoader: {
      loadEffective: () => ({
        effective: config,
        settings: {
          port: config.port,
          host: config.host,
          permissionTimeoutMs: config.permissionTimeoutMs,
          tunnel: config.tunnel,
          telegramToken: "",
          telegramChatId: "",
          vapidPublicKey: "",
          vapidPrivateKey: "",
          vapidSubject: "",
          enableGlobOpener: config.enableGlobOpener,
          fetchTimeoutMs: config.fetchTimeoutMs,
          projectStateMode: config.projectStateMode,
          hookTokenConfigured: false,
        },
        sources: {},
      }),
      envKeyFor: () => "",
      restartRequiredFields: [],
    },
  }
  return deps
}

async function readSseEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const result = await reader.read()
  return result.value ? new TextDecoder().decode(result.value) : ""
}

describe("getHealth — public process probe", () => {
  test("does not call the SDK or Telegram network from an unauthenticated probe", async () => {
    const dir = tempDir()
    try {
      const deps = buildDeps(dir, buildConfig({
        telegram: { token: "token", chatId: "123" },
      }), createSpyAudit(), createSpyLogger())
      let sdkCalls = 0
      let telegramCalls = 0
      deps.client.session.list = async () => {
        sdkCalls += 1
        throw new Error("must not be called")
      }
      deps.telegram.testConnection = async () => {
        telegramCalls += 1
        return { ok: true }
      }

      const req = new Request("http://test/health")
      const res = await getHealth({ req, url: new URL(req.url), params: {}, deps })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        status: "ok",
        telegram_ok: null,
        services: { sdk: "unknown", telegram: "configured" },
      })
      expect(sdkCalls).toBe(0)
      expect(telegramCalls).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("rotateAuthToken — mode forwarded to updateStateToken (bug 1)", () => {
  let dir: string

  beforeEach(() => {
    dir = tempDir()
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  test("mode=off + .opencode/ exists: project file NOT updated after rotation", async () => {
    // Seed state with mode=always so a project file exists.
    const opencodedir = join(dir, ".opencode")
    mkdirSync(opencodedir, { recursive: true })
    const seedState: PilotState = {
      token: "old-token",
      port: 4097,
      host: "127.0.0.1",
      startedAt: 1,
      pid: process.pid,
    }
    writeState(dir, seedState, "always")

    const config = buildConfig({ projectStateMode: "off" })
    const audit = createSpyAudit()
    const logger = createSpyLogger()
    const deps = buildDeps(dir, config, audit, logger)

    const ctx = { deps, params: {}, url: new URL("http://127.0.0.1/auth/rotate"), req: new Request("http://127.0.0.1/auth/rotate", { method: "POST" }) }
    const resp = await rotateAuthToken(ctx)

    // Handler must still return 200.
    expect(resp.status).toBe(200)

    // The project file must NOT have been updated — token in it should still be "old-token".
    const projectFilePath = join(dir, ".opencode", "pilot-state.json")
    expect(existsSync(projectFilePath)).toBe(true) // file existed from seed
    const content = JSON.parse(readFileSync(projectFilePath, "utf-8")) as PilotState
    // With mode=off, updateStateToken must not write to the project file.
    expect(content.token).toBe("old-token")
  })

  test("mode=auto + .opencode/ exists: project file IS updated", async () => {
    const opencodedir = join(dir, ".opencode")
    mkdirSync(opencodedir, { recursive: true })
    const seedState: PilotState = {
      token: "old-token",
      port: 4097,
      host: "127.0.0.1",
      startedAt: 1,
      pid: process.pid,
    }
    writeState(dir, seedState, "auto")

    const config = buildConfig({ projectStateMode: "auto" })
    const audit = createSpyAudit()
    const logger = createSpyLogger()
    const deps = buildDeps(dir, config, audit, logger)

    const ctx = { deps, params: {}, url: new URL("http://127.0.0.1/auth/rotate"), req: new Request("http://127.0.0.1/auth/rotate", { method: "POST" }) }
    const resp = await rotateAuthToken(ctx)

    expect(resp.status).toBe(200)

    const body = await resp.json() as { token: string }
    const newToken: string = body.token

    // Project file MUST have the new token.
    const projectFilePath = join(dir, ".opencode", "pilot-state.json")
    const content = JSON.parse(readFileSync(projectFilePath, "utf-8")) as PilotState
    expect(content.token).toBe(newToken)
  })
})

describe("rotateAuthToken — readState null → visible failure (bug 2)", () => {
  // XDG isolation: redirect XDG_STATE_HOME so globalStatePath() resolves into a
  // fresh empty temp dir. Combined with a fresh project dir that has no .opencode/,
  // this forces readState → null DETERMINISTICALLY across all tests in this block.
  let dir: string
  let xdgDir: string
  let prevXdg: string | undefined

  beforeEach(() => {
    dir = tempDir()
    // getPluginStateDir() checks XDG_STATE_HOME first (src/infra/paths/index.ts:28-29)
    xdgDir = mkdtempSync(join(tmpdir(), "pilot-xdg-state-"))
    prevXdg = process.env.XDG_STATE_HOME
    process.env.XDG_STATE_HOME = xdgDir
  })

  afterEach(() => {
    if (prevXdg === undefined) {
      delete process.env.XDG_STATE_HOME
    } else {
      process.env.XDG_STATE_HOME = prevXdg
    }
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    try { rmSync(xdgDir, { recursive: true, force: true }) } catch {}
  })

  test("no existing state → audit call with persist_failed action (unconditional)", async () => {
    // dir is a fresh empty tempdir (no .opencode/).
    // XDG_STATE_HOME is an empty tempdir → globalStatePath() points at a
    // non-existent file. readState(dir) returns null → updateStateToken → ok:false.
    // The handler MUST still return HTTP 200 (in-memory rotation succeeds),
    // fire "auth.token.rotated", AND fire "auth.token.rotated.persist_failed".
    const config = buildConfig({ projectStateMode: "auto" })
    const audit = createSpyAudit()
    const logger = createSpyLogger()
    const deps = buildDeps(dir, config, audit, logger)

    const ctx = { deps, params: {}, url: new URL("http://127.0.0.1/auth/rotate"), req: new Request("http://127.0.0.1/auth/rotate", { method: "POST" }) }
    const resp = await rotateAuthToken(ctx)

    // HTTP 200 always — in-memory rotation + SSE are the primary success path.
    expect(resp.status).toBe(200)

    // auth.token.rotated MUST always fire (in-memory rotation succeeded).
    expect(audit.calls.some(c => c.action === "auth.token.rotated")).toBe(true)

    // persist_failed MUST fire unconditionally — readState returns null.
    expect(audit.calls.some(c => c.action === "auth.token.rotated.persist_failed")).toBe(true)

    // logger.warn (or error) MUST have been called — the handler logs the persist failure.
    expect(logger.warnCalls.length + logger.errorCalls.length).toBeGreaterThan(0)
  })

  test("forced persist failure: rotateToken fired + SSE token updated in response", async () => {
    // Same isolation as above. Verifies in-memory side-effects are not blocked by
    // the persist failure: deps.token is updated and the response body carries the
    // new token.
    const config = buildConfig({ projectStateMode: "auto" })
    const audit = createSpyAudit()
    const logger = createSpyLogger()
    const deps = buildDeps(dir, config, audit, logger)
    const initialToken = deps.token

    const ctx = { deps, params: {}, url: new URL("http://127.0.0.1/auth/rotate"), req: new Request("http://127.0.0.1/auth/rotate", { method: "POST" }) }
    const resp = await rotateAuthToken(ctx)

    expect(resp.status).toBe(200)

    // The in-memory token must have been rotated (deps.rotateToken was called).
    expect(deps.token).not.toBe(initialToken)

    // The response body must carry the new token.
    const body = await resp.json() as { token: string }
    expect(body.token).toBe(deps.token)

    // persist_failed path: both audit actions must be present.
    expect(audit.calls.some(c => c.action === "auth.token.rotated")).toBe(true)
    expect(audit.calls.some(c => c.action === "auth.token.rotated.persist_failed")).toBe(true)

    // logger.warn must have been called — no silent failures.
    expect(logger.warnCalls.length + logger.errorCalls.length).toBeGreaterThan(0)
  })
})

describe("rotateAuthToken — credential fan-out", () => {
  let dir: string

  beforeEach(() => {
    dir = tempDir()
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  test("keeps the rotated legacy token in the authenticated response, never in global SSE", async () => {
    const deps = buildDeps(dir, buildConfig(), createSpyAudit(), createSpyLogger())
    const reader = deps.eventBus.createSSEResponse().body!.getReader()
    // Drain the welcome frame and proxy-buffering prelude before rotating.
    await readSseEvent(reader)
    await readSseEvent(reader)
    await readSseEvent(reader)

    const req = new Request("http://127.0.0.1/auth/rotate", { method: "POST" })
    const response = await rotateAuthToken({ req, url: new URL(req.url), params: {}, deps })
    const { token } = await response.json() as { token: string }
    const frame = await readSseEvent(reader)

    expect(frame).toContain('"type":"pilot.token.rotated"')
    expect(frame).not.toContain(token)
    expect(frame).not.toContain("connectUrl")
    expect(frame).not.toContain("?token=")
    await reader.cancel()
  })

  test("notifies Telegram without sending a legacy token or tokenized URL", async () => {
    const deps = buildDeps(dir, buildConfig(), createSpyAudit(), createSpyLogger())
    const delivered: string[] = []
    deps.telegram = {
      ...deps.telegram,
      enabled: () => true,
      sendMessage: async (text: string) => { delivered.push(text) },
    }

    const req = new Request("http://127.0.0.1/auth/rotate", { method: "POST" })
    const response = await rotateAuthToken({ req, url: new URL(req.url), params: {}, deps })
    const { token } = await response.json() as { token: string }
    await Promise.resolve()

    expect(delivered).toEqual(["🔑 <b>Token Rotated</b>\n\nFor security, open Pilot locally to reconnect."])
    expect(delivered[0]).not.toContain(token)
    expect(delivered[0]).not.toContain("?token=")
  })
})
