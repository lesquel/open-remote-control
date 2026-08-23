import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..")
const html = readFileSync(join(root, "src/dashboard/index.html"), "utf8")

describe("dashboard static accessibility contract", () => {
  test("header icon actions have meaningful accessible names", () => {
    for (const id of ["connect-phone-btn", "sidebar-toggle-btn", "info-toggle-btn", "settings-btn"]) {
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*aria-label="[^"]+"`))
    }
  })

  test("connection and permission status expose live context", () => {
    expect(html).toMatch(/id="conn-indicator"[^>]*role="status"[^>]*aria-live="polite"/)
    expect(html).toMatch(/id="perm-banner"[^>]*aria-labelledby="perm-title"/)
    expect(html).toMatch(/id="perm-banner"[^>]*aria-describedby="perm-detail perm-meta"/)
  })

  test("every settings toggle has an explicit text label", () => {
    for (const id of [
      "s-sound",
      "s-notif",
      "s-reasoning",
      "s-tools",
      "s-grid",
      "s-scanlines",
      "s-push-notif",
    ]) {
      expect(html).toContain(`<label for="${id}">`)
    }
  })
})
