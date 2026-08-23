import { describe, expect, test } from "bun:test"

const dashboardRoot = new URL("../", import.meta.url)

async function source(path: string) {
  return Bun.file(new URL(path, dashboardRoot)).text()
}

describe("notification preferences UI", () => {
  test("offers accessible controls for supported outbound event categories", async () => {
    const html = await source("index.html")
    for (const id of ["s-notify-permission", "s-notify-finished", "s-notify-errors"]) {
      expect(html).toContain(`for="${id}"`)
      expect(html).toContain(`id="${id}"`)
    }
  })

  test("loads and saves one typed preference object", async () => {
    const settings = await source("components/settings.js")
    expect(settings).toContain("const preferences = settings.notificationPreferences ?? {}")
    expect(settings).toContain("patch.notificationPreferences = {")
  })
})
