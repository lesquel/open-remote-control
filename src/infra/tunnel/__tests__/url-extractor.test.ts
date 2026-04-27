import { describe, test, expect } from "bun:test"
import { createUrlExtractor } from "../url-extractor"
import { TUNNEL_URL_PATTERNS } from "../constants"

describe("createUrlExtractor", () => {
  describe("cloudflared pattern", () => {
    test("extracts URL when entire URL arrives in a single chunk", () => {
      const extractor = createUrlExtractor(TUNNEL_URL_PATTERNS.cloudflared)
      expect(
        extractor.feed("Your tunnel is at https://abc-def.trycloudflare.com\n"),
      ).toBe("https://abc-def.trycloudflare.com")
    })

    test("returns null when chunk contains no URL", () => {
      const extractor = createUrlExtractor(TUNNEL_URL_PATTERNS.cloudflared)
      expect(extractor.feed("Starting cloudflared tunnel...\n")).toBeNull()
    })

    test("extracts URL split across two chunks (TCP fragmentation)", () => {
      const extractor = createUrlExtractor(TUNNEL_URL_PATTERNS.cloudflared)
      expect(extractor.feed("Your tunnel is at https://abc-d")).toBeNull()
      expect(extractor.feed("ef.trycloudflare.com\n")).toBe(
        "https://abc-def.trycloudflare.com",
      )
    })

    test("extracts URL split across three chunks", () => {
      const extractor = createUrlExtractor(TUNNEL_URL_PATTERNS.cloudflared)
      expect(extractor.feed("https://")).toBeNull()
      expect(extractor.feed("abc-def")).toBeNull()
      expect(extractor.feed(".trycloudflare.com rest of line\n")).toBe(
        "https://abc-def.trycloudflare.com",
      )
    })

    test("returns null after many chunks with no URL", () => {
      const extractor = createUrlExtractor(TUNNEL_URL_PATTERNS.cloudflared)
      expect(extractor.feed("line 1\n")).toBeNull()
      expect(extractor.feed("line 2\n")).toBeNull()
      expect(extractor.feed("line 3\n")).toBeNull()
    })

    test("caps buffer at maxBytes to prevent unbounded growth", () => {
      const maxBytes = 128
      const extractor = createUrlExtractor(TUNNEL_URL_PATTERNS.cloudflared, { maxBytes })
      // Fill buffer beyond cap with garbage — no URL ever appears
      const garbage = "x".repeat(maxBytes + 1)
      extractor.feed(garbage)
      // After the cap, a URL fragment that would only match when combined with
      // the overflowed prefix is NOT recovered — that is expected behaviour.
      // What we verify is that the extractor doesn't throw and keeps working.
      expect(extractor.feed("https://abc-def.trycloudflare.com\n")).toBe(
        "https://abc-def.trycloudflare.com",
      )
    })
  })

  describe("ngrok pattern", () => {
    test("extracts URL split across two chunks", () => {
      const extractor = createUrlExtractor(TUNNEL_URL_PATTERNS.ngrok)
      expect(extractor.feed("Forwarding https://abc-def.ng")).toBeNull()
      expect(extractor.feed("rok-free.app -> http://localhost:3000\n")).toBe(
        "https://abc-def.ngrok-free.app",
      )
    })
  })
})
