import type { BusEvent } from "./types"

export interface EventBus {
  emit(event: BusEvent): void
  createSSEResponse(extraHeaders?: Record<string, string>): Response
  hasClients(): boolean
  clientCount(): number
  closeAll(): void
}

interface SSEClient {
  controller: ReadableStreamDefaultController
  connectedAt: number
}

export function createEventBus(): EventBus {
  const clients = new Set<SSEClient>()

  function emit(event: BusEvent): void {
    // Opt-in server-side trace. Set PILOT_DEBUG_BUS=1 in the environment to
    // revive the [pilot:bus-emit] markers. Kept behind a flag so it's there
    // next time we need to debug SSE wiring, without shipping noise by
    // default.
    if (process.env.PILOT_DEBUG_BUS === "1") {
      try {
        console.error(`[pilot:bus-emit] ${event.type} clients=${clients.size}`)
      } catch (_) {}
    }

    const data = `data: ${JSON.stringify(event)}\n\n`
    const dead: SSEClient[] = []

    for (const client of clients) {
      try {
        client.controller.enqueue(new TextEncoder().encode(data))
      } catch {
        dead.push(client)
      }
    }

    for (const client of dead) {
      clients.delete(client)
    }
  }

  function createSSEResponse(extraHeaders: Record<string, string> = {}): Response {
    let pingInterval: ReturnType<typeof setInterval> | null = null
    let client: SSEClient | null = null
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      start(controller) {
        client = { controller, connectedAt: Date.now() }
        clients.add(client)

        // Send initial connection event + a padding/comment chunk immediately.
        // Bun's HTTP/1.1 streaming can buffer small chunks until the next enqueue
        // — if only the welcome is sent and then nothing for 25s (old ping
        // interval), the browser EventSource never fires `onopen` because no
        // bytes reach it. Shipping the welcome plus a short prelude forces the
        // first chunk flush. The 2KiB padding line is a standard trick to defeat
        // any intermediate proxy's SSE buffering.
        const welcome: BusEvent = {
          type: "pilot.connected",
          properties: { timestamp: Date.now() },
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(welcome)}\n\n`))
        controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`))
        controller.enqueue(encoder.encode(`: ready\n\n`))

        // Keepalive pings every 3s — chosen to be well under any reasonable
        // proxy/browser idle cutoff AND frequent enough that Bun's write
        // coalescing never has more than a few hundred ms of gap. Also serves
        // as a liveness heartbeat: if the client's TCP half-closes silently,
        // the enqueue throws and we drop the client from the Set immediately
        // (instead of 25s later), freeing resources and letting future
        // `hasClients()` checks reflect reality.
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`))
          } catch {
            if (pingInterval) clearInterval(pingInterval)
            if (client) {
              clients.delete(client)
              client = null
            }
          }
        }, 3_000)
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval)
        if (client) {
          clients.delete(client)
          client = null
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        // `no-store` is stricter than `no-cache` — some middleware treats
        // the latter as "revalidate" and holds the response in a buffer.
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        // Disable nginx / cloudflared SSE buffering (no-op on direct localhost,
        // but critical when PILOT_TUNNEL is active — without this the tunnel
        // proxies collect a buffer before forwarding).
        "X-Accel-Buffering": "no",
        ...extraHeaders,
      },
    })
  }

  function closeAll(): void {
    for (const c of clients) {
      try { c.controller.close() } catch { /* ignore */ }
    }
    clients.clear()
  }

  return {
    emit,
    createSSEResponse,
    hasClients: () => clients.size > 0,
    clientCount: () => clients.size,
    closeAll,
  }
}

// ─── Process-wide singleton ──────────────────────────────────────────────────
//
// ROOT CAUSE of the "dashboard doesn't update live" bug (v1.14.x through
// v1.16.8 all chased symptoms of this).
//
// OpenCode may invoke the plugin factory multiple times in the SAME process —
// once per workspace / worktree / directory context. If each invocation calls
// createEventBus() directly, every context gets its own isolated bus. The
// dashboard's SSE connection lands on whichever bus was created first (the
// one that bound port 4097), but the event hook of a DIFFERENT context's bus
// receives all the SDK events for other workspaces. Result: emit() succeeds
// with `clients=0` every single time, because nobody is listening to the bus
// that's actually seeing the events.
//
// `getSharedEventBus()` returns a lazy-initialized singleton so ALL plugin
// instances in the same process share one bus. Tests that need an isolated
// bus still use the `createEventBus()` factory above directly.
let _sharedBus: EventBus | null = null
export function getSharedEventBus(): EventBus {
  if (!_sharedBus) _sharedBus = createEventBus()
  return _sharedBus
}
