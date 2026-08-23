import { describe, expect, test } from "bun:test"
import { buildUpdateReport, compareVersions, fetchLatestVersion } from "./update"

describe("update check", () => {
  test("compares stable and prerelease versions", () => {
    expect(compareVersions("1.21.1", "1.22.0")).toBeLessThan(0)
    expect(compareVersions("2.0.0", "1.99.0")).toBeGreaterThan(0)
    expect(compareVersions("1.22.0-beta.1", "1.22.0")).toBeLessThan(0)
    expect(compareVersions("1.22.0-beta.10", "1.22.0-beta.2")).toBeGreaterThan(0)
  })

  test("classifies current, outdated, and ahead installations", () => {
    expect(buildUpdateReport("1.21.1", "1.21.1").status).toBe("current")
    expect(buildUpdateReport("1.21.1", "1.22.0").status).toBe("update_available")
    expect(buildUpdateReport("2.0.0", "1.22.0").status).toBe("ahead")
  })

  test("reads and validates the npm latest tag", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ "dist-tags": { latest: "1.22.0" } }))
    expect(await fetchLatestVersion(fakeFetch)).toBe("1.22.0")
  })

  test("rejects malformed registry data", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ "dist-tags": { latest: "latest" } }))
    expect(fetchLatestVersion(fakeFetch)).rejects.toThrow("invalid latest version")
  })
})
