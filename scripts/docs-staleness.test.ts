import { describe, expect, test } from "bun:test"

async function text(path: string): Promise<string> {
  return Bun.file(new URL(`../${path}`, import.meta.url)).text()
}

describe("documentation staleness guards", () => {
  test("architecture separates release and protocol versions without freezing a release", async () => {
    const architecture = await text("docs/ARCHITECTURE.md")
    expect(architecture).not.toMatch(/\*\*Current version:\*\*\s*v?\d+\.\d+\.\d+/i)
    expect(architecture).toContain("Release automation keeps `package.json`")
    expect(architecture).toContain("Protocol compatibility versions evolve independently")
  })

  test("release guidance does not freeze a test count", async () => {
    const release = await text("docs/RELEASE.md")
    expect(release).not.toMatch(/\d+\+?\s+(?:tests|as of)/i)
  })

  test("historical product drafts label their version claims", async () => {
    const [readiness, pitch, landing] = await Promise.all([
      text("docs/PRODUCTION_READINESS.md"),
      text("docs/PITCH-FULL.md"),
      text("docs/LANDING-PAGE-CONTENT.md"),
    ])
    expect(readiness).toContain("Historical assessment")
    expect(pitch).toContain("Borrador histórico")
    expect(landing).toContain("Borrador histórico")
    expect(pitch).not.toContain("Versión actual:")
    expect(landing).not.toContain("| Versión actual |")
  })
})
