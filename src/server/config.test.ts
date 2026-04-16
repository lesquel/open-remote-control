import { describe, expect, test } from "bun:test"
import { ConfigError, loadConfig } from "./config"
import { DEFAULT_HOST, DEFAULT_PERMISSION_TIMEOUT_MS, DEFAULT_PORT } from "./constants"

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
})
