// Regression guards for the dashboard bundle.
//
// Every bug in this file has already shipped at least once and broken
// real users. The tests below run as part of `bun test` (and via
// `prepublishOnly`) so a repeat incident can't silently make it onto
// npm. If a test here starts failing, don't patch around it — read the
// comment block and fix the underlying regression.

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..")
const INDEX_HTML = readFileSync(join(ROOT, "src/dashboard/index.html"), "utf-8")
const BOOTSTRAP_JS = readFileSync(join(ROOT, "src/dashboard/bootstrap.js"), "utf-8")
const SW_JS = readFileSync(join(ROOT, "src/dashboard/sw.js"), "utf-8")
const PACKAGE_JSON = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf-8"),
) as { version: string }
const PILOT_VERSION_RAW = readFileSync(join(ROOT, "src/server/constants.ts"), "utf-8")
const DEPLOY_WORKFLOW = readFileSync(join(ROOT, ".github/workflows/deploy-pwa.yml"), "utf-8")

describe("PWA deployment source", () => {
  test("watches and copies the canonical dashboard directory", () => {
    expect(DEPLOY_WORKFLOW).toContain("'src/dashboard/**'")
    expect(DEPLOY_WORKFLOW).toContain("cp -r src/dashboard/. dist/")
    expect(DEPLOY_WORKFLOW).not.toContain("src/server/dashboard")
  })

  test("injects package version into the hosted dashboard", () => {
    expect(DEPLOY_WORKFLOW).toContain("- 'package.json'")
    expect(DEPLOY_WORKFLOW).toContain("__PILOT_ASSET_GENERATION__")
    expect(DEPLOY_WORKFLOW).toContain("require('./package.json').version")
    expect(DEPLOY_WORKFLOW).toContain("source.replaceAll(placeholder, version)")
  })
})

describe("dashboard self-hosted runtime assets", () => {
  test("loads security-critical browser libraries locally, not from a CDN", () => {
    expect(INDEX_HTML).toContain('src="./vendor/marked.umd.js"')
    expect(INDEX_HTML).toContain('src="./vendor/purify.min.js"')
    expect(INDEX_HTML).toContain('src="./vendor/qrcode.js"')
    expect(INDEX_HTML).not.toMatch(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/)
  })

  test("ships the self-hosted vendor files", () => {
    for (const asset of ['marked.umd.js', 'purify.min.js', 'qrcode.js']) {
      expect(readFileSync(join(ROOT, 'src/dashboard/vendor', asset), 'utf-8').length).toBeGreaterThan(1_000)
    }
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
    expect(INDEX_HTML).toContain('src="./bootstrap.js?generation=__PILOT_ASSET_GENERATION__"')
    expect(BOOTSTRAP_JS).toMatch(/pilot:asset-gen/)
    expect(BOOTSTRAP_JS).toMatch(/getRegistrations/)
    expect(BOOTSTRAP_JS).toMatch(/caches\.keys/)
  })

  test("self-heal version marker is injected at serve/deploy time", () => {
    expect(INDEX_HTML).toContain('__PILOT_ASSET_GENERATION__')
    expect(INDEX_HTML).not.toContain(`generation=${PACKAGE_JSON.version}`)
  })
})

describe("dashboard/sw.js cache naming", () => {
  // As of 1.13.15 CACHE_NAME is a placeholder (`__PILOT_CACHE_VERSION__`)
  // that the server templates to `pilot-v<PILOT_VERSION>` at serve time.
  // This gives every release a unique cache key automatically — before
  // 1.13.15 the literal `pilot-v21` was manually maintained and drifted
  // version-over-version, letting stale dashboard assets survive upgrades
  // (one of the factors behind the 1.13.x "token inválido" family of
  // reports).
  //
  // The source file must carry the PLACEHOLDER — never a hardcoded
  // `pilot-v<N>` again — so the templating path always runs.
  test("CACHE_NAME uses the __PILOT_CACHE_VERSION__ placeholder (not a literal pilot-vNN)", () => {
    const placeholderMatch = SW_JS.match(
      /const\s+CACHE_NAME\s*=\s*"__PILOT_CACHE_VERSION__"/,
    )
    expect(placeholderMatch).not.toBeNull()

    // And no hardcoded pilot-v<N> literal may coexist — that would be
    // a forgotten debug leftover or a partial revert.
    const literalMatch = SW_JS.match(
      /const\s+CACHE_NAME\s*=\s*"pilot-v\d+"/,
    )
    expect(literalMatch).toBeNull()
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

describe("dashboard JS files must not hardcode PILOT_VERSION", () => {
  // Bug from 1.13.10: the release claimed hardcoded PILOT_VERSION was
  // structurally impossible, but the sanity guard only checked
  // src/server/constants.ts — not dashboard JS files. right-panel.js and
  // debug-modal.js still had `const PILOT_VERSION = '1.12.8'` hardcoded.
  //
  // After Commit 5 moved JS files into sub-folders (components/, modals/,
  // ui/, etc.), a non-recursive readdirSync only saw 3 of ~41 files. The
  // test now scans recursively so ALL JS files under src/dashboard/ are
  // checked — including those in sub-directories.
  test("no dashboard JS file contains a hardcoded PILOT_VERSION string literal", () => {
    const DASHBOARD_DIR = join(ROOT, "src/dashboard")
    // Hardcoded-version pattern: PILOT_VERSION = '...' or PILOT_VERSION = "..."
    const HARDCODED_VERSION_RE = /PILOT_VERSION\s*=\s*['"][0-9]+\.[0-9]+\.[0-9]+['"]/

    // Recursive scan: covers root-level AND sub-folder JS files (components/,
    // modals/, ui/, etc.) so the regression guard is not silently disarmed
    // when new JS files are added to sub-directories.
    const allEntries = readdirSync(DASHBOARD_DIR, { recursive: true }) as string[]
    const offenders: string[] = []
    for (const entry of allEntries) {
      if (!entry.endsWith(".js")) continue
      const content = readFileSync(join(DASHBOARD_DIR, entry), "utf-8")
      if (HARDCODED_VERSION_RE.test(content)) {
        offenders.push(entry)
      }
    }

    expect(offenders).toEqual([])
  })
})
