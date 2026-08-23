import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveContainedFile } from "./contained-file"

describe("resolveContainedFile", () => {
  let sandbox: string
  let root: string

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "pilot-contained-file-"))
    root = join(sandbox, "project")
    mkdirSync(root)
  })

  afterEach(() => rmSync(sandbox, { recursive: true, force: true }))

  test("returns the canonical path for a regular file inside root", () => {
    const file = join(root, "images", "result.png")
    mkdirSync(join(root, "images"))
    writeFileSync(file, "png")
    const result = resolveContainedFile(root, file)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.path).toBe(file)
  })

  test("rejects traversal and prefix-sibling escapes", () => {
    const outside = join(sandbox, "project-secret.png")
    writeFileSync(outside, "secret")
    expect(resolveContainedFile(root, join(root, "..", "project-secret.png"))).toEqual({
      ok: false,
      reason: "outside-root",
    })
  })

  test("rejects a symlink inside root that targets an outside file", () => {
    const outside = join(sandbox, "secret.png")
    const link = join(root, "safe-name.png")
    writeFileSync(outside, "secret")
    symlinkSync(outside, link)
    expect(resolveContainedFile(root, link)).toEqual({ ok: false, reason: "outside-root" })
  })

  test("rejects nested symlink directory chains that leave root", () => {
    const outsideDir = join(sandbox, "outside")
    mkdirSync(outsideDir)
    writeFileSync(join(outsideDir, "secret.png"), "secret")
    symlinkSync(outsideDir, join(root, "linked"), "dir")
    expect(resolveContainedFile(root, join(root, "linked", "secret.png"))).toEqual({
      ok: false,
      reason: "outside-root",
    })
  })

  test("rejects missing files, directories, relative paths, and null bytes", () => {
    expect(resolveContainedFile(root, join(root, "missing.png"))).toEqual({
      ok: false,
      reason: "not-found",
    })
    expect(resolveContainedFile(root, root)).toEqual({ ok: false, reason: "not-file" })
    expect(resolveContainedFile(root, "relative.png")).toEqual({ ok: false, reason: "invalid" })
    expect(resolveContainedFile(root, `${root}/image.png\0secret`)).toEqual({
      ok: false,
      reason: "invalid",
    })
  })
})
