// label-strip.js — Prompt label strip: Agent · Model · Provider
// Dynamically reflects the currently selected session's most recent AssistantMessage.
// Fixed: references:ready re-render, raw fallback for unknown agents/models.
// Fixed (B2): normalise wrapped SDK messages ({ info, parts }), add pending model indicator.
import { getState, subscribe } from './state.js'
import { getModel, getProvider, getAgent, agentColorFromName, getFirstDefaultModel } from './references.js'
import { fetchMessages } from './api.js'
import { normalizeMessage } from './messages.js'
import { EVENTS } from './constants.js'

/**
 * Factory: createLabelStrip({ container, state })
 * @param {{ container: HTMLElement }} opts
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function createLabelStrip({ container }) {
  if (!container) return { refresh: () => {}, destroy: () => {} }

  // Cache the last active session so we don't re-fetch on unrelated state changes
  let _lastSessionId = null
  let _unsub = null

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderFromElement() {
    // Use DOM-scoped selectors — the container IS the #input-label-strip
    const lblAgent    = document.getElementById('lbl-agent')
    const lblModel    = document.getElementById('lbl-model')
    const lblProvider = document.getElementById('lbl-provider')
    return { lblAgent, lblModel, lblProvider }
  }

  /**
   * @param {string|null} agentName
   * @param {string|null} modelId
   * @param {string|null} providerId
   * @param {boolean} [pending] — when true, model/provider labels get a "pending" visual cue
   */
  function applyLabels(agentName, modelId, providerId, pending = false) {
    // Show raw IDs if references not loaded yet (avoids "—" flicker)
    const agentLabel    = agentName  || '—'
    // For model: use display name if found, otherwise fall back to raw modelId
    const modelLabel    = modelId
      ? (getModel(modelId)?.name ?? modelId)
      : '—'
    // For provider: use display name if found, otherwise fall back to raw providerId
    const providerLabel = providerId
      ? (getProvider(providerId)?.name ?? providerId)
      : '—'

    const { lblAgent, lblModel, lblProvider } = renderFromElement()

    if (lblAgent) {
      if (agentName) {
        const agent = getAgent(agentName)
        // If agent known, use its color; otherwise derive from name so unknown agents still get a color
        const color = agent?.color || agentColorFromName(agentName)
        lblAgent.style.color = color
      } else {
        lblAgent.style.color = ''
      }
      lblAgent.textContent = agentLabel
    }
    if (lblModel) {
      lblModel.textContent = pending ? `${modelLabel} ·` : modelLabel
      lblModel.style.opacity = pending ? '0.65' : ''
      lblModel.title = pending ? 'Pending: will be used on next prompt' : ''
    }
    if (lblProvider) {
      lblProvider.textContent = providerLabel
      lblProvider.style.opacity = pending ? '0.65' : ''
    }
  }

  // ── Pending preference (set by command-palette immediately on pick) ─────────
  // Exposed as window.__labelStripSetPending so the palette can call it.
  let _pendingPref = null  // { agent?, modelID?, providerID? } | null

  function setPending(pref) {
    _pendingPref = pref || null
    refresh()
  }

  // ── Core refresh logic ────────────────────────────────────────────────────

  async function refresh() {
    const { activeSession } = getState()

    if (!activeSession) {
      // No session — show defaults from references
      const def = getFirstDefaultModel()
      const reason = 'no-session'
      console.debug('[pilot:data] label-strip reason=%s modelId=%s providerId=%s', reason, def?.modelId, def?.providerId)
      applyLabels(null, def?.modelId ?? null, def?.providerId ?? null, false)
      return
    }

    // Fetch messages for the active session
    let raw = []
    try {
      raw = await fetchMessages(activeSession)
    } catch (_) {
      // Fallback to pending pref or defaults
      if (_pendingPref) {
        applyLabels(_pendingPref.agent ?? null, _pendingPref.modelID ?? null, _pendingPref.providerID ?? null, true)
        return
      }
      const def = getFirstDefaultModel()
      applyLabels(null, def?.modelId ?? null, def?.providerId ?? null, false)
      return
    }

    // Normalise SDK wrapped shape — each item may be { info: Message, parts: Part[] }
    const msgs = (Array.isArray(raw) ? raw : []).map(normalizeMessage)

    // Find the last assistant message
    const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant')
    const lastUser      = [...msgs].reverse().find(m => m.role === 'user')

    if (lastAssistant) {
      const agentName  = lastAssistant.mode ?? null
      const modelId    = lastAssistant.modelID ?? null
      const providerId = lastAssistant.providerID ?? null
      // If a pending pref exists and overrides, show it as pending
      const hasPending = !!_pendingPref
      const displayAgent  = _pendingPref?.agent    ?? (typeof agentName === 'string' ? agentName : null)
      const displayModel  = _pendingPref?.modelID  ?? modelId
      const displayProv   = _pendingPref?.providerID ?? providerId
      console.debug('[pilot:data] label-strip reason=lastAssistant agent=%s model=%s prov=%s pending=%s', displayAgent, displayModel, displayProv, hasPending)
      applyLabels(displayAgent, displayModel, displayProv, hasPending)
    } else if (lastUser) {
      // No assistant yet — show pending pref if any, else user agent + default model
      const agentName = lastUser.mode ?? null
      const def = getFirstDefaultModel()
      const hasPending = !!_pendingPref
      const displayAgent  = _pendingPref?.agent    ?? (typeof agentName === 'string' ? agentName : null)
      const displayModel  = _pendingPref?.modelID  ?? (def?.modelId ?? null)
      const displayProv   = _pendingPref?.providerID ?? (def?.providerId ?? null)
      console.debug('[pilot:data] label-strip reason=lastUser agent=%s model=%s prov=%s pending=%s', displayAgent, displayModel, displayProv, hasPending)
      applyLabels(displayAgent, displayModel, displayProv, hasPending)
    } else {
      const def = getFirstDefaultModel()
      const hasPending = !!_pendingPref
      const displayModel = _pendingPref?.modelID  ?? (def?.modelId ?? null)
      const displayProv  = _pendingPref?.providerID ?? (def?.providerId ?? null)
      console.debug('[pilot:data] label-strip reason=no-messages model=%s prov=%s pending=%s', displayModel, displayProv, hasPending)
      applyLabels(_pendingPref?.agent ?? null, displayModel, displayProv, hasPending)
    }
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  _unsub = subscribe('label-strip', (state) => {
    if (state.activeSession !== _lastSessionId) {
      _lastSessionId = state.activeSession
      // Clear pending pref when switching sessions
      _pendingPref = null
      refresh()
    }
  })

  // Re-render when references finish loading (resolves race condition where
  // getModel/getAgent return undefined because initReferences hasn't completed)
  window.addEventListener(EVENTS.REFERENCES_READY, () => refresh(), { once: true })

  // Expose pending setter globally so command-palette can call it immediately on pick
  window.__labelStripSetPending = setPending

  // Initial render
  refresh()

  function destroy() {
    if (_unsub) _unsub()
    delete window.__labelStripSetPending
  }

  return { refresh, setPending, destroy }
}
