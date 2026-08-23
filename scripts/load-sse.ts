#!/usr/bin/env bun

export interface SseLoadOptions {
  url: string
  token: string
  clients: number
  durationMs: number
  connectTimeoutMs: number
}

export interface SseLoadResult {
  requestedClients: number
  connectedClients: number
  failedClients: number
  durationMs: number
  serverReportedClients: number | null
  connectLatencyMs: { p50: number; p95: number; max: number }
  loadGeneratorHeapMb: number
}

type LoadDeps = {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
}

function integerFlag(value: string | undefined, name: string, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

export function parseSseLoadOptions(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): SseLoadOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`)
    const value = args[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`)
    values.set(flag, value)
    index += 1
  }

  const allowed = new Set(["--url", "--clients", "--duration-ms", "--connect-timeout-ms"])
  for (const flag of values.keys()) {
    if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`)
  }

  const token = env.PILOT_TOKEN
  if (!token) throw new Error("PILOT_TOKEN is required; keep credentials out of shell history")

  return {
    url: (values.get("--url") ?? env.PILOT_URL ?? "http://127.0.0.1:4097").replace(/\/$/, ""),
    token,
    clients: integerFlag(values.get("--clients") ?? "50", "--clients", 1, 500),
    durationMs: integerFlag(values.get("--duration-ms") ?? "10000", "--duration-ms", 100, 300_000),
    connectTimeoutMs: integerFlag(
      values.get("--connect-timeout-ms") ?? "5000",
      "--connect-timeout-ms",
      100,
      60_000,
    ),
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)])
}

export async function runSseLoad(
  options: SseLoadOptions,
  deps: LoadDeps = {
    fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  },
): Promise<SseLoadResult> {
  const controllers: AbortController[] = []
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  const latencies: number[] = []
  const decoder = new TextDecoder()

  async function connectClient(): Promise<void> {
    const controller = new AbortController()
    controllers.push(controller)
    const started = deps.now()
    const timeout = setTimeout(() => controller.abort(), options.connectTimeoutMs)
    try {
      const response = await deps.fetch(`${options.url}/events`, {
        headers: { Authorization: `Bearer ${options.token}` },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error(`SSE returned HTTP ${response.status}`)
      const reader = response.body.getReader()
      readers.push(reader)
      let received = ""
      while (!received.includes('"type":"pilot.connected"')) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error("SSE closed before pilot.connected")
        received += decoder.decode(chunk.value, { stream: true })
        if (received.length > 65_536) throw new Error("SSE welcome exceeded 64 KiB")
      }
      latencies.push(deps.now() - started)
    } finally {
      clearTimeout(timeout)
    }
  }

  const outcomes = await Promise.allSettled(
    Array.from({ length: options.clients }, () => connectClient()),
  )

  let serverReportedClients: number | null = null
  try {
    const health = await deps.fetch(`${options.url}/health`)
    const body: unknown = await health.json()
    if (body && typeof body === "object" && "sse_clients" in body) {
      const count = (body as { sse_clients?: unknown }).sse_clients
      if (typeof count === "number" && Number.isFinite(count)) serverReportedClients = count
    }
  } catch {
    // The connection metrics remain useful when the optional health probe fails.
  }

  await deps.sleep(options.durationMs)
  for (const controller of controllers) controller.abort()
  await Promise.allSettled(readers.map((reader) => reader.cancel()))

  const connectedClients = outcomes.filter((outcome) => outcome.status === "fulfilled").length
  return {
    requestedClients: options.clients,
    connectedClients,
    failedClients: options.clients - connectedClients,
    durationMs: options.durationMs,
    serverReportedClients,
    connectLatencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length > 0 ? Math.round(Math.max(...latencies)) : 0,
    },
    loadGeneratorHeapMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)),
  }
}

if (import.meta.main) {
  try {
    const options = parseSseLoadOptions(process.argv.slice(2))
    const result = await runSseLoad(options)
    console.log(JSON.stringify(result, null, 2))
    if (result.failedClients > 0) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
