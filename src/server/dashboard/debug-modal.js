// debug-modal.js — Self-service diagnostic modal (B6)
// Opens a panel showing live internal state so users can paste it into bug reports.
// Accessed via: Command Palette → "Show Debug Info"
import { getState, getActiveDirectory } from './state.js'
import {
  getAgents, getProviders, getMcpServers, getLspClients,
  getCurrentProject, isInitialized,
} from './references.js'
import { normalizeMessage } from './messages.js'
import { fetchMessages } from './api.js'

const PILOT_VERSION = '1.8.4'

// ── Escape helper ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Last SSE metadata (updated from sse.js via window.__debugSseLastEvent) ─────
// SSE module writes: window.__debugSseLastEvent = { type, ts }

// ── Build report ─────────────────────────────────────────────────────────────

async function buildReport() {
  const state = getState()
  const { activeSession, sessions, statuses, sse } = state
  const dir = getActiveDirectory()

  // References
  const refsInit = isInitialized()
  const agents   = getAgents()
  const providers = getProviders()
  const mcpServers = getMcpServers()
  const lspClients = getLspClients()
  const project    = getCurrentProject()

  // Last assistant message snapshot
  let lastAssistantRaw = null
  let msgCount = 0
  if (activeSession) {
    try {
      const raw = await fetchMessages(activeSession)
      const msgs = (Array.isArray(raw) ? raw : []).map(normalizeMessage)
      msgCount = msgs.length
      const lastAss = [...msgs].reverse().find(m => m.role === 'assistant')
      if (lastAss) lastAssistantRaw = lastAss._info ?? lastAss
    } catch (_) {}
  }

  // SSE metadata
  const sseLastEvent = window.__debugSseLastEvent ?? null

  return {
    pilot_version:  PILOT_VERSION,
    active_directory: dir ?? '(default)',
    session: {
      active_id:   activeSession ?? '(none)',
      total:       Object.keys(sessions).length,
      msg_count:   msgCount,
    },
    references: {
      initialized: refsInit,
      agents:      agents.length,
      providers:   providers.length,
      mcp_servers: Object.keys(mcpServers).length,
      lsp_clients: lspClients.length,
      project:     project?.path ?? project?.worktree ?? '(none)',
    },
    sse: {
      connected:  sse.connected,
      last_event: sseLastEvent,
    },
    last_assistant_message: lastAssistantRaw ?? '(none)',
  }
}

// ── Modal HTML ────────────────────────────────────────────────────────────────

function ensureModal() {
  if (document.getElementById('debug-modal')) return
  const el = document.createElement('div')
  el.id = 'debug-modal'
  el.className = 'modal-overlay'
  el.innerHTML = `
    <div class="modal-box modal-box--wide" style="max-width:680px;max-height:80vh;display:flex;flex-direction:column">
      <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)">
        <span style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)">Debug Info</span>
        <div style="display:flex;gap:8px">
          <button id="debug-copy-btn" class="btn btn--secondary" style="font-size:11px;padding:4px 10px">Copy JSON</button>
          <button id="debug-close-btn" class="btn btn--ghost" style="font-size:11px;padding:4px 10px">Close</button>
        </div>
      </div>
      <div id="debug-modal-body" style="flex:1;overflow:auto;padding:12px 16px">
        <pre style="font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text);margin:0" id="debug-json-output">Loading…</pre>
      </div>
    </div>
  `
  document.body.appendChild(el)

  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open') })
  document.getElementById('debug-close-btn').addEventListener('click', () => el.classList.remove('open'))
  document.getElementById('debug-copy-btn').addEventListener('click', () => {
    const text = document.getElementById('debug-json-output')?.textContent ?? ''
    navigator.clipboard?.writeText(text).then(() => {
      const btn = document.getElementById('debug-copy-btn')
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy JSON' }, 1500) }
    })
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Open the debug modal and populate it with the current state snapshot.
 */
export async function openDebugModal() {
  ensureModal()
  const modal = document.getElementById('debug-modal')
  const output = document.getElementById('debug-json-output')
  modal.classList.add('open')
  output.textContent = 'Loading…'
  try {
    const report = await buildReport()
    output.textContent = JSON.stringify(report, null, 2)
  } catch (err) {
    output.textContent = `Error building report: ${err?.message ?? err}`
  }
}
