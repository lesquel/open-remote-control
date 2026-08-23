import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..")
const html = readFileSync(join(root, "src/dashboard/index.html"), "utf8")
const palette = readFileSync(join(root, "src/dashboard/components/command-palette.js"), "utf8")
const styles = readFileSync(join(root, "src/dashboard/styles.css"), "utf8")

describe("command palette accessibility contract", () => {
  test("exposes combobox/listbox semantics", () => {
    expect(html).toMatch(/id="palette-input"[^>]*role="combobox"/)
    expect(html).toMatch(/id="palette-input"[^>]*aria-controls="palette-list"/)
    expect(html).toMatch(/id="palette-list"[^>]*role="listbox"/)
    expect(palette).toContain('role="option"')
    expect(palette).toContain("aria-activedescendant")
  })

  test("rebinds keyboard listeners whenever the palette opens", () => {
    const openBody = palette.slice(
      palette.indexOf("export function openPalette()"),
      palette.indexOf("export function closePalette()"),
    )
    expect(openBody).toContain("bindPaletteInputListeners()")
    expect(palette).toContain("cleanupPaletteListeners()")
  })

  test("permission actions use the actual IDs for mobile touch sizing", () => {
    expect(styles).toMatch(/#btn-allow,\s*#btn-deny\s*\{\s*min-height:\s*44px/)
  })
})
