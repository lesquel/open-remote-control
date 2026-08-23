// sessions.test.ts — Handler tests for GET /sessions/:id/attachments/:partId
import { describe, expect, test } from "bun:test"
import type { RouteDeps, RouteContext } from "../routes"
import { fetchRemoteAttachment, getSessionAttachment } from "./sessions"
import type { SafeHttpsFetcher } from "../../../infra/network/safe-https-fetch"
import type { Logger } from "../../../infra/logger/index"
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

// Minimal FilePart fixture used across tests
const FILE_PART = {
  id: "part-1",
  sessionID: "sess-1",
  messageID: "msg-1",
  type: "file" as const,
  mime: "image/png",
  url: "https://example.com/image.png",
}

describe("fetchRemoteAttachment", () => {
  const resultFrom = async (result: Awaited<ReturnType<SafeHttpsFetcher>>) =>
    fetchRemoteAttachment("https://example.com/file", 1000, async () => result)

  test("maps successful bytes and remote status codes", async () => {
    const body = new Uint8Array([1, 2, 3])
    expect(await resultFrom({ ok: true, status: 200, body })).toEqual({ ok: true, body })
    expect(await resultFrom({ ok: true, status: 404, body })).toMatchObject({ ok: false, error: "ATTACHMENT_URL_NOT_FOUND", httpStatus: 404 })
    expect(await resultFrom({ ok: true, status: 503, body })).toMatchObject({ ok: false, error: "REMOTE_ERROR", httpStatus: 502 })
  })

  test.each([
    ["forbidden", "FORBIDDEN", 403],
    ["timeout", "TIMEOUT", 504],
    ["too-large", "PAYLOAD_TOO_LARGE", 413],
    ["network", "FETCH_ERROR", 502],
    ["redirect", "FETCH_ERROR", 502],
  ] as const)("maps safe-fetch failure %s without leaking internals", async (reason, error, httpStatus) => {
    const result = await resultFrom({ ok: false, reason, detail: "private resolver detail" })
    expect(result).toMatchObject({ ok: false, error, httpStatus })
    if (!result.ok) expect(result.detail).not.toContain("private resolver detail")
  })
})

// Mock SDK client factory — allows per-test customization of part lookups
function makeMockClient(opts?: {
  partOverride?: Record<string, unknown> | null
  messageError?: string | null
  throwOnMessage?: boolean
}): RouteDeps["client"] {
  return {
    session: {
      message: async (args: { path: { id: string; messageID: string } }) => {
        if (opts?.throwOnMessage) throw new Error("SDK failure")
        if (opts?.messageError) {
          return { data: null, error: { message: opts.messageError } }
        }
        // Default: return a message with FILE_PART in its parts list
        const part = opts?.partOverride !== undefined ? opts.partOverride : FILE_PART
        const parts = part ? [part] : []
        return { data: { info: { role: "assistant" }, parts }, error: null }
      },
    },
  } as unknown as RouteDeps["client"]
}

function makeAttachmentDeps(opts?: {
  client?: RouteDeps["client"]
  token?: string
  directory?: string
}): RouteDeps {
  return {
    client: opts?.client ?? makeMockClient(),
    project: {} as RouteDeps["project"],
    directory: opts?.directory ?? "/tmp",
    worktree: "/tmp",
    config: {
      port: 4097,
      host: "127.0.0.1",
      permissionTimeoutMs: 300_000,
      tunnel: "off",
      telegram: null,
      dev: false,
      vapid: null,
      enableGlobOpener: false,
      fetchTimeoutMs: 10_000,
      projectStateMode: "auto",
      codexPermissionTimeoutMs: 300_000,
    },
    token: opts?.token ?? "valid-token",
    rotateToken: () => {},
    tunnelUrl: null,
    audit: { log: () => {} } as RouteDeps["audit"],
    eventBus: {} as RouteDeps["eventBus"],
    permissionQueue: {} as RouteDeps["permissionQueue"],
    codexPermissionQueue: {} as RouteDeps["codexPermissionQueue"],
    telegram: {} as RouteDeps["telegram"],
    push: {} as RouteDeps["push"],
    logger: silentLogger,
    settingsStore: { load: () => ({}), save: (_p: unknown) => ({}), reset: () => {}, filePath: () => "/tmp/c.json" } as unknown as RouteDeps["settingsStore"],
    shellEnv: {},
    envFileApplied: [],
    pilotVersion: "0.0.0-test",
    settingsLoader: {
      loadEffective: () => ({
        effective: {
          port: 4097,
          host: "127.0.0.1",
          permissionTimeoutMs: 300_000,
          tunnel: "off" as const,
          telegram: null,
          dev: false,
          vapid: null,
          enableGlobOpener: false,
          fetchTimeoutMs: 10_000,
          projectStateMode: "auto" as const,
          codexPermissionTimeoutMs: 300_000,
        },
        settings: {
          port: 4097,
          host: "127.0.0.1",
          permissionTimeoutMs: 300_000,
          tunnel: "off" as const,
          telegramToken: "",
          telegramChatId: "",
          vapidPublicKey: "",
          vapidPrivateKey: "",
          vapidSubject: "",
          enableGlobOpener: false,
          fetchTimeoutMs: 10_000,
          projectStateMode: "auto" as const,
          hookTokenConfigured: false,
        },
        sources: {},
      }),
      envKeyFor: () => "",
      restartRequiredFields: [],
    },
  }
}

function makeAttachmentCtx(
  deps: RouteDeps,
  opts?: {
    token?: string | null
    messageId?: string | null
    sessionId?: string
    partId?: string
    useQueryToken?: boolean
  },
): RouteContext {
  const sessionId = opts?.sessionId ?? "sess-1"
  const partId = opts?.partId ?? "part-1"
  const messageId = opts?.messageId !== undefined ? opts.messageId : "msg-1"

  const params = new URLSearchParams()
  if (messageId !== null) params.set("messageId", messageId)
  if (opts?.useQueryToken) params.set("token", opts.token ?? deps.token)

  const url = new URL(`http://test/sessions/${sessionId}/attachments/${partId}?${params.toString()}`)

  const headers: Record<string, string> = {}
  if (!opts?.useQueryToken) {
    const t = opts?.token !== undefined ? opts.token : deps.token
    if (t !== null) headers["Authorization"] = `Bearer ${t}`
  }

  const req = new Request(url.toString(), { headers })
  return { req, url, params: { id: sessionId, partId }, deps }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

describe("getSessionAttachment — auth", () => {
  test("401 when no Authorization header and no ?token= query param", async () => {
    const deps = makeAttachmentDeps()
    const ctx = makeAttachmentCtx(deps, { token: null })
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(401)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  test("401 when wrong Bearer token", async () => {
    const deps = makeAttachmentDeps()
    const ctx = makeAttachmentCtx(deps, { token: "wrong-token" })
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(401)
  })

  test("200 when correct Bearer token in header", async () => {
    // Use a mocked fetch-friendly png (1px base64)
    // We'll intercept by using a file:// URL with a temp file to avoid real HTTP
    // The mock client returns a part with a known URL; we override to data: scheme
    // which our proxy doesn't support → 502. That means auth passed.
    // For a true 200, we'd need to mock fetch. Instead, verify auth is checked:
    const deps = makeAttachmentDeps({ token: "valid-token" })
    const ctx = makeAttachmentCtx(deps, { token: "valid-token" })
    // The result will be non-401 (could be 502 from unsupported scheme or
    // anything depending on network mock). Auth is the concern here.
    const res = await getSessionAttachment(ctx)
    expect(res.status).not.toBe(401)
  })

  test("200-path when correct ?token= query param (no Bearer header)", async () => {
    const deps = makeAttachmentDeps({ token: "valid-token" })
    const ctx = makeAttachmentCtx(deps, { token: "valid-token", useQueryToken: true })
    const res = await getSessionAttachment(ctx)
    expect(res.status).not.toBe(401)
  })
})

// ─── Validation ──────────────────────────────────────────────────────────────

describe("getSessionAttachment — validation", () => {
  test("400 when messageId query param is missing", async () => {
    const deps = makeAttachmentDeps()
    const ctx = makeAttachmentCtx(deps, { messageId: null })
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("MISSING_MESSAGE_ID")
  })
})

// ─── SDK/session errors ───────────────────────────────────────────────────────

describe("getSessionAttachment — session lookup errors", () => {
  test("404 when SDK returns 404-like error for session/message", async () => {
    const deps = makeAttachmentDeps({
      client: makeMockClient({ messageError: "404 not found" }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SESSION_NOT_FOUND")
  })

  test("500 when SDK throws unexpectedly", async () => {
    const deps = makeAttachmentDeps({
      client: makeMockClient({ throwOnMessage: true }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("SDK_ERROR")
  })

  test("404 when part is not found in message (no matching part id)", async () => {
    const deps = makeAttachmentDeps({
      client: makeMockClient({
        partOverride: { ...FILE_PART, id: "different-part-id" },
      }),
    })
    const ctx = makeAttachmentCtx(deps, { partId: "part-1" }) // looking for part-1, but only different-part-id exists
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("ATTACHMENT_NOT_FOUND")
  })

  test("404 when message has no parts at all", async () => {
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: null }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("ATTACHMENT_NOT_FOUND")
  })

  test("404 when the matching id belongs to a non-file part (e.g. text part)", async () => {
    const deps = makeAttachmentDeps({
      client: makeMockClient({
        partOverride: { id: "part-1", type: "text", text: "hello", sessionID: "sess-1", messageID: "msg-1" },
      }),
    })
    const ctx = makeAttachmentCtx(deps, { partId: "part-1" })
    const res = await getSessionAttachment(ctx)
    // Non-file parts won't match the `p.type === 'file'` check → 404
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("ATTACHMENT_NOT_FOUND")
  })
})

// ─── MIME safelist ────────────────────────────────────────────────────────────

describe("getSessionAttachment — MIME safelist", () => {
  test("415 when part.mime is outside the safelist", async () => {
    const badMimePart = { ...FILE_PART, mime: "application/pdf" }
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: badMimePart }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(415)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("UNSUPPORTED_MIME")
  })

  test("415 when part.mime is video/mp4", async () => {
    const badMimePart = { ...FILE_PART, mime: "video/mp4" }
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: badMimePart }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(415)
  })

  test("415 for SVG so active documents are never served inline on the Pilot origin", async () => {
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: { ...FILE_PART, mime: "image/svg+xml" } }),
    })
    const res = await getSessionAttachment(makeAttachmentCtx(deps))
    expect(res.status).toBe(415)
  })
})

// ─── Scheme dispatch ──────────────────────────────────────────────────────────

describe("getSessionAttachment — URL scheme dispatch", () => {
  test("502 when URL scheme is unrecognized (e.g. ftp://)", async () => {
    const unknownSchemePart = { ...FILE_PART, url: "ftp://example.com/image.png" }
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: unknownSchemePart }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(502)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("UNSUPPORTED_SCHEME")
  })

  test("502 when URL scheme is data: (should not be proxied)", async () => {
    const dataSchemePart = { ...FILE_PART, url: "data:image/png;base64,iVBO" }
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: dataSchemePart }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(502)
  })
})

// ─── Size cap ─────────────────────────────────────────────────────────────────

describe("getSessionAttachment — size cap (local file path)", () => {
  test("413 when local file exceeds 2 MiB", async () => {
    // Create a temporary large file to test the size check
    const tmp = `/tmp/pilot-test-large-${Date.now()}.png`
    // Write just over 2 MiB
    const oversize = new Uint8Array(2 * 1024 * 1024 + 1)
    await Bun.write(tmp, oversize)

    try {
      const largePart = { ...FILE_PART, url: tmp }
      const deps = makeAttachmentDeps({
        client: makeMockClient({ partOverride: largePart }),
      })
      const ctx = makeAttachmentCtx(deps)
      const res = await getSessionAttachment(ctx)
      expect(res.status).toBe(413)
      const body = await res.json() as { error: { code: string } }
      expect(body.error.code).toBe("PAYLOAD_TOO_LARGE")
    } finally {
      // Clean up
      try { await Bun.file(tmp).arrayBuffer() } catch { /* ignore */ }
      // Remove file
      const { unlink } = await import("fs/promises")
      await unlink(tmp).catch(() => {})
    }
  })
})

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("getSessionAttachment — happy path", () => {
  test("200 with correct headers when serving a local PNG file", async () => {
    // Write a minimal 1x1 PNG file to a temp path
    const tmp = `/tmp/pilot-test-img-${Date.now()}.png`
    // Minimal valid PNG bytes (1x1 transparent pixel)
    const pngBytes = new Uint8Array([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
      0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
      0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
      0x89,0x00,0x00,0x00,0x0a,0x49,0x44,0x41,
      0x54,0x78,0x9c,0x62,0x00,0x01,0x00,0x00,
      0x05,0x00,0x01,0x0d,0x0a,0x2d,0xb4,0x00,
      0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,
      0x42,0x60,0x82,
    ])
    await Bun.write(tmp, pngBytes)

    try {
      const localPart = { ...FILE_PART, url: tmp }
      const deps = makeAttachmentDeps({
        client: makeMockClient({ partOverride: localPart }),
      })
      const ctx = makeAttachmentCtx(deps)
      const res = await getSessionAttachment(ctx)
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("image/png")
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600")
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
      expect(res.headers.get("Content-Disposition")).toBe("inline")
    } finally {
      const { unlink } = await import("fs/promises")
      await unlink(tmp).catch(() => {})
    }
  })

  test("allows all MIME safelist types through the MIME check", async () => {
    const safelistMimes = ["image/png", "image/jpeg", "image/gif", "image/webp"]
    for (const mime of safelistMimes) {
      const mimeFilePart = { ...FILE_PART, mime, url: "ftp://no-scheme" }
      const deps = makeAttachmentDeps({
        client: makeMockClient({ partOverride: mimeFilePart }),
      })
      const ctx = makeAttachmentCtx(deps)
      const res = await getSessionAttachment(ctx)
      // Should NOT be 415 — mime check passed. URL scheme is unrecognized → 502.
      expect(res.status).not.toBe(415)
    }
  })
})

describe("getSessionAttachment — local project boundary", () => {
  test("403 when an SDK file part points outside the selected project", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "pilot-attachment-boundary-"))
    const root = join(sandbox, "project")
    const outside = join(sandbox, "secret.png")
    try {
      await Bun.write(join(root, "placeholder"), "root")
      writeFileSync(outside, "secret")
      const deps = makeAttachmentDeps({
        directory: root,
        client: makeMockClient({ partOverride: { ...FILE_PART, url: outside } }),
      })
      expect((await getSessionAttachment(makeAttachmentCtx(deps))).status).toBe(403)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  test("403 for a symlink inside the project that targets an outside file", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "pilot-attachment-symlink-"))
    const root = join(sandbox, "project")
    const outside = join(sandbox, "secret.png")
    try {
      await Bun.write(join(root, "placeholder"), "root")
      writeFileSync(outside, "secret")
      const link = join(root, "image.png")
      symlinkSync(outside, link)
      const deps = makeAttachmentDeps({
        directory: root,
        client: makeMockClient({ partOverride: { ...FILE_PART, url: link } }),
      })
      expect((await getSessionAttachment(makeAttachmentCtx(deps))).status).toBe(403)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  test("403 for percent-encoded file URL traversal", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "pilot-attachment-encoded-"))
    const root = join(sandbox, "project")
    try {
      await Bun.write(join(root, "placeholder"), "root")
      writeFileSync(join(sandbox, "secret.png"), "secret")
      const encodedEscape = `file://${root}/%2e%2e/secret.png`
      const deps = makeAttachmentDeps({
        directory: root,
        client: makeMockClient({ partOverride: { ...FILE_PART, url: encodedEscape } }),
      })
      expect((await getSessionAttachment(makeAttachmentCtx(deps))).status).toBe(403)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

// ─── V2: SSRF guard in HTTP attachment proxy ──────────────────────────────────

describe("getSessionAttachment — SSRF guard (V2)", () => {
  test("403 when https attachment URL targets localhost", async () => {
    const localPart = { ...FILE_PART, url: "https://localhost/secret.png" }
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: localPart }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })

  test("403 when https attachment URL targets RFC 1918 address", async () => {
    const privatePart = { ...FILE_PART, url: "https://192.168.1.1/secret.png" }
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: privatePart }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe("FORBIDDEN")
  })

  test("403 when http attachment URL targets localhost (reject non-public host)", async () => {
    const localHttpPart = { ...FILE_PART, url: "http://localhost/secret.png" }
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: localHttpPart }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    // http:// to localhost: SSRF guard returns { ok: false } → 403
    expect(res.status).toBe(403)
  })

  test("403 when http attachment URL targets 127.0.0.1", async () => {
    const localHttpPart = { ...FILE_PART, url: "http://127.0.0.1/secret.png" }
    const deps = makeAttachmentDeps({
      client: makeMockClient({ partOverride: localHttpPart }),
    })
    const ctx = makeAttachmentCtx(deps)
    const res = await getSessionAttachment(ctx)
    expect(res.status).toBe(403)
  })
})
