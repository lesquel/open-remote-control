// file-part.test.ts — Unit tests for renderFilePart logic.
//
// The renderer lives in src/dashboard/components/messages.js and depends on
// browser-only modules (state.js, markdown.js, etc.). Following the established
// pattern in normalizeMessage.test.ts, we replicate the pure logic here so the
// test suite can run in Bun without a DOM. Any change to renderFilePart or
// buildAttachmentUrl in messages.js MUST be reflected here.
import { describe, it, expect } from "bun:test"

// ── Inline replicas of the pure logic (must match messages.js exactly) ─────────

const ATTACHMENT_MIME_SAFELIST = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

// Minimal state shape needed for URL construction
interface MockState {
  token: string
  serverUrl: string
  activeDirectory: string | null
}

function buildAttachmentUrl(
  part: { id: string; sessionID: string; messageID: string },
  state: MockState,
): string {
  const base = state.serverUrl || ""
  const token = state.token || ""
  const dir = state.activeDirectory
  const params = new URLSearchParams({ messageId: part.messageID, token })
  if (dir) params.set("directory", dir)
  return `${base}/sessions/${encodeURIComponent(part.sessionID)}/attachments/${encodeURIComponent(part.id)}?${params.toString()}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function renderFilePart(
  part: { id: string; sessionID: string; messageID: string; mime?: string; filename?: string },
  state: MockState,
): string {
  const mime = part.mime ?? ""
  const filename = part.filename ?? "attachment"

  if (!ATTACHMENT_MIME_SAFELIST.has(mime)) {
    const href = escapeHtml(buildAttachmentUrl(part, state))
    return `<div class="file-part file-part--link"><a href="${href}" target="_blank" rel="noopener noreferrer" class="file-part-link">[attachment: ${escapeHtml(filename)}]</a></div>`
  }

  const src = escapeHtml(buildAttachmentUrl(part, state))
  const alt = escapeHtml(filename)
  return `<div class="file-part file-part--image"><img src="${src}" alt="${alt}" loading="lazy" style="max-width:100%;max-height:480px;display:block;border-radius:var(--radius,2px)" /></div>`
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_STATE: MockState = {
  token: "test-token",
  serverUrl: "",
  activeDirectory: null,
}

const BASE_PART = {
  id: "part-1",
  sessionID: "sess-1",
  messageID: "msg-1",
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renderFilePart — safelist mime types produce <img>", () => {
  const safelistMimes = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ] as const

  for (const mime of safelistMimes) {
    it(`renders <img> for ${mime}`, () => {
      const part = { ...BASE_PART, mime, filename: "test.img" }
      const html = renderFilePart(part, DEFAULT_STATE)
      expect(html).toContain("<img ")
      expect(html).toContain(`loading="lazy"`)
      expect(html).toContain("file-part--image")
      expect(html).not.toContain("<a ")
    })
  }
})

describe("renderFilePart — active SVG documents are not rendered inline", () => {
  it("SVG mime type produces only the unsupported attachment link", () => {
    const part = { ...BASE_PART, mime: "image/svg+xml", filename: "diagram.svg" }
    const html = renderFilePart(part, DEFAULT_STATE)

    expect(html).toContain("<a ")
    expect(html).not.toContain("<img ")
    expect(html).not.toMatch(/<object/)
    expect(html).not.toMatch(/<embed/)
    expect(html).not.toMatch(/<iframe/)
    // The HTML string itself must not contain raw <svg> tags (which would be
    // injected if someone called innerHTML on the result).
    expect(html).not.toMatch(/<svg/)
  })

  it("SVG filename is escaped in link text", () => {
    const part = { ...BASE_PART, mime: "image/svg+xml", filename: '<script>alert(1)</script>' }
    const html = renderFilePart(part, DEFAULT_STATE)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })
})

describe("renderFilePart — unknown / unsupported mime falls back to text link", () => {
  const unsupportedMimes = [
    "application/pdf",
    "video/mp4",
    "audio/mpeg",
    "text/plain",
    "application/octet-stream",
    "image/svg+xml",
    "",
  ]

  for (const mime of unsupportedMimes) {
    it(`renders a text link (not <img>) for mime="${mime}"`, () => {
      const part = { ...BASE_PART, mime, filename: "attachment.bin" }
      const html = renderFilePart(part, DEFAULT_STATE)
      expect(html).toContain("<a ")
      expect(html).toContain("file-part--link")
      expect(html).not.toContain("<img ")
    })
  }
})

describe("renderFilePart — URL construction includes required query params", () => {
  it("includes ?messageId= in the URL", () => {
    const part = { ...BASE_PART, mime: "image/png", filename: "img.png" }
    const html = renderFilePart(part, DEFAULT_STATE)
    expect(html).toContain("messageId=msg-1")
  })

  it("includes ?token= in the URL", () => {
    const state: MockState = { ...DEFAULT_STATE, token: "my-secret-token" }
    const part = { ...BASE_PART, mime: "image/png", filename: "img.png" }
    const html = renderFilePart(part, state)
    expect(html).toContain("token=my-secret-token")
  })

  it("includes the sessionID in the URL path", () => {
    const part = { ...BASE_PART, sessionID: "session-xyz", mime: "image/png", filename: "img.png" }
    const html = renderFilePart(part, DEFAULT_STATE)
    expect(html).toContain("/sessions/session-xyz/attachments/")
  })

  it("includes the part id in the URL path", () => {
    const part = { ...BASE_PART, id: "unique-part-42", mime: "image/png", filename: "img.png" }
    const html = renderFilePart(part, DEFAULT_STATE)
    expect(html).toContain("/attachments/unique-part-42")
  })

  it("includes the serverUrl prefix when in standalone mode", () => {
    const state: MockState = { ...DEFAULT_STATE, serverUrl: "https://abc.trycloudflare.com" }
    const part = { ...BASE_PART, mime: "image/png", filename: "img.png" }
    const html = renderFilePart(part, state)
    expect(html).toContain("https://abc.trycloudflare.com/sessions/")
  })

  it("includes ?directory= when activeDirectory is set", () => {
    const state: MockState = { ...DEFAULT_STATE, activeDirectory: "/home/user/project" }
    const part = { ...BASE_PART, mime: "image/png", filename: "img.png" }
    const html = renderFilePart(part, state)
    expect(html).toContain("directory=")
  })

  it("omits ?directory= when activeDirectory is null", () => {
    const state: MockState = { ...DEFAULT_STATE, activeDirectory: null }
    const part = { ...BASE_PART, mime: "image/png", filename: "img.png" }
    const html = renderFilePart(part, state)
    expect(html).not.toContain("directory=")
  })
})

describe("renderFilePart — HTML escaping in attributes", () => {
  it("escapes special characters in the filename (alt attribute)", () => {
    const part = { ...BASE_PART, mime: "image/png", filename: '"quotes" & <angle>' }
    const html = renderFilePart(part, DEFAULT_STATE)
    expect(html).not.toContain('"quotes"')
    expect(html).toContain("&quot;quotes&quot;")
    expect(html).toContain("&amp;")
    expect(html).toContain("&lt;angle&gt;")
  })

  it("defaults filename to 'attachment' when not provided", () => {
    const part = { ...BASE_PART, mime: "image/png" }
    const html = renderFilePart(part, DEFAULT_STATE)
    expect(html).toContain('alt="attachment"')
  })
})
