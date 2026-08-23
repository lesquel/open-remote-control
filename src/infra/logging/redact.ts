const REDACTED = "[REDACTED]"
const MAX_DEPTH = 6
const MAX_ENTRIES = 100
const MAX_STRING_LENGTH = 2_000

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase()
  if (["tokens", "tokencount", "inputtokens", "outputtokens"].includes(normalized)) return false
  return normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("apikey") ||
    normalized.includes("privatekey") ||
    normalized === "p256dh" ||
    normalized === "auth"
}

function redactString(value: string): string {
  const bearerSafe = value.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
  if (/^https?:\/\//i.test(bearerSafe)) {
    try {
      const url = new URL(bearerSafe)
      const path = url.pathname === "/" ? "/" : "/[REDACTED]"
      return `${url.origin}${path}${url.search || url.hash ? "?[REDACTED]" : ""}`
    } catch {
      // Not a complete URL; continue with bounded string handling.
    }
  }
  return bearerSafe.length > MAX_STRING_LENGTH
    ? `${bearerSafe.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`
    : bearerSafe
}

function redact(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return redactString(value)
  if (value === null || typeof value !== "object") return value
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]"
  if (seen.has(value)) return "[CIRCULAR]"
  seen.add(value)

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) }
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ENTRIES).map((item) => redact(item, depth + 1, seen))
    if (value.length > MAX_ENTRIES) items.push(`[${value.length - MAX_ENTRIES} MORE]`)
    return items
  }

  const output: Record<string, unknown> = {}
  const entries = Object.entries(value).slice(0, MAX_ENTRIES)
  for (const [key, child] of entries) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(child, depth + 1, seen)
  }
  if (Object.keys(value).length > MAX_ENTRIES) {
    output.__truncatedKeys = Object.keys(value).length - MAX_ENTRIES
  }
  return output
}

export function redactSecrets(value: unknown): unknown {
  return redact(value, 0, new WeakSet())
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return redactSecrets(value) as Record<string, unknown>
}
