// usage-indicator.js — Token/cost usage display in the TUI header
// Shows: {input_tokens}  {percentUsed}%  (${cumulativeCost})
// Fixed (B5): normalise wrapped SDK messages ({ info, parts }); null-safe arithmetic.
import { getState, subscribe } from './state.js'
import { getModel } from './references.js'
import { fetchMessages } from './api.js'
import { normalizeMessage } from './messages.js'

/**
 * Factory: createUsageIndicator({ container })
 * Mounts a usage display into container.
 * Returns { refresh, destroy }.
 */
export function createUsageIndicator({ container }) {
  if (!container) return { refresh: () => {}, destroy: () => {} }

  let _unsub = null
  let _unsubDir = null
  let _lastSessionId = null
  let _lastDirectory = null

  // ── Render ────────────────────────────────────────────────────────────────

  function renderPlaceholder(loading) {
    if (loading) {
      container.innerHTML = `<span class="usage-indicator usage-indicator--empty" title="Loading…">loading…</span>`
    } else {
      container.innerHTML = `<span class="usage-indicator" title="No messages yet">0&nbsp;&nbsp;0%&nbsp;&nbsp;($0.00)</span>`
    }
  }

  function renderUsage(inputTokens, percentUsed, cumulativeCost, tooltipHtml) {
    const tokensStr  = inputTokens.toLocaleString()
    const percentStr = percentUsed.toFixed(0)
    const costStr    = cumulativeCost.toFixed(2)

    container.innerHTML = `<span class="usage-indicator" title="${tooltipHtml}">${tokensStr}&nbsp;&nbsp;${percentStr}%&nbsp;&nbsp;($${costStr})</span>`
  }

  // ── Core refresh logic ────────────────────────────────────────────────────

  async function refresh() {
    const { activeSession } = getState()

    if (!activeSession) {
      renderPlaceholder(false)
      return
    }

    // Show loading briefly
    renderPlaceholder(true)

    let raw = []
    try {
      raw = await fetchMessages(activeSession)
    } catch (_) {
      renderPlaceholder(false)
      return
    }

    // Normalise SDK wrapped shape: { info: AssistantMessage, parts: Part[] }
    const msgs = (Array.isArray(raw) ? raw : []).map(normalizeMessage)

    const assistantMsgs = msgs.filter(m => m.role === 'assistant')
    if (!assistantMsgs.length) {
      renderPlaceholder(false)
      return
    }

    const lastMsg = assistantMsgs[assistantMsgs.length - 1]
    const tokens  = lastMsg.tokens ?? {}

    const inputTokens  = tokens.input              ?? 0
    const cacheRead    = tokens.cache?.read         ?? tokens.cacheRead  ?? 0
    const outputTokens = tokens.output              ?? 0
    const cacheWrite   = tokens.cache?.write        ?? tokens.cacheWrite ?? 0

    // Cumulative cost: sum all assistant message costs (null-safe)
    let cumulativeCost = 0
    for (const m of assistantMsgs) {
      const c = m.cost
      if (typeof c === 'number') cumulativeCost += c
      else if (c && typeof c === 'object') {
        cumulativeCost += c.total ?? ((c.input ?? 0) + (c.output ?? 0) + (c.cacheRead ?? 0) + (c.cacheWrite ?? 0))
      }
    }

    // Context window from model (fallback 200k if model unknown)
    const modelId = lastMsg.modelID ?? null
    const modelInfo = modelId ? getModel(modelId) : null
    const contextWindow = modelInfo?.limit?.context ?? 200000

    let percentUsed = 0
    if (contextWindow > 0) {
      percentUsed = Math.min(100, Math.max(0, ((inputTokens + cacheRead) / contextWindow) * 100))
    }

    // Build tooltip breakdown
    const lines = [
      `Input: ${inputTokens.toLocaleString()} tokens`,
      `Output: ${outputTokens.toLocaleString()} tokens`,
      `Cache read: ${cacheRead.toLocaleString()} tokens`,
      `Cache write: ${cacheWrite.toLocaleString()} tokens`,
      `Context window: ${contextWindow.toLocaleString()} tokens`,
      `Session cost: $${cumulativeCost.toFixed(4)}`,
    ]
    const tooltipHtml = lines.join(' | ')

    console.debug('[pilot:data] usage-indicator tokens=%d cacheRead=%d pct=%s cost=%s modelId=%s', inputTokens, cacheRead, percentUsed.toFixed(1), cumulativeCost.toFixed(4), modelId)

    if (!inputTokens && !cumulativeCost) {
      renderPlaceholder(false)
      return
    }

    renderUsage(inputTokens, percentUsed, cumulativeCost, tooltipHtml)
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  _unsub = subscribe('usage-indicator', (state) => {
    if (state.activeSession !== _lastSessionId) {
      _lastSessionId = state.activeSession
      refresh()
    }
  })

  _unsubDir = subscribe('usage-indicator-dir', (state) => {
    const dir = state.activeDirectory ?? null
    if (dir !== _lastDirectory) {
      _lastDirectory = dir
      refresh()
    }
  })

  // Initial render
  renderPlaceholder(false)
  refresh()

  function destroy() {
    if (_unsub) _unsub()
    if (_unsubDir) _unsubDir()
    container.innerHTML = ''
  }

  return { refresh, destroy }
}
