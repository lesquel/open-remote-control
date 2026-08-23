import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..")
const sessions = readFileSync(join(root, "src/dashboard/components/sessions.js"), "utf8")

describe("session list accessibility contract", () => {
  test("session and folder rows are keyboard-operable controls", () => {
    expect(sessions).toMatch(/class="session-item[^`]+role="button" tabindex="0"/)
    expect(sessions).toMatch(/class="folder-row[^`]+role="button" tabindex="0" aria-expanded=/)
    expect(sessions).toContain("event.key !== 'Enter' && event.key !== ' '")
    expect(sessions).toContain("activateWithKeyboard(el, activate)")
    expect(sessions).toContain("activateWithKeyboard(el, toggle)")
  })

  test("folder disclosure state is exposed and synchronized", () => {
    expect(sessions).toContain("el.setAttribute('aria-expanded', String(!nowCollapsed))")
    expect(sessions).toContain("children.hidden = nowCollapsed")
  })

  test("delete controls identify their session", () => {
    expect(sessions).toContain('aria-label="Delete session: ${esc(title)}"')
  })
})
