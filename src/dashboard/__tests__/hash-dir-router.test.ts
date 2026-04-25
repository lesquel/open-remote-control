// Tests for hash-dir-router — pure functions that parse #dir= from the URL hash
// and decide what tab action to take.
//
// These run in Node/Bun without a browser DOM. The functions are pure so no
// mocking of window.location is needed.

import { describe, expect, test } from "bun:test"
import { resolveDirFromHash, resolveTabAction } from "../routing/hash-dir-router"

// ── resolveDirFromHash ────────────────────────────────────────────────────────

describe("resolveDirFromHash — parsing", () => {
  test("returns ok dir for a valid hash", () => {
    const result = resolveDirFromHash("#dir=%2Fhome%2Fuser%2Fproject")
    expect(result).toEqual({ ok: true, dir: "/home/user/project" })
  })

  test("returns ok dir for a hash with spaces encoded as %20", () => {
    const result = resolveDirFromHash("#dir=%2Fhome%2Fuser%2Fmy%20project")
    expect(result).toEqual({ ok: true, dir: "/home/user/my project" })
  })

  test("returns ok:false when hash is empty string", () => {
    const result = resolveDirFromHash("")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("empty")
  })

  test("returns ok:false when hash has no dir param", () => {
    const result = resolveDirFromHash("#connect=abc123")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("no dir param")
  })

  test("returns ok:false for path traversal (.. segment)", () => {
    const traversal = "#dir=" + encodeURIComponent("/home/user/../etc/passwd")
    const result = resolveDirFromHash(traversal)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("traversal")
  })

  test("returns ok:false for path with null byte", () => {
    const withNull = "#dir=" + encodeURIComponent("/home/user/project\x00evil")
    const result = resolveDirFromHash(withNull)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("null byte")
  })

  test("returns ok:false when decoded dir is empty string", () => {
    const result = resolveDirFromHash("#dir=")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("empty")
  })

  test("returns ok:false when decoded dir is longer than 512 chars", () => {
    const longPath = "/home/user/" + "a".repeat(510)
    const result = resolveDirFromHash("#dir=" + encodeURIComponent(longPath))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("too long")
  })

  test("returns ok:false when URL decoding fails (malformed percent sequence)", () => {
    // %ZZ is not valid percent-encoding
    const result = resolveDirFromHash("#dir=%ZZ%ZZ")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("decode")
  })
})

// ── resolveTabAction ──────────────────────────────────────────────────────────

// A minimal stub for ProjectTab objects as state.js would produce them.
interface StubTab {
  id: string
  directory: string | null
  label: string
}

describe("resolveTabAction — tab routing", () => {
  const tabs: StubTab[] = [
    { id: "tab-aaa", directory: "/home/user/projectA", label: "projectA" },
    { id: "tab-bbb", directory: "/home/user/projectB", label: "projectB" },
    { id: "tab-ccc", directory: null, label: "default" },
  ]

  test("returns activate when a tab with the matching directory already exists", () => {
    const result = resolveTabAction("/home/user/projectA", tabs)
    expect(result).toEqual({ action: "activate", tabId: "tab-aaa" })
  })

  test("returns activate for the second existing tab", () => {
    const result = resolveTabAction("/home/user/projectB", tabs)
    expect(result).toEqual({ action: "activate", tabId: "tab-bbb" })
  })

  test("returns create for a directory not in the tab list", () => {
    const result = resolveTabAction("/home/user/projectC", tabs)
    expect(result.action).toBe("create")
    if (result.action === "create") {
      expect(result.dir).toBe("/home/user/projectC")
      expect(result.label).toBe("projectC") // basename of the path
    }
  })

  test("label for create uses the last path segment", () => {
    const result = resolveTabAction("/var/code/my-awesome-app", [])
    if (result.action === "create") {
      expect(result.label).toBe("my-awesome-app")
    }
  })

  test("label for create falls back to full path when no slash segment", () => {
    const result = resolveTabAction("myproject", [])
    if (result.action === "create") {
      expect(result.label).toBe("myproject")
    }
  })

  test("returns create when tab list is empty", () => {
    const result = resolveTabAction("/home/user/projectA", [])
    expect(result.action).toBe("create")
  })
})
