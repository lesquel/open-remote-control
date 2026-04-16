import type { BusEvent } from "../types"

export interface EventBus {
  emit(event: BusEvent): void
  createSSEResponse(extraHeaders?: Record<string, string>): Response
  hasClients(): boolean
  clientCount(): number
}

interface SSEClient {
  controller: ReadableStreamDefaultController
  connectedAt: number
}

export function createEventBus(): EventBus {
  const clients = new Set<SSEClient>()

  function emit(event: BusEvent): void {
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

    const stream = new ReadableStream({
      start(controller) {
        const client: SSEClient = { controller, connectedAt: Date.now() }
        clients.add(client)

        // Send initial connection event
        const welcome: BusEvent = {
          type: "pilot.connected",
          properties: { timestamp: Date.now() },
        }
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(welcome)}\n\n`),
        )

        // Keepalive pings every 25s to prevent proxy/browser timeouts
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(`: ping\n\n`))
          } catch {
            if (pingInterval) clearInterval(pingInterval)
          }
        }, 25_000)
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval)
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...extraHeaders,
      },
    })
  }

  return {
    emit,
    createSSEResponse,
    hasClients: () => clients.size > 0,
    clientCount: () => clients.size,
  }
}
