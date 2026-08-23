import { describe, expect, test } from "bun:test"

async function text(path: string): Promise<string> {
  return Bun.file(new URL(`../${path}`, import.meta.url)).text()
}

describe("documentation staleness guards", () => {
  test("architecture delegates the product version to package.json", async () => {
    const architecture = await text("docs/ARCHITECTURE.md")
    expect(architecture).not.toMatch(/\*\*Current version:\*\*\s*v?\d+\.\d+\.\d+/i)
    expect(architecture).toContain("package.json` is the only source of truth")
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
