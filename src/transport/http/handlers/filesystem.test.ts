// RED: filesystem handler hardening — A: glob pattern traversal
// Tests for /fs/glob pattern `..` rejection and post-glob containment.
//
// These tests exercise `globFiles` via a minimal fake RouteContext —
// no real HTTP server needed.

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { globFiles } from "./filesystem"

// ─── Fake RouteContext ────────────────────────────────────────────────────────

function makeCtx(
  params: Record<string, string | null>,
  dir: string,
  enableGlob = true,
): Parameters<typeof globFiles>[0] {
  const url = new URL("http://localhost/fs/glob")
  for (const [k, v] of Object.entries(params)) {
    if (v !== null) url.searchParams.set(k, v)
  }
  // Cast through unknown: the fake only supplies the fields that globFiles
  // actually reads. The full RouteDeps interface requires many injected deps
  // (client, permissionQueue, etc.) that globFiles never touches.
  return {
    url,
    req: new Request(url),
    params: {},
    deps: {
      config: {
        enableGlobOpener: enableGlob,
        dev: false,
      } as Parameters<typeof globFiles>[0]["deps"]["config"],
      directory: dir,
      worktree: dir,
      audit: {
        log: () => {},
      },
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    } as unknown as Parameters<typeof globFiles>[0]["deps"],
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("globFiles — pattern traversal guard (A)", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pilot-glob-test-"))
    // Create a real file inside to ensure a normal pattern works
    writeFileSync(join(dir, "hello.ts"), "export const x = 1")
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  })

  it("rejects a pattern containing .. with 403", async () => {
    const ctx = makeCtx({ pattern: "../../etc/*", cwd: dir }, dir)
    const res = await globFiles(ctx)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })

  it("rejects a pattern like ../../secrets/file.txt with 403", async () => {
    const ctx = makeCtx({ pattern: "../../secrets/file.txt" }, dir)
    const res = await globFiles(ctx)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })

  it("rejects an absolute pattern like /etc/* with 403", async () => {
    const ctx = makeCtx({ pattern: "/etc/*", cwd: dir }, dir)
    const res = await globFiles(ctx)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })

  it("rejects an absolute pattern like /root/secret with 403", async () => {
    const ctx = makeCtx({ pattern: "/root/secret" }, dir)
    const res = await globFiles(ctx)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })

  it("allows a normal pattern and returns matching files", async () => {
    const ctx = makeCtx({ pattern: "*.ts", cwd: dir }, dir)
    const res = await globFiles(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { files: Array<{ path: string; absolute: string }> }
    expect(body.files.length).toBeGreaterThanOrEqual(1)
    expect(body.files[0].path).toBe("hello.ts")
  })

  it("post-glob: results only contain paths inside cwd (belt-and-suspenders)", async () => {
    const ctx = makeCtx({ pattern: "*.ts", cwd: dir }, dir)
    const res = await globFiles(ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { files: Array<{ absolute: string }>; cwd: string }
    for (const file of body.files) {
      // Use proper path-segment boundary to avoid prefix collision:
      // e.g. cwd=/tmp/root must NOT match absolute=/tmp/root-evil/x.ts
      const cwdWithSlash = body.cwd.endsWith("/") ? body.cwd : body.cwd + "/"
      expect(
        file.absolute === body.cwd || file.absolute.startsWith(cwdWithSlash),
      ).toBe(true)
    }
  })

  it("returns 403 when glob is disabled", async () => {
    const ctx = makeCtx({ pattern: "*.ts" }, dir, false)
    const res = await globFiles(ctx)
    expect(res.status).toBe(403)
  })
})
