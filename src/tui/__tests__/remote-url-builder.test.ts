// Tests for buildDashboardUrl — the pure URL helper used by /remote, /dashboard, /remote-control.
//
// This helper must be testable without mocking xdg-open or spawning a process.
// All it does is take a base URL and a cwd and produce the final URL string.

import { describe, expect, test } from "bun:test"
import { buildDashboardUrl } from "../url-builder"

describe("buildDashboardUrl", () => {
  test("appends #dir fragment for a normal Unix path", () => {
    const url = buildDashboardUrl("http://127.0.0.1:4097/?token=abc", "/home/user/myproject")
    expect(url).toBe(
      "http://127.0.0.1:4097/?token=abc#dir=%2Fhome%2Fuser%2Fmyproject",
    )
  })

  test("encodes spaces and special characters in the path", () => {
    const url = buildDashboardUrl(
      "http://127.0.0.1:4097/?token=abc",
      "/home/user/my project/foo & bar",
    )
    expect(url).toBe(
      "http://127.0.0.1:4097/?token=abc#dir=%2Fhome%2Fuser%2Fmy%20project%2Ffoo%20%26%20bar",
    )
  })

  test("encodes path traversal characters (client forwards; server validates)", () => {
    // The client must NOT block ../ — it just encodes and sends. The dashboard's
    // resolveDirFromHash() is what rejects traversal attempts.
    const url = buildDashboardUrl(
      "http://127.0.0.1:4097/?token=abc",
      "/home/user/../etc/passwd",
    )
    expect(url).toContain("#dir=")
    expect(url).toContain("%2F..%2F")
  })

  test("returns the base URL unchanged when cwd is empty string", () => {
    const base = "http://127.0.0.1:4097/?token=abc"
    const url = buildDashboardUrl(base, "")
    expect(url).toBe(base)
  })

  test("returns the base URL unchanged when cwd is only whitespace", () => {
    const base = "http://127.0.0.1:4097/?token=abc"
    const url = buildDashboardUrl(base, "   ")
    expect(url).toBe(base)
  })

  test("does not add a second # when base URL already has a hash", () => {
    // In normal usage the base will not have a hash, but be defensive.
    const url = buildDashboardUrl(
      "http://127.0.0.1:4097/?token=abc#existingfrag",
      "/home/user/project",
    )
    // Must produce exactly one # in the output and the dir fragment must win.
    expect(url.split("#").length - 1).toBe(1)
    expect(url).toContain("dir=")
  })

  test("handles Windows-style paths (backslashes and drive letter)", () => {
    const url = buildDashboardUrl(
      "http://127.0.0.1:4097/?token=abc",
      "C:\\Users\\user\\myproject",
    )
    expect(url).toContain("#dir=")
    expect(url).not.toBe("http://127.0.0.1:4097/?token=abc")
  })
})
