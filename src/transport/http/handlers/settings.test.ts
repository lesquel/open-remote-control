// Tests the /settings HTTP handlers in isolation — exercises the full path:
// PilotSettings validator → SettingsStore round-trip → source classification.
//
// We stub every other dependency the handlers touch (audit, push, telegram,
// event bus) with minimal shapes so the handlers compile and run without
// bringing up a full Bun.serve.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Config } from "../../../core/types/config"
import { loadConfig, mergeStoredSettings, loadConfigSafe, resolveSources, projectConfigToSettings, envKeyFor, RESTART_REQUIRED_FIELDS } from "../../../server/config"
import { createSettingsStore } from "../../../core/settings/store"
import { createPermissionQueue } from "../../../core/permissions/queue"
import type { Logger } from "../../../infra/logger/index"
import type { RouteContext, RouteDeps } from "../routes"
import { getSettings, patchSettings, resetSettings } from "./settings"

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

function makeDeps(opts: {
  configPath: string
  shellEnv?: NodeJS.ProcessEnv
  envFileApplied?: string[]
  config?: Config
}): RouteDeps {
  const settingsStore = createSettingsStore({ logger: silentLogger, filePath: opts.configPath })
  const config = opts.config ?? loadConfig({})
  const shellEnv = opts.shellEnv ?? {}
  const envFileApplied = opts.envFileApplied ?? []
  return {
    // stubs — never exercised by the settings handlers we're testing
    client: {} as RouteDeps["client"],
    project: {} as RouteDeps["project"],
    directory: "/tmp",
    worktree: "/tmp",
    config,
    token: "test-token",
    rotateToken: () => {},
    tunnelUrl: null,
    audit: { log: () => {} } as RouteDeps["audit"],
    eventBus: {} as RouteDeps["eventBus"],
    permissionQueue: {} as RouteDeps["permissionQueue"],
    codexPermissionQueue: createPermissionQueue(300_000),
    telegram: {} as RouteDeps["telegram"],
    push: {} as RouteDeps["push"],
    logger: silentLogger,
    settingsStore,
    shellEnv,
    envFileApplied,
    pilotVersion: "0.0.0-test",
    settingsLoader: {
      loadEffective(stored) {
        const effectiveEnv = mergeStoredSettings(process.env, shellEnv, stored)
        const effective = loadConfigSafe(effectiveEnv, () => {})
        return {
          effective,
          settings: projectConfigToSettings(effective),
          sources: resolveSources(shellEnv, envFileApplied, stored),
        }
      },
      envKeyFor,
      restartRequiredFields: RESTART_REQUIRED_FIELDS,
    },
  }
}

function makeCtx(
  deps: RouteDeps,
  req: Request = new Request("http://test/settings"),
): RouteContext {
  return {
    req,
    url: new URL(req.url),
    params: {},
    deps,
  }
}

describe("GET /settings handler", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pilot-settings-h-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns settings, sources, restartRequired, and configFilePath", async () => {
    const path = join(dir, "config.json")
    const deps = makeDeps({ configPath: path })
    const res = await getSettings(makeCtx(deps))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("settings")
    expect(body).toHaveProperty("sources")
    expect(body).toHaveProperty("restartRequired")
    expect(body.configFilePath).toBe(path)
    expect(body.sources.port).toBe("default")
  })

  test("classifies shell-env, env-file, and settings-store correctly", async () => {
    const path = join(dir, "config.json")
    writeFileSync(path, JSON.stringify({ telegramToken: "abc" }), "utf-8")

    const deps = makeDeps({
      configPath: path,
      shellEnv: { PILOT_PORT: "5000" },
      envFileApplied: ["PILOT_HOST"],
      config: loadConfig({
        PILOT_PORT: "5000",
        PILOT_HOST: "127.0.0.1",
        PILOT_TELEGRAM_TOKEN: "abc",
        PILOT_TELEGRAM_CHAT_ID: "999",
      }),
    })

    const res = await getSettings(makeCtx(deps))
    const body = await res.json()
    expect(body.sources.port).toBe("shell-env")
    expect(body.sources.host).toBe("env-file")
    expect(body.sources.telegramToken).toBe("settings-store")
    expect(body.sources.tunnel).toBe("default")
  })
})

describe("PATCH /settings handler", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pilot-settings-h-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("saves valid patch and returns 200 with updated snapshot", async () => {
    const path = join(dir, "config.json")
    const deps = makeDeps({ configPath: path })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ port: 5555, telegramToken: "my-tok" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.configFilePath).toBe(path)
    // The file should have the new values
    const stored = deps.settingsStore.load()
    expect(stored.port).toBe(5555)
    expect(stored.telegramToken).toBe("my-tok")
  })

  test("rejects invalid port with 400", async () => {
    const deps = makeDeps({ configPath: join(dir, "config.json") })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ port: 99999 }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe("VALIDATION_FAILED")
  })

  test("rejects non-JSON body with 400", async () => {
    const deps = makeDeps({ configPath: join(dir, "config.json") })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: "not-json",
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(400)
  })

  test("returns 409 when a patched field is pinned by shell-env", async () => {
    const deps = makeDeps({
      configPath: join(dir, "config.json"),
      shellEnv: { PILOT_PORT: "4097" },
    })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ port: 5050 }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe("SHELL_ENV_PINNED")
  })

  test("allows patching fields that are NOT shell-env-pinned even if others are", async () => {
    const deps = makeDeps({
      configPath: join(dir, "config.json"),
      shellEnv: { PILOT_PORT: "4097" },
    })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ telegramToken: "ok" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(200)
    expect(deps.settingsStore.load().telegramToken).toBe("ok")
  })

  test("validates host format", async () => {
    const deps = makeDeps({ configPath: join(dir, "config.json") })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ host: "not-a-host" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(400)
  })

  test("validates tunnel enum", async () => {
    const deps = makeDeps({ configPath: join(dir, "config.json") })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ tunnel: "frp" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(400)
  })
})

// ── Batch 7: projectStateMode shell-env pin + PATCH / GET integration ────────

describe("PATCH /settings — projectStateMode shell-env pin", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pilot-settings-h-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("PATCH /settings with shellEnv: { PILOT_PROJECT_STATE: 'always' } → 409 SHELL_ENV_PINNED", async () => {
    const deps = makeDeps({
      configPath: join(dir, "config.json"),
      shellEnv: { PILOT_PROJECT_STATE: "always" },
    })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ projectStateMode: "always" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe("SHELL_ENV_PINNED")
  })

  test("PATCH /settings { projectStateMode: 'always' } with no shell pin → 200 and stored value updated", async () => {
    const configPath = join(dir, "config.json")
    const deps = makeDeps({ configPath })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ projectStateMode: "always" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(200)
    expect(deps.settingsStore.load().projectStateMode).toBe("always")
  })

  test("GET /settings response includes projectStateMode key with effective value", async () => {
    const configPath = join(dir, "config.json")
    // Write projectStateMode to the settings store so that buildSettingsResponse
    // picks it up via mergeStoredSettings (stored settings override base env).
    // The handler always recomputes — deps.config is the boot-time snapshot only.
    writeFileSync(configPath, JSON.stringify({ projectStateMode: "off" }), "utf-8")
    const deps = makeDeps({ configPath })
    const res = await getSettings(makeCtx(deps))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings).toHaveProperty("projectStateMode")
    expect(body.settings.projectStateMode).toBe("off")
  })
})

// ─── Phase 10: hookToken settings wiring ─────────────────────────────────────

describe("hookToken settings — Phase 10", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pilot-hooktoken-h-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("(a) hookToken persisted and loaded back", async () => {
    const configPath = join(dir, "config.json")
    const deps = makeDeps({ configPath })
    // Patch it in
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ hookToken: "my-hook-secret" }),
    })
    const patchRes = await patchSettings(makeCtx(deps, req))
    expect(patchRes.status).toBe(200)
    const stored = deps.settingsStore.load()
    expect(stored.hookToken).toBe("my-hook-secret")
  })

  test("(b) GET /settings returns hookTokenConfigured:true when set, never raw token", async () => {
    const configPath = join(dir, "config.json")
    writeFileSync(configPath, JSON.stringify({ hookToken: "secret-value" }), "utf-8")
    const deps = makeDeps({ configPath })
    const res = await getSettings(makeCtx(deps))
    expect(res.status).toBe(200)
    const body = await res.json() as { settings: Record<string, unknown> }
    // Should show hookTokenConfigured boolean, not the raw value
    expect(body.settings.hookTokenConfigured).toBe(true)
    expect(body.settings.hookToken).toBeUndefined()
    // Raw token value must NOT appear anywhere in the response
    const raw = JSON.stringify(body)
    expect(raw).not.toContain("secret-value")
  })

  test("(b2) GET /settings returns hookTokenConfigured:false when not set", async () => {
    const configPath = join(dir, "config.json")
    const deps = makeDeps({ configPath })
    const res = await getSettings(makeCtx(deps))
    expect(res.status).toBe(200)
    const body = await res.json() as { settings: Record<string, unknown> }
    expect(body.settings.hookTokenConfigured).toBe(false)
  })

  test("(c) PATCH /settings with { hookToken } persists", async () => {
    const configPath = join(dir, "config.json")
    const deps = makeDeps({ configPath })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ hookToken: "newtoken" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(200)
    expect(deps.settingsStore.load().hookToken).toBe("newtoken")
  })

  test("(d) PATCH /settings with hookToken when shell-env-pinned → 409 SHELL_ENV_PINNED", async () => {
    const configPath = join(dir, "config.json")
    const deps = makeDeps({
      configPath,
      shellEnv: { PILOT_HOOK_TOKEN: "shell-token" },
    })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ hookToken: "new-val" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SHELL_ENV_PINNED")
  })
})

// ─── CRITICAL-01: patchSettings must not leak raw hookToken ──────────────────

describe("CRITICAL-01 patchSettings — hookToken must not leak", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pilot-hooktoken-crit-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("PATCH /settings with hookToken — response body must NOT contain raw token", async () => {
    const configPath = join(dir, "config.json")
    const deps = makeDeps({ configPath })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ hookToken: "super-secret-token-abc123" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(200)
    const raw = JSON.stringify(await res.json())
    expect(raw).not.toContain("super-secret-token-abc123")
  })

  test("PATCH /settings with hookToken — response must contain hookTokenConfigured:true", async () => {
    const configPath = join(dir, "config.json")
    const deps = makeDeps({ configPath })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ hookToken: "my-secret-val" }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(200)
    const body = await res.json() as { settings: Record<string, unknown> }
    expect(body.settings.hookTokenConfigured).toBe(true)
    expect(body.settings.hookToken).toBeUndefined()
  })

  test("PATCH /settings without hookToken — hookTokenConfigured:false in response", async () => {
    const configPath = join(dir, "config.json")
    const deps = makeDeps({ configPath })
    const req = new Request("http://test/settings", {
      method: "PATCH",
      body: JSON.stringify({ port: 4200 }),
    })
    const res = await patchSettings(makeCtx(deps, req))
    expect(res.status).toBe(200)
    const body = await res.json() as { settings: Record<string, unknown> }
    expect(body.settings.hookTokenConfigured).toBe(false)
    expect(body.settings.hookToken).toBeUndefined()
  })
})

describe("POST /settings/reset handler", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pilot-settings-h-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("deletes the config file and returns ok", async () => {
    const path = join(dir, "config.json")
    writeFileSync(path, JSON.stringify({ port: 5050 }), "utf-8")
    const deps = makeDeps({ configPath: path })
    const res = await resetSettings(makeCtx(deps))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(deps.settingsStore.load()).toEqual({})
  })

  test("reset response body does NOT contain raw hookToken", async () => {
    const hookTokenValue = "super-secret-hook-tok-abc"
    const path = join(dir, "config.json")
    writeFileSync(path, JSON.stringify({ hookToken: hookTokenValue }), "utf-8")
    const deps = makeDeps({ configPath: path })
    const res = await resetSettings(makeCtx(deps))
    expect(res.status).toBe(200)
    const raw = JSON.stringify(await res.json())
    expect(raw).not.toContain(hookTokenValue)
    expect(raw).not.toContain("hookToken")
  })
})
