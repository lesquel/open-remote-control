const REGISTRY_URL = "https://registry.npmjs.org/%40lesquel%2Fopencode-pilot"
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type UpdateStatus = "current" | "update_available" | "ahead"

export interface UpdateReport {
  installed: string
  latest: string
  status: UpdateStatus
}

function parseVersion(version: string): { core: [number, number, number]; prerelease: string[] } {
  if (!VERSION_RE.test(version)) throw new Error(`Invalid package version: ${version}`)
  const [stable, prerelease = ""] = version.split("-", 2)
  const [major, minor, patch] = stable!.split(".").map(Number)
  return { core: [major!, minor!, patch!], prerelease: prerelease ? prerelease.split(".") : [] }
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < a.core.length; index++) {
    if (a.core[index]! < b.core[index]!) return -1
    if (a.core[index]! > b.core[index]!) return 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber < rightNumber ? -1 : 1
    if (leftNumber !== null || rightNumber !== null) return leftNumber !== null ? -1 : 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

export function buildUpdateReport(installed: string, latest: string): UpdateReport {
  const comparison = compareVersions(installed, latest)
  return {
    installed,
    latest,
    status: comparison < 0 ? "update_available" : comparison > 0 ? "ahead" : "current",
  }
}

export async function fetchLatestVersion(
  fetchImpl: FetchLike = fetch,
  timeoutMs = 5_000,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
    const body = await response.json() as { "dist-tags"?: { latest?: unknown } }
    const latest = body["dist-tags"]?.latest
    if (typeof latest !== "string" || !VERSION_RE.test(latest)) {
      throw new Error("npm registry returned an invalid latest version")
    }
    return latest
  } finally {
    clearTimeout(timer)
  }
}
