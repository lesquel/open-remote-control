import { realpathSync, statSync } from "node:fs"
import { isAbsolute, relative, sep } from "node:path"

export type ContainedFileResult =
  | { ok: true; path: string }
  | { ok: false; reason: "invalid" | "not-found" | "outside-root" | "not-file" }

/** Resolve symlinks and prove that a candidate is a regular file inside root. */
export function resolveContainedFile(root: string, candidate: string): ContainedFileResult {
  if (!root || !candidate || candidate.includes("\0") || !isAbsolute(root) || !isAbsolute(candidate)) {
    return { ok: false, reason: "invalid" }
  }

  try {
    const canonicalRoot = realpathSync.native(root)
    const canonicalCandidate = realpathSync.native(candidate)
    const fromRoot = relative(canonicalRoot, canonicalCandidate)
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      return { ok: false, reason: "outside-root" }
    }
    if (!statSync(canonicalCandidate).isFile()) return { ok: false, reason: "not-file" }
    return { ok: true, path: canonicalCandidate }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { ok: false, reason: "not-found" }
      : { ok: false, reason: "invalid" }
  }
}
