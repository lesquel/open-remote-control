// Regression guards for the dashboard bundle.
//
// Every bug in this file has already shipped at least once and broken
// real users. The tests below run as part of `bun test` (and via
// `prepublishOnly`) so a repeat incident can't silently make it onto
// npm. If a test here starts failing, don't patch around it — read the
// comment block and fix the underlying regression.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..")
const INDEX_HTML = readFileSync(join(ROOT, "src/server/dashboard/index.html"), "utf-8")
const SW_JS = readFileSync(join(ROOT, "src/server/dashboard/sw.js"), "utf-8")
const PACKAGE_JSON = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf-8"),
) as { version: string }
const PILOT_VERSION_RAW = readFileSync(join(ROOT, "src/server/constants.ts"), "utf-8")

describe("dashboard/index.html highlight.js bundle", () => {
  // Bug that shipped in 1.11 through 1.13.8: index.html loaded nine
  // highlight.js scripts from /lib/*.min.js. Those files are CommonJS
  // internals (module.exports, redeclared `const IDENT_RE`) and throw
  // `module is not defined` when loaded as browser <script> tags,
  // breaking every dashboard page. CHANGELOG 1.12.6 claimed this was
  // fixed; the actual edit never landed and the bug rode silently
  // through every release until 1.13.9.
  test("must not load highlight.js CommonJS internals (/lib/*.min.js)", () => {
    expect(INDEX_HTML).not.toMatch(
      /highlight\.js@[\d.]+\/lib\/(?:core|languages\/[a-z]+)\.min\.js/,
    )
  })

  test("must load the highlight.js UMD bundle (/build/highlight.min.js)", () => {
    expect(INDEX_HTML).toMatch(/highlight\.js@[\d.]+\/build\/highlight\.min\.js/)
  })
})

describe("dashboard/index.html self-healing cleanup", () => {
  // Users on very old versions (1.13.1 and earlier) registered a
  // cache-first service worker that pinned stale JS for weeks. The
  // self-heal script unregisters the SW and wipes caches on first
  // load after an upgrade. Keep it wired up; without it returning
  // users on any pre-1.13.9 install will keep seeing bugs we've
  // already shipped fixes for.
  test("self-heal script is present", () => {
    expect(INDEX_HTML).toMatch(/pilot:asset-gen/)
    expect(INDEX_HTML).toMatch(/getRegistrations/)
    expect(INDEX_HTML).toMatch(/caches\.keys/)
  })

  test("self-heal version marker matches package.json::version", () => {
    const match = INDEX_HTML.match(/var\s+GEN\s*=\s*"([^"]+)"/)
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe(PACKAGE_JSON.version)
  })
})

describe("dashboard/sw.js cache naming", () => {
  // CACHE_NAME has to change whenever we ship a frontend regression
  // fix, otherwise the service worker's activate handler doesn't
  // know to evict the previous precache. The `pilot-vNN` shape is
  // hard-coded in install/activate; keep it monotonic so debugging
  // is easy.
  test("CACHE_NAME follows the pilot-vNN convention", () => {
    const match = SW_JS.match(/const\s+CACHE_NAME\s*=\s*"(pilot-v\d+)"/)
    expect(match).not.toBeNull()
  })
})

describe("version constants stay in sync", () => {
  // Bug from the 1.12 line: PILOT_VERSION was hardcoded at "1.12.8"
  // through 1.13.5 because nobody bumped it when the package.json
  // version moved. The dashboard's /health response then lied about
  // what the user was running, making bug reports misleading.
  test("constants.ts PILOT_VERSION matches package.json::version", () => {
    const match = PILOT_VERSION_RAW.match(
      /export\s+const\s+PILOT_VERSION\s*=\s*"([^"]+)"/,
    )
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe(PACKAGE_JSON.version)
  })
})
