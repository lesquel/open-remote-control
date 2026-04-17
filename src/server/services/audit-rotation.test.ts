import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, existsSync, readFileSync, statSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { rmSync } from "fs"
import { rotateIfNeeded } from "./audit-rotation"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pilot-audit-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("rotateIfNeeded", () => {
  it("does nothing when file does not exist", () => {
    const logPath = join(dir, "pilot-audit.log")
    rotateIfNeeded(logPath, 100)
    expect(existsSync(logPath)).toBe(false)
  })

  it("does nothing when file is below threshold", () => {
    const logPath = join(dir, "pilot-audit.log")
    writeFileSync(logPath, "short content")
    rotateIfNeeded(logPath, 1000)
    expect(existsSync(logPath)).toBe(true)
    expect(existsSync(logPath + ".1")).toBe(false)
  })

  it("rotates when file exceeds threshold", () => {
    const logPath = join(dir, "pilot-audit.log")
    const content = "x".repeat(200)
    writeFileSync(logPath, content)
    rotateIfNeeded(logPath, 100)
    // original should now be gone (new empty file will be created on next write)
    expect(existsSync(logPath)).toBe(false)
    expect(existsSync(logPath + ".1")).toBe(true)
    expect(readFileSync(logPath + ".1", "utf-8")).toBe(content)
  })

  it("shifts existing rotated files: .1 → .2 → .3", () => {
    const logPath = join(dir, "pilot-audit.log")
    writeFileSync(logPath + ".2", "old-2")
    writeFileSync(logPath + ".1", "old-1")
    writeFileSync(logPath, "x".repeat(200))

    rotateIfNeeded(logPath, 100)

    expect(readFileSync(logPath + ".3", "utf-8")).toBe("old-2")
    expect(readFileSync(logPath + ".2", "utf-8")).toBe("old-1")
    expect(readFileSync(logPath + ".1", "utf-8")).toBe("x".repeat(200))
    expect(existsSync(logPath)).toBe(false)
  })

  it("drops .3 when it already exists (max 3 rotated)", () => {
    const logPath = join(dir, "pilot-audit.log")
    writeFileSync(logPath + ".3", "drop-me")
    writeFileSync(logPath + ".2", "old-2")
    writeFileSync(logPath + ".1", "old-1")
    writeFileSync(logPath, "x".repeat(200))

    rotateIfNeeded(logPath, 100)

    // .3 should be overwritten by what was .2
    expect(readFileSync(logPath + ".3", "utf-8")).toBe("old-2")
    expect(readFileSync(logPath + ".2", "utf-8")).toBe("old-1")
    expect(readFileSync(logPath + ".1", "utf-8")).toBe("x".repeat(200))
  })

  it("does not rotate when size equals threshold exactly (boundary)", () => {
    const logPath = join(dir, "pilot-audit.log")
    const content = "x".repeat(100)
    writeFileSync(logPath, content)
    rotateIfNeeded(logPath, 100)
    // size === threshold → do NOT rotate
    expect(existsSync(logPath)).toBe(true)
    expect(existsSync(logPath + ".1")).toBe(false)
  })
})
