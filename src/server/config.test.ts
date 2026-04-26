import { describe, expect, test } from "bun:test"
import {
  ConfigError,
  loadConfig,
  mergeStoredSettings,
  projectConfigToSettings,
  resolveSources,
  RESTART_REQUIRED_FIELDS,
} from "./config"
import { DEFAULT_HOST, DEFAULT_CODEX_PERMISSION_TIMEOUT_MS, DEFAULT_PERMISSION_TIMEOUT_MS, DEFAULT_PORT, MAX_CODEX_PERMISSION_TIMEOUT_MS } from "./constants"

describe("loadConfig", () => {
  test("returns defaults when env is empty", () => {
    const cfg = loadConfig({})
    expect(cfg.port).toBe(DEFAULT_PORT)
    expect(cfg.host).toBe(DEFAULT_HOST)
    expect(cfg.permissionTimeoutMs).toBe(DEFAULT_PERMISSION_TIMEOUT_MS)
    expect(cfg.tunnel).toBe("off")
    expect(cfg.telegram).toBeNull()
    expect(cfg.dev).toBe(false)
  })

  test("parses PILOT_PORT correctly", () => {
    const cfg = loadConfig({ PILOT_PORT: "8080" })
    expect(cfg.port).toBe(8080)
  })

  test("throws ConfigError on invalid port (out of range)", () => {
    expect(() => loadConfig({ PILOT_PORT: "99999" })).toThrow(ConfigError)
  })

  test("throws ConfigError on invalid port (zero)", () => {
    expect(() => loadConfig({ PILOT_PORT: "0" })).toThrow(ConfigError)
  })

  test("detects telegram config when both vars are present", () => {
    const cfg = loadConfig({
      PILOT_TELEGRAM_TOKEN: "123:ABC",
      PILOT_TELEGRAM_CHAT_ID: "456",
    })
    expect(cfg.telegram).toEqual({ token: "123:ABC", chatId: "456" })
  })

  test("returns null telegram when only token is set", () => {
    const cfg = loadConfig({ PILOT_TELEGRAM_TOKEN: "123:ABC" })
    expect(cfg.telegram).toBeNull()
  })

  test("returns null telegram when only chat ID is set", () => {
    const cfg = loadConfig({ PILOT_TELEGRAM_CHAT_ID: "456" })
    expect(cfg.telegram).toBeNull()
  })

  test("throws ConfigError on invalid tunnel provider", () => {
    expect(() => loadConfig({ PILOT_TUNNEL: "frp" })).toThrow(ConfigError)
  })

  test("parses dev mode", () => {
    const cfg = loadConfig({ PILOT_DEV: "true" })
    expect(cfg.dev).toBe(true)
  })

  test("vapid is null when either key is missing", () => {
    expect(loadConfig({}).vapid).toBeNull()
    expect(loadConfig({ PILOT_VAPID_PUBLIC_KEY: "pub" }).vapid).toBeNull()
    expect(loadConfig({ PILOT_VAPID_PRIVATE_KEY: "priv" }).vapid).toBeNull()
  })

  test("vapid is populated when both keys are present", () => {
    const cfg = loadConfig({
      PILOT_VAPID_PUBLIC_KEY: "pub",
      PILOT_VAPID_PRIVATE_KEY: "priv",
    })
    expect(cfg.vapid).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:admin@opencode-pilot.local",
    })
  })

  test("vapid subject is overridable", () => {
    const cfg = loadConfig({
      PILOT_VAPID_PUBLIC_KEY: "pub",
      PILOT_VAPID_PRIVATE_KEY: "priv",
      PILOT_VAPID_SUBJECT: "mailto:me@example.com",
    })
    expect(cfg.vapid?.subject).toBe("mailto:me@example.com")
  })

  test("enableGlobOpener defaults to false", () => {
    expect(loadConfig({}).enableGlobOpener).toBe(false)
  })

  test("enableGlobOpener is true when flag is set", () => {
    expect(loadConfig({ PILOT_ENABLE_GLOB_OPENER: "true" }).enableGlobOpener).toBe(true)
  })

  test("fetchTimeoutMs defaults to 10000", () => {
    expect(loadConfig({}).fetchTimeoutMs).toBe(10_000)
  })

  test("fetchTimeoutMs parses PILOT_FETCH_TIMEOUT_MS", () => {
    expect(loadConfig({ PILOT_FETCH_TIMEOUT_MS: "25000" }).fetchTimeoutMs).toBe(25_000)
  })
})

describe("mergeStoredSettings", () => {
  test("stored values override base when shell does not set them", () => {
    const base = {}
    const shell = {}
    const stored = { port: 5050, host: "0.0.0.0", tunnel: "cloudflared" as const }
    const merged = mergeStoredSettings(base, shell, stored)
    expect(merged.PILOT_PORT).toBe("5050")
    expect(merged.PILOT_HOST).toBe("0.0.0.0")
    expect(merged.PILOT_TUNNEL).toBe("cloudflared")
  })

  test("shell env always wins over stored", () => {
    const shell = { PILOT_PORT: "9000" }
    const base = { PILOT_PORT: "9000" }
    const stored = { port: 5050 }
    const merged = mergeStoredSettings(base, shell, stored)
    expect(merged.PILOT_PORT).toBe("9000")
  })

  test("serializes booleans as 'true'/'false'", () => {
    const merged = mergeStoredSettings({}, {}, { enableGlobOpener: true })
    expect(merged.PILOT_ENABLE_GLOB_OPENER).toBe("true")
  })

  test("skips undefined stored values", () => {
    const merged = mergeStoredSettings({}, {}, {})
    expect(merged.PILOT_PORT).toBeUndefined()
  })
})

describe("resolveSources", () => {
  test("classifies as shell-env when set in shell", () => {
    const sources = resolveSources({ PILOT_PORT: "8080" }, [], {})
    expect(sources.port).toBe("shell-env")
  })

  test("classifies as settings-store when stored and not in shell", () => {
    const sources = resolveSources({}, [], { port: 8080 })
    expect(sources.port).toBe("settings-store")
  })

  test("classifies as env-file when only the .env provided it", () => {
    const sources = resolveSources({}, ["PILOT_PORT"], {})
    expect(sources.port).toBe("env-file")
  })

  test("classifies as default when nothing provided a value", () => {
    const sources = resolveSources({}, [], {})
    expect(sources.port).toBe("default")
  })

  test("shell-env outranks settings-store", () => {
    const sources = resolveSources({ PILOT_PORT: "9000" }, [], { port: 8080 })
    expect(sources.port).toBe("shell-env")
  })

  test("settings-store outranks env-file", () => {
    const sources = resolveSources({}, ["PILOT_PORT"], { port: 8080 })
    expect(sources.port).toBe("settings-store")
  })
})

// ── Batch 5: parseProjectStateMode + PILOT_PROJECT_STATE in loadConfig ────────

describe("parseProjectStateMode", () => {
  test("accepts 'off', 'auto', 'always'", () => {
    expect(loadConfig({ PILOT_PROJECT_STATE: "off" }).projectStateMode).toBe("off")
    expect(loadConfig({ PILOT_PROJECT_STATE: "auto" }).projectStateMode).toBe("auto")
    expect(loadConfig({ PILOT_PROJECT_STATE: "always" }).projectStateMode).toBe("always")
  })

  test("returns 'auto' when PILOT_PROJECT_STATE is undefined", () => {
    expect(loadConfig({}).projectStateMode).toBe("auto")
  })

  test("throws ConfigError on invalid value (error names PILOT_PROJECT_STATE and lists valid values)", () => {
    let caught: Error | undefined
    try {
      loadConfig({ PILOT_PROJECT_STATE: "invalid" })
    } catch (e) {
      caught = e as Error
    }
    expect(caught).toBeInstanceOf(ConfigError)
    expect(caught!.message).toContain("PILOT_PROJECT_STATE")
    expect(caught!.message).toContain("off")
    expect(caught!.message).toContain("auto")
    expect(caught!.message).toContain("always")
  })
})

describe("loadConfig — PILOT_PROJECT_STATE integration", () => {
  test("loadConfig({ PILOT_PROJECT_STATE: 'off' }).projectStateMode === 'off'", () => {
    expect(loadConfig({ PILOT_PROJECT_STATE: "off" }).projectStateMode).toBe("off")
  })

  test("loadConfig({}).projectStateMode === 'auto' (default)", () => {
    expect(loadConfig({}).projectStateMode).toBe("auto")
  })

  test("RESTART_REQUIRED_FIELDS does NOT include projectStateMode (Decision 2)", () => {
    expect(RESTART_REQUIRED_FIELDS).not.toContain("projectStateMode")
  })
})

// ── Phase 2: codex hook config (codex-hooks-bridge) ──────────────────────────

describe("loadConfig — hookToken", () => {
  test("parses PILOT_HOOK_TOKEN into config.hookToken", () => {
    const cfg = loadConfig({ PILOT_HOOK_TOKEN: "mySecret123" })
    expect(cfg.hookToken).toBe("mySecret123")
  })

  test("hookToken is undefined when PILOT_HOOK_TOKEN not set", () => {
    const cfg = loadConfig({})
    expect(cfg.hookToken).toBeUndefined()
  })
})

describe("loadConfig — codexPermissionTimeoutMs", () => {
  test("parses PILOT_CODEX_PERMISSION_TIMEOUT_MS", () => {
    const cfg = loadConfig({ PILOT_CODEX_PERMISSION_TIMEOUT_MS: "60000" })
    expect(cfg.codexPermissionTimeoutMs).toBe(60_000)
  })

  test("falls back to PILOT_PERMISSION_TIMEOUT when PILOT_CODEX_PERMISSION_TIMEOUT_MS is missing", () => {
    const cfg = loadConfig({ PILOT_PERMISSION_TIMEOUT: "120000" })
    expect(cfg.codexPermissionTimeoutMs).toBe(120_000)
  })

  test("defaults to DEFAULT_CODEX_PERMISSION_TIMEOUT_MS (250000) when neither env var is set", () => {
    const cfg = loadConfig({})
    expect(cfg.codexPermissionTimeoutMs).toBe(DEFAULT_CODEX_PERMISSION_TIMEOUT_MS)
  })

  test("falls back to DEFAULT_CODEX_PERMISSION_TIMEOUT_MS when PILOT_PERMISSION_TIMEOUT equals DEFAULT_PERMISSION_TIMEOUT_MS (WARNING-01 + Fix-6 cap)", () => {
    // PILOT_PERMISSION_TIMEOUT=300000 equals DEFAULT_PERMISSION_TIMEOUT_MS, so fallback
    // uses DEFAULT_CODEX_PERMISSION_TIMEOUT_MS (250000), then caps at MAX (250000) — result is 250000.
    const cfg = loadConfig({ PILOT_PERMISSION_TIMEOUT: String(DEFAULT_PERMISSION_TIMEOUT_MS) })
    expect(cfg.codexPermissionTimeoutMs).toBe(DEFAULT_CODEX_PERMISSION_TIMEOUT_MS)
  })

  test("throws ConfigError when PILOT_CODEX_PERMISSION_TIMEOUT_MS is non-numeric", () => {
    expect(() => loadConfig({ PILOT_CODEX_PERMISSION_TIMEOUT_MS: "abc" })).toThrow(ConfigError)
  })

  test("throws ConfigError when PILOT_CODEX_PERMISSION_TIMEOUT_MS exceeds MAX_CODEX_PERMISSION_TIMEOUT_MS (300000)", () => {
    expect(() => loadConfig({ PILOT_CODEX_PERMISSION_TIMEOUT_MS: "300000" })).toThrow(ConfigError)
    const err = (() => {
      try {
        loadConfig({ PILOT_CODEX_PERMISSION_TIMEOUT_MS: "300000" })
      } catch (e) {
        return e as Error
      }
    })()
    expect(err).toBeInstanceOf(ConfigError)
    expect(err!.message).toContain("250000")
  })

  test("accepts PILOT_CODEX_PERMISSION_TIMEOUT_MS = MAX (250000)", () => {
    const cfg = loadConfig({ PILOT_CODEX_PERMISSION_TIMEOUT_MS: String(MAX_CODEX_PERMISSION_TIMEOUT_MS) })
    expect(cfg.codexPermissionTimeoutMs).toBe(MAX_CODEX_PERMISSION_TIMEOUT_MS)
  })

  test("DEFAULT_CODEX_PERMISSION_TIMEOUT_MS is 250000 (capped below Bun 255s idle timeout)", () => {
    expect(DEFAULT_CODEX_PERMISSION_TIMEOUT_MS).toBe(250_000)
    expect(DEFAULT_CODEX_PERMISSION_TIMEOUT_MS).toBeLessThanOrEqual(MAX_CODEX_PERMISSION_TIMEOUT_MS)
  })

  test("fallback via PILOT_PERMISSION_TIMEOUT is capped at MAX_CODEX_PERMISSION_TIMEOUT_MS", () => {
    // PILOT_PERMISSION_TIMEOUT > MAX should be capped, not thrown
    const cfg = loadConfig({ PILOT_PERMISSION_TIMEOUT: "400000" })
    expect(cfg.codexPermissionTimeoutMs).toBe(MAX_CODEX_PERMISSION_TIMEOUT_MS)
  })
})

describe("projectConfigToSettings", () => {
  test("flattens telegram + vapid into string fields", () => {
    const cfg = loadConfig({
      PILOT_TELEGRAM_TOKEN: "t",
      PILOT_TELEGRAM_CHAT_ID: "c",
      PILOT_VAPID_PUBLIC_KEY: "pub",
      PILOT_VAPID_PRIVATE_KEY: "priv",
    })
    const settings = projectConfigToSettings(cfg)
    expect(settings.telegramToken).toBe("t")
    expect(settings.telegramChatId).toBe("c")
    expect(settings.vapidPublicKey).toBe("pub")
    expect(settings.vapidPrivateKey).toBe("priv")
    expect(settings.vapidSubject).toBe("mailto:admin@opencode-pilot.local")
  })

  test("unset sensitive fields project to empty strings (safe for UI)", () => {
    const cfg = loadConfig({})
    const settings = projectConfigToSettings(cfg)
    expect(settings.telegramToken).toBe("")
    expect(settings.vapidPublicKey).toBe("")
  })
})
