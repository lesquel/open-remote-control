import { describe, expect, test } from "bun:test"

const dashboardRoot = new URL("../", import.meta.url)

async function source(path: string) {
  return Bun.file(new URL(path, dashboardRoot)).text()
}

describe("activity center wiring", () => {
  test("initializes an accessible header entry point", async () => {
    const [html, main] = await Promise.all([source("index.html"), source("main.js")])
    expect(html).toContain('id="activity-center-btn"')
    expect(html).toContain('aria-label="Activity center')
    expect(main).toContain("initActivityCenter()")
  })

  test("records attention events and resolves permissions", async () => {
    const sse = await source("sse/sse.js")
    expect(sse).toContain("key: `permission:${normalized.permissionID}`")
    expect(sse).toContain("resolveActivity(`permission:${resolvedNormalized.permissionID}`)")
    expect(sse).toContain("key: `completed:${messageId ?? evtSessionId}`")
    expect(sse).toContain("key: `error:${sessionId}:${Math.floor(Date.now() / 30_000)}`")
    expect(sse).toContain("key: `question:${question.id}`")
    expect(sse).toContain("resolveActivity(`question:${question.requestID ?? question.id}`)")
  })
})
