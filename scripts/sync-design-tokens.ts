#!/usr/bin/env bun
/**
 * sync-design-tokens.ts
 *
 * Vendors CSS design-token files from the remote-control-landing repo into
 * this package's dashboard directory, prepending a SHA-pinned header so
 * reviewers know what version of the upstream they're looking at.
 *
 * Usage:
 *   bun scripts/sync-design-tokens.ts
 *
 * Environment:
 *   LANDING_DIR  Path to the landing repo root. Default: ../opencode-landing
 *
 * Idempotency:
 *   The script always rewrites the output file from scratch (read upstream,
 *   build header, write). Re-running with the same landing SHA produces a
 *   byte-identical result.
 *
 * To add a file in a future sync (e.g. base.css, effects.css):
 *   Add one entry to FILES below — no other change needed.
 */

import { execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

// ---------------------------------------------------------------------------
// Configuration — add entries here to sync additional files
// ---------------------------------------------------------------------------

/** Map of: source file name (relative to landing's src/styles/) → destination
 *  path (relative to this repo's root). */
const FILES: Record<string, string> = {
  "tokens.css": "src/dashboard/tokens.css",
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANDING_REPO = "lesquel/remote-control-landing"
const LANDING_STYLES_DIR = "src/styles"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(message: string): never {
  console.error(`[sync-design-tokens] ERROR: ${message}`)
  process.exit(1)
}

function resolveLandingDir(): string {
  const env = process.env["LANDING_DIR"]
  const raw = env ?? "../opencode-landing"
  // Resolve relative to the script's working directory (repo root when called
  // via `bun scripts/sync-design-tokens.ts`).
  return resolve(process.cwd(), raw)
}

function resolveRepoRoot(): string {
  // __dirname is not available in ESM; use import.meta.url instead.
  return resolve(new URL("..", import.meta.url).pathname)
}

function getGitSha(repoPath: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    die(
      `Could not read HEAD SHA from "${repoPath}". ` +
        `Is it a git repository?\n  ${msg}`,
    )
  }
}

function buildHeader(sha: string, sourceFile: string): string {
  return [
    "/* ==========================================================================",
    `   Vendored from ${LANDING_REPO}`,
    `   Source: ${LANDING_STYLES_DIR}/${sourceFile}`,
    `   SHA: ${sha}`,
    "   Synced via: scripts/sync-design-tokens.ts",
    "   DO NOT EDIT BY HAND — re-run the sync script.",
    "   ========================================================================== */",
    "",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const landingDir = resolveLandingDir()
  const repoRoot = resolveRepoRoot()

  // --- Validate landing dir --------------------------------------------------
  if (!existsSync(landingDir)) {
    die(
      `Landing repo not found at "${landingDir}". ` +
        `Set LANDING_DIR env var or clone lesquel/remote-control-landing ` +
        `as a sibling directory (../opencode-landing).`,
    )
  }

  const landingGit = join(landingDir, ".git")
  if (!existsSync(landingGit)) {
    die(
      `"${landingDir}" exists but is not a git repository (no .git found). ` +
        `Make sure you have the full clone, not just a directory copy.`,
    )
  }

  // --- Resolve SHA -----------------------------------------------------------
  const sha = getGitSha(landingDir)
  const shortSha = sha.slice(0, 7)

  // --- Sync each file --------------------------------------------------------
  const results: Array<{ name: string; status: "updated" | "no changes" }> = []

  for (const [sourceFile, destRelative] of Object.entries(FILES)) {
    const sourcePath = join(landingDir, LANDING_STYLES_DIR, sourceFile)
    const destPath = join(repoRoot, destRelative)

    if (!existsSync(sourcePath)) {
      die(
        `Source file not found: "${sourcePath}". ` +
          `The landing repo at "${landingDir}" may be on a different branch ` +
          `or the file was renamed upstream.`,
      )
    }

    const upstreamContent = readFileSync(sourcePath, "utf8")
    const header = buildHeader(sha, sourceFile)
    const newContent = header + upstreamContent

    // Determine whether the file changed (for the summary line)
    let status: "updated" | "no changes" = "updated"
    if (existsSync(destPath)) {
      const existing = readFileSync(destPath, "utf8")
      if (existing === newContent) {
        status = "no changes"
      }
    }

    writeFileSync(destPath, newContent, "utf8")
    results.push({ name: sourceFile, status })
  }

  // --- Summary ---------------------------------------------------------------
  for (const { name, status } of results) {
    console.log(`synced ${name} from ${LANDING_REPO}@${shortSha} (${status})`)
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[sync-design-tokens] Unhandled error: ${msg}`)
  process.exit(1)
})
