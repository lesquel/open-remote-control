import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Logger } from "../util/logger"
import { createSettingsStore } from "./settings-store"

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

describe("settings-store", () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "opencode-pilot-settings-"))
    path = join(dir, "config.json")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("load returns empty object when file does not exist", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    expect(store.load()).toEqual({})
    expect(existsSync(path)).toBe(false)
  })

  test("save creates the file and the parent directory", () => {
    const nested = join(dir, "nested", "config.json")
    const store = createSettingsStore({ logger: silentLogger, filePath: nested })
    store.save({ port: 5050 })
    expect(existsSync(nested)).toBe(true)
    expect(store.load()).toEqual({ port: 5050 })
  })

  test("save merges with existing settings (patch semantics)", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    store.save({ port: 5050, host: "0.0.0.0" })
    store.save({ host: "127.0.0.1" })
    expect(store.load()).toEqual({ port: 5050, host: "127.0.0.1" })
  })

  test("save drops unknown keys", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    store.save({
      port: 5050,
      // @ts-expect-error — intentional unknown key
      nope: "dropped",
    })
    expect(store.load()).toEqual({ port: 5050 })
  })

  test("save drops invalid types (type-level sanitization)", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    // @ts-expect-error — port should be number
    store.save({ port: "not-a-number" })
    expect(store.load()).toEqual({})
  })

  test("save accepts the tunnel enum values only", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    store.save({ tunnel: "cloudflared" })
    expect(store.load().tunnel).toBe("cloudflared")
    // @ts-expect-error — invalid enum
    store.save({ tunnel: "frp" })
    expect(store.load().tunnel).toBe("cloudflared") // unchanged
  })

  test("reset deletes the file", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    store.save({ port: 5050 })
    expect(existsSync(path)).toBe(true)
    store.reset()
    expect(existsSync(path)).toBe(false)
    expect(store.load()).toEqual({})
  })

  test("reset is a no-op when file is absent", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    // Should not throw
    store.reset()
    expect(existsSync(path)).toBe(false)
  })

  test("load tolerates a corrupted file", () => {
    writeFileSync(path, "not json at all {{{", "utf-8")
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    expect(store.load()).toEqual({})
  })

  test("filePath returns the configured path", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    expect(store.filePath()).toBe(path)
  })

  test("save is atomic — no .tmp file left on disk", () => {
    const store = createSettingsStore({ logger: silentLogger, filePath: path })
    store.save({ port: 5050 })
    expect(existsSync(path + ".tmp")).toBe(false)
  })
})
