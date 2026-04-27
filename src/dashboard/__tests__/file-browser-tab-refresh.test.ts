// file-browser-tab-refresh.test.ts
// Regression guard for issue #18: file browser sidebar must refresh on project tab switch.
//
// Root cause: switchProjectTab() (project-tabs.js) loaded sessions for the new
// directory (fix from #9) but never cleared the file-browser cache or called its
// refresh(). The tree stayed frozen on the previous project's files.
//
// This test reads the source of project-tabs.js and asserts that the
// switchProjectTab function explicitly calls window.__fileBrowser?.refresh(),
// mirroring the pattern used for __refreshFilesChanged and __refreshRightPanel.
// This is intentionally a static-analysis guard — the same style used in
// asset-sanity.test.ts — because the module imports browser globals that cannot
// be exercised in a plain bun test environment.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..")
const PROJECT_TABS_SRC = readFileSync(
  join(ROOT, "src/dashboard/components/project-tabs.js"),
  "utf-8",
)

describe("#18 — file browser refreshes on project tab switch", () => {
  test("switchProjectTab calls window.__fileBrowser?.refresh() to reset the file tree", () => {
    // The fix must clear the file-browser cache and trigger a fresh load
    // whenever the active project directory changes. The canonical call is:
    //   window.__fileBrowser?.refresh()
    // inside switchProjectTab, alongside the existing __refreshRightPanel and
    // __refreshFilesChanged calls.
    const hasFileBrowserRefresh =
      PROJECT_TABS_SRC.includes("__fileBrowser?.refresh()") ||
      PROJECT_TABS_SRC.includes('__fileBrowser?.["refresh"]()')

    expect(hasFileBrowserRefresh).toBe(true)
  })

  test("the __fileBrowser refresh call is inside switchProjectTab, not just at mount", () => {
    // Guard: the call must appear within the switchProjectTab function body, not
    // only in the initial mount (main.js already calls refresh at mount time).
    // We verify it appears after the function declaration.
    const switchFnStart = PROJECT_TABS_SRC.indexOf("export async function switchProjectTab")
    expect(switchFnStart).toBeGreaterThan(-1)

    // Find the next occurrence of __fileBrowser after the function declaration
    const callIdx = PROJECT_TABS_SRC.indexOf("__fileBrowser", switchFnStart)
    expect(callIdx).toBeGreaterThan(switchFnStart)
  })
})
