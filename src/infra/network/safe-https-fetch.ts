import { lookup } from "node:dns/promises"
import { request, type RequestOptions } from "node:https"
import { isIP } from "node:net"
import { isPublicIpAddress, validateEndpoint } from "./ssrf"

type FetchFailureReason = "forbidden" | "network" | "redirect" | "timeout" | "too-large"
type FetchFailure = { ok: false; reason: FetchFailureReason; detail: string }
type HopFailure = { ok: false; reason: "network" | "timeout" | "too-large"; detail: string }
type FetchSuccess = { ok: true; status: number; body: Uint8Array }
export type SafeHttpsFetchResult = FetchSuccess | FetchFailure

type ResolvedAddress = { address: string }
type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>
type HopRequest = { url: URL; address: string; deadline: number; maxBytes: number }
type HopResult =
  | { ok: true; status: number; location?: string; body: Uint8Array }
  | HopFailure
type RequestHop = (input: HopRequest) => Promise<HopResult>

export type SafeHttpsFetcher = (
  rawUrl: string,
  options: { timeoutMs: number; maxBytes: number; maxRedirects?: number },
) => Promise<SafeHttpsFetchResult>

export function buildPinnedRequestOptions(url: URL, address: string): RequestOptions {
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  return {
    protocol: "https:",
    hostname: address,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: { Host: url.host, "Accept-Encoding": "identity" },
    rejectUnauthorized: true,
    ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
  }
}

async function resolvePublicAddress(hostname: string, resolver: Resolver): Promise<string | null> {
  if (isIP(hostname) !== 0) return isPublicIpAddress(hostname) ? hostname : null
  const answers = await resolver(hostname)
  if (answers.length === 0 || answers.some(({ address }) => !isPublicIpAddress(address))) return null
  return answers[0]?.address ?? null
}

async function resolveBeforeDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  now: () => number,
): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; detail: string }> {
  const remainingMs = deadline - now()
  if (remainingMs <= 0) return { ok: false, timedOut: true, detail: "remote fetch timed out" }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, timedOut: false, detail: error instanceof Error ? error.message : String(error) }),
      ),
      new Promise<{ ok: false; timedOut: true; detail: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, timedOut: true, detail: "remote fetch timed out" }), remainingMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function requestPinnedHop({ url, address, deadline, maxBytes }: HopRequest): Promise<HopResult> {
  return new Promise((resolve) => {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      resolve({ ok: false, reason: "timeout", detail: "remote fetch timed out" })
      return
    }

    let settled = false
    const finish = (result: HopResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const req = request(buildPinnedRequestOptions(url, address), (res) => {
      const status = res.statusCode ?? 502
      const location = res.headers.location
      if (status >= 300 && status < 400) {
        res.resume()
        finish({ ok: true, status, location, body: new Uint8Array() })
        return
      }
      const encoding = res.headers["content-encoding"]
      if (encoding && encoding !== "identity") {
        res.destroy()
        finish({ ok: false, reason: "network", detail: "encoded responses are not allowed" })
        return
      }
      const declaredLength = Number(res.headers["content-length"])
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        res.destroy()
        finish({ ok: false, reason: "too-large", detail: "remote attachment exceeds size limit" })
        return
      }

      const chunks: Uint8Array[] = []
      let received = 0
      res.on("data", (chunk: Uint8Array) => {
        received += chunk.byteLength
        if (received > maxBytes) {
          res.destroy()
          finish({ ok: false, reason: "too-large", detail: "remote attachment exceeds size limit" })
          return
        }
        chunks.push(chunk)
      })
      res.on("end", () => {
        const body = new Uint8Array(received)
        let offset = 0
        for (const chunk of chunks) {
          body.set(chunk, offset)
          offset += chunk.byteLength
        }
        finish({ ok: true, status, body })
      })
      res.on("error", (error) => finish({ ok: false, reason: "network", detail: error.message }))
    })
    req.setTimeout(remainingMs, () => {
      req.destroy()
      finish({ ok: false, reason: "timeout", detail: "remote fetch timed out" })
    })
    req.on("error", (error) => finish({ ok: false, reason: "network", detail: error.message }))
    req.end()
  })
}

const defaultResolver: Resolver = async (hostname) => lookup(hostname, { all: true, verbatim: true })

export function createSafeHttpsFetcher(deps: {
  resolver?: Resolver
  requestHop?: RequestHop
  now?: () => number
} = {}): SafeHttpsFetcher {
  const resolver = deps.resolver ?? defaultResolver
  const requestHop = deps.requestHop ?? requestPinnedHop
  const now = deps.now ?? Date.now

  return async (rawUrl, options) => {
    const deadline = now() + options.timeoutMs
    const maxRedirects = options.maxRedirects ?? 5
    let current = rawUrl

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const validation = validateEndpoint(current)
      if (!validation.ok) return { ok: false, reason: "forbidden", detail: validation.reason }

      const url = new URL(current)
      const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
      const resolution = await resolveBeforeDeadline(resolvePublicAddress(hostname, resolver), deadline, now)
      if (!resolution.ok) return { ok: false, reason: resolution.timedOut ? "timeout" : "network", detail: resolution.detail }
      const address = resolution.value
      if (!address) return { ok: false, reason: "forbidden", detail: "hostname did not resolve exclusively to public addresses" }
      if (now() >= deadline) return { ok: false, reason: "timeout", detail: "remote fetch timed out" }

      const result = await requestHop({ url, address, deadline, maxBytes: options.maxBytes })
      if (!result.ok) return result
      if (result.status < 300 || result.status >= 400) return result
      if (!result.location) return { ok: false, reason: "redirect", detail: "redirect response omitted Location" }
      if (redirectCount === maxRedirects) return { ok: false, reason: "redirect", detail: "too many redirects" }
      current = new URL(result.location, url).href
    }
    return { ok: false, reason: "redirect", detail: "too many redirects" }
  }
}
