// agent-panel.js — Agent context panel (sidebar, below files-changed)
// Shows details about the active agent derived from the current session's last message.
import { getState, subscribe } from './state.js'
import { getAgent, getModel, getProvider, agentColorFromName } from './references.js'
import { fetchMessages } from './api.js'

/**
 * Factory: createAgentPanel({ container })
 * @param {{ container: HTMLElement }} opts
 * @returns {{ refresh: () => void, destroy: () => void, open: () => void, close: () => void }}
 */
export function createAgentPanel({ container }) {
  if (!container) return { refresh: () => {}, destroy: () => {}, open: () => {}, close: () => {} }

  let _unsub = null
  let _lastSessionId = null
  let _isOpen = false
  let _fullPrompt = false

  // ── HTML helpers ──────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function modeBadgeClass(mode) {
    if (mode === 'primary')   return 'badge-idle'
    if (mode === 'subagent')  return 'badge-busy'
    if (mode === 'all')       return 'badge-idle'
    return 'badge-idle'
  }

  function renderEmpty(msg) {
    return `<div class="agent-panel-empty">${esc(msg)}</div>`
  }

  function renderAgentContent(agent) {
    const color = agent.color || agentColorFromName(agent.name)
    const modeBadge = agent.mode
      ? `<span class="badge ${modeBadgeClass(agent.mode)}">${esc(agent.mode)}</span>`
      : ''

    // Model assignment
    let modelHtml = ''
    if (agent.model) {
      const modelInfo = getModel(agent.model.modelID)
      const provInfo  = getProvider(agent.model.providerID)
      const modelLabel = modelInfo?.name ?? agent.model.modelID
      const provLabel  = provInfo?.name  ?? agent.model.providerID
      modelHtml = `<div class="agent-panel-row">
        <span class="agent-panel-label">Model</span>
        <span class="agent-panel-value agent-panel-model">${esc(provLabel)}/<strong>${esc(modelLabel)}</strong></span>
      </div>`
    }

    // System prompt (first 300 chars + expand)
    let promptHtml = ''
    if (agent.prompt) {
      const short  = agent.prompt.slice(0, 300)
      const isLong = agent.prompt.length > 300
      promptHtml = `<div class="agent-panel-row agent-panel-prompt-row">
        <span class="agent-panel-label">Prompt</span>
        <div class="agent-panel-prompt-wrap">
          <pre class="agent-panel-prompt" id="agent-panel-prompt-text">${esc(short)}${isLong ? '…' : ''}</pre>
          ${isLong ? `<button class="agent-panel-expand-btn" id="agent-panel-expand-btn" data-full="${esc(agent.prompt)}">Show full</button>` : ''}
        </div>
      </div>`
    }

    // Tools enabled
    let toolsHtml = ''
    if (agent.tools && typeof agent.tools === 'object') {
      const enabled = Object.entries(agent.tools)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
      if (enabled.length) {
        toolsHtml = `<div class="agent-panel-row">
          <span class="agent-panel-label">Tools</span>
          <div class="agent-panel-tools">${enabled.map(t => `<span class="agent-panel-tool-chip">${esc(t)}</span>`).join('')}</div>
        </div>`
      }
    }

    // Permissions
    let permsHtml = ''
    if (agent.permission && typeof agent.permission === 'object') {
      const perms = agent.permission
      const flags = ['edit', 'bash', 'webfetch'].filter(p => perms[p])
      if (flags.length) {
        permsHtml = `<div class="agent-panel-row">
          <span class="agent-panel-label">Perms</span>
          <div class="agent-panel-tools">${flags.map(f => `<span class="agent-panel-tool-chip agent-panel-perm-chip">${esc(f)}</span>`).join('')}</div>
        </div>`
      }
    }

    const descHtml = agent.description
      ? `<div class="agent-panel-desc">${esc(agent.description)}</div>`
      : ''

    return `
      <div class="agent-panel-agent-header">
        <span class="agent-panel-name" style="color:${color}">${esc(agent.name)}</span>
        ${modeBadge}
        ${agent.builtIn ? '<span class="agent-panel-builtin">built-in</span>' : ''}
      </div>
      ${descHtml}
      ${modelHtml}
      ${promptHtml}
      ${toolsHtml}
      ${permsHtml}
    `
  }

  function renderPanel(innerHtml) {
    container.innerHTML = `
      <div class="agent-panel-header" id="agent-panel-toggle">
        <span class="agent-panel-title">Agent Context</span>
        <span class="agent-panel-chevron">${_isOpen ? '▼' : '▶'}</span>
      </div>
      <div class="agent-panel-body" style="display:${_isOpen ? 'block' : 'none'}">
        ${innerHtml}
      </div>
    `
    wireEvents()
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  function wireEvents() {
    const toggle = container.querySelector('#agent-panel-toggle')
    toggle?.addEventListener('click', () => {
      _isOpen = !_isOpen
      const body    = container.querySelector('.agent-panel-body')
      const chevron = container.querySelector('.agent-panel-chevron')
      if (body)    body.style.display    = _isOpen ? 'block' : 'none'
      if (chevron) chevron.textContent   = _isOpen ? '▼' : '▶'
    })

    const expandBtn = container.querySelector('#agent-panel-expand-btn')
    expandBtn?.addEventListener('click', () => {
      const promptEl = container.querySelector('#agent-panel-prompt-text')
      if (!promptEl) return
      if (_fullPrompt) {
        promptEl.textContent = expandBtn.dataset.full?.slice(0, 300) + '…'
        expandBtn.textContent = 'Show full'
        _fullPrompt = false
      } else {
        promptEl.textContent = expandBtn.dataset.full ?? ''
        expandBtn.textContent = 'Collapse'
        _fullPrompt = true
      }
    })
  }

  // ── Core refresh logic ────────────────────────────────────────────────────

  async function refresh() {
    const { activeSession } = getState()

    if (!activeSession) {
      renderPanel(renderEmpty('No session selected'))
      return
    }

    let msgs = []
    try {
      msgs = await fetchMessages(activeSession)
    } catch (_) {
      renderPanel(renderEmpty('Could not load messages'))
      return
    }

    // Find last assistant message to determine agent
    const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant')
    const lastUser      = [...msgs].reverse().find(m => m.role === 'user')

    let agentName = null
    if (lastAssistant) {
      const raw = lastAssistant.mode ?? lastAssistant.agent ?? null
      agentName = typeof raw === 'string' ? raw : (raw?.name ?? null)
    } else if (lastUser) {
      agentName = typeof lastUser.agent === 'string' ? lastUser.agent : null
    }

    if (!agentName) {
      renderPanel(renderEmpty('No agent in use yet'))
      return
    }

    const agent = getAgent(agentName)
    if (!agent) {
      renderPanel(renderEmpty(`Agent "${agentName}" not found in config`))
      return
    }

    renderPanel(renderAgentContent(agent))
  }

  // ── Public open/close ─────────────────────────────────────────────────────

  function open() {
    _isOpen = true
    refresh()
  }

  function close() {
    _isOpen = false
    const body    = container.querySelector('.agent-panel-body')
    const chevron = container.querySelector('.agent-panel-chevron')
    if (body)    body.style.display  = 'none'
    if (chevron) chevron.textContent = '▶'
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  _unsub = subscribe('agent-panel', (state) => {
    if (state.activeSession !== _lastSessionId) {
      _lastSessionId = state.activeSession
      _fullPrompt = false
      refresh()
    }
  })

  // Initial render
  renderPanel(renderEmpty('No session selected'))

  function destroy() {
    if (_unsub) _unsub()
    container.innerHTML = ''
  }

  return { refresh, destroy, open, close }
}
