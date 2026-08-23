import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..")
const messages = readFileSync(join(root, "src/dashboard/components/messages.js"), "utf8")

describe("message disclosure accessibility contract", () => {
  test("reasoning and tool disclosures are keyboard-operable", () => {
    expect(messages).toMatch(/class="reasoning-header" role="button" tabindex="0" aria-expanded=/)
    expect(messages).toMatch(/class="tool-line tool-header" role="button" tabindex="0" aria-expanded=/)
    expect(messages).toContain("event.key==='Enter'||event.key===' '")
  })

  test("toggle state stays synchronized for assistive technology", () => {
    expect(messages).toContain(".reasoning-header')?.setAttribute('aria-expanded', String(expanded))")
    expect(messages).toContain(".tool-header')?.setAttribute('aria-expanded', String(expanded))")
    expect(messages).toContain('aria-controls="${escapeHtml(id)}-body"')
    expect(messages).toContain('aria-controls="${id}-body"')
  })

  test("todo pin actions include the item name", () => {
    expect(messages).toContain('aria-label="Pin todo: ${text}"')
  })
})
