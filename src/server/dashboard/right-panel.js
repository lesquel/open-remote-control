// right-panel.js — Right-side TUI info panel
// Mirrors OpenCode native TUI: Context / MCP / LSP / Path / Instance
// Factory: createRightPanel({ container }) → { refresh, destroy }
// Fixed (B5): normalise wrapped SDK messages, null-safe arithmetic, fallback ctx window.
import { getState, getActiveDirectory, subscribe } from './state.js'
import {
  getMcpServers,
  getCurrentProject,
  getLspClients,
  getFirstDefaultModel,
  getModel,
  refresh as refreshReferences,
} from './references.js'
import { fetchMessages, fetchHealth, fetchMcpStatus } from './api.js'
import { normalizeMessage } from './messages.js'
import { LIMITS, STORAGE_KEYS } from './constants.js'

// ── Constants ─────────────────────────────────────────────────────────────────
const PILOT_VERSION = '1.8.4'
const LS_KEY_PREFIX = STORAGE_KEYS.RIGHT_PANEL_COLLAPSED
const MCP_POLL_INTERVAL_MS = LIMITS.MCP_POLL_INTERVAL_MS

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtTimestamp(ts) {
  if (!ts) return ''
  try {
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts)
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  } catch (_) {
    return String(ts)
  }
}

function shortenPath(p) {
  if (!p) return ''
  return p.replace(/^\/(?:home|Users)\/[^/]+/, '~')
}

function getSectionCollapsed(key) {
  try {
    return localStorage.getItem(LS_KEY_PREFIX + key) === '1'
  } catch (_) {
    return false
  }
}

function setSectionCollapsed(key, val) {
  try {
    if (val) localStorage.setItem(LS_KEY_PREFIX + key, '1')
    else localStorage.removeItem(LS_KEY_PREFIX + key)
  } catch (_) {}
}

/**
 * Compute usage stats from an array of NORMALISED assistant messages.
 * Input: output of normalizeMessage() filtered to role === 'assistant'.
 */
function computeUsage(assistantMsgs) {
  if (!assistantMsgs.length) {
    return { inputTokens: 0, percentUsed: 0, cumulativeCost: 0, tooltipHtml: '' }
  }

  const lastMsg = assistantMsgs[assistantMsgs.length - 1]
  const tokens = lastMsg.tokens ?? {}

  const inputTokens   = tokens.input              ?? 0
  const cacheRead     = tokens.cache?.read         ?? tokens.cacheRead  ?? 0
  const outputTokens  = tokens.output              ?? 0
  const cacheWrite    = tokens.cache?.write        ?? tokens.cacheWrite ?? 0

  let cumulativeCost = 0
  for (const m of assistantMsgs) {
    const c = m.cost
    if (typeof c === 'number') cumulativeCost += c
    else if (c && typeof c === 'object') {
      cumulativeCost += c.total ?? ((c.input ?? 0) + (c.output ?? 0) + (c.cacheRead ?? 0) + (c.cacheWrite ?? 0))
    }
  }

  // Fallback 200k context window when model info unavailable
  const modelId    = lastMsg.modelID ?? null
  const modelInfo  = modelId ? getModel(modelId) : null
  const ctxWindow  = modelInfo?.limit?.context ?? 200000

  let percentUsed = 0
  if (ctxWindow > 0) {
    percentUsed = Math.min(100, Math.max(0, ((inputTokens + cacheRead) / ctxWindow) * 100))
  }

  const lines = [
    `Input: ${inputTokens.toLocaleString()} tokens`,
    `Output: ${outputTokens.toLocaleString()} tokens`,
    `Cache read: ${cacheRead.toLocaleString()} tokens`,
    `Cache write: ${cacheWrite.toLocaleString()} tokens`,
    `Context window: ${ctxWindow.toLocaleString()} tokens`,
    `Session cost: $${cumulativeCost.toFixed(4)}`,
  ]
  const tooltipHtml = lines.join(' | ')

  console.debug('[pilot:data] right-panel computeUsage tokens=%d cacheRead=%d pct=%s cost=%s', inputTokens, cacheRead, percentUsed.toFixed(1), cumulativeCost.toFixed(4))

  return { inputTokens, percentUsed, cumulativeCost, tooltipHtml }
}

// MCP status → CSS modifier + label
function mcpStatusClass(status) {
  if (!status) return 'disabled'
  const s = String(status).toLowerCase()
  if (s === 'connected') return 'connected'
  if (s.includes('auth') || s.includes('needs')) return 'needs-auth'
  if (s === 'disabled') return 'disabled'
  return 'failed'
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * createRightPanel({ container })
 * @param {{ container: HTMLElement }} opts
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function createRightPanel({ container }) {
  if (!container) return { refresh: () => {}, destroy: () => {} }

  let _unsub = null
  let _unsubDir = null
  let _lastSessionId = null
  // Cache last-seen VCS branch (populated from SSE vcs events via window.__rightPanelSetBranch)
  let _vcsBranch = null
  // Cache last fetched messages
  let _lastMsgs = []
  let _loadingUsage = false
  // Last rendered usage state — skip re-render when data is identical (anti-flicker)
  let _lastRenderedUsage = null
  // Throttle: only one refresh per 250ms during streaming
  let _refreshThrottleTimer = null
  let _refreshPending = false
  // MCP poll state
  let _mcpPollTimer = null
  let _lastMcpSnapshot = null
  // OpenCode instance version (fetched once on init)
  let _instanceVersion = null

  // ── Section collapse state ─────────────────────────────────────────────────

  const sections = {
    context: { key: 'context', label: 'Context' },
    mcp:     { key: 'mcp',     label: 'MCP' },
    lsp:     { key: 'lsp',     label: 'LSP' },
    path:    { key: 'path',    label: 'Path' },
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderSectionHeader(key, label, defaultExpanded = true) {
    const collapsed = getSectionCollapsed(key)
    const chevron   = collapsed ? '▶' : '▼'
    return `<div class="rp-section-header" data-section="${escHtml(key)}" aria-expanded="${!collapsed}">
      <span class="rp-chevron">${chevron}</span>
      <span class="rp-section-label">${escHtml(label)}</span>
    </div>`
  }

  function renderSessionBlock(session) {
    if (!session) {
      return `<div class="rp-session-block rp-muted">No session selected</div>`
    }
    const sessions = getState().sessions
    const s        = sessions[session] ?? {}
    const created  = s?.time?.created ? fmtTimestamp(s.time.created) : ''
    const title    = s?.title ? escHtml(s.title) : escHtml(session.slice(0, 8) + '…')
    const parentId = s?.parentId ?? s?.parent ?? null

    let parentLink = ''
    if (parentId) {
      const parentSess = sessions[parentId]
      const parentTitle = parentSess?.title ? escHtml(parentSess.title) : escHtml(parentId.slice(0, 8) + '…')
      parentLink = `<div class="rp-parent-link">Child of: <a href="#" class="rp-parent-anchor" data-parent="${escHtml(parentId)}">${parentTitle}</a></div>`
    }

    return `<div class="rp-session-block">
      <div class="rp-session-title">${title}</div>
      ${created ? `<div class="rp-session-time">${escHtml(created)}</div>` : ''}
      ${parentLink}
    </div>`
  }

  function renderContextBlock(inputTokens, percentUsed, cumulativeCost, tooltipHtml, loading) {
    const collapsed = getSectionCollapsed('context')
    let body = ''
    if (!collapsed) {
      if (loading) {
        body = `<div class="rp-section-body"><span class="rp-muted">loading…</span></div>`
      } else {
        const pctBar = percentUsed > 0
          ? `<div class="rp-pct-bar"><div class="rp-pct-fill" style="width:${Math.min(100, percentUsed).toFixed(1)}%"></div></div>`
          : ''
        body = `<div class="rp-section-body">
          <div class="rp-stat-row" title="${escHtml(tooltipHtml)}">${inputTokens.toLocaleString()} tokens</div>
          <div class="rp-stat-row">${percentUsed.toFixed(0)}% used</div>
          ${pctBar}
          <div class="rp-stat-row">$${cumulativeCost.toFixed(2)} spent</div>
        </div>`
      }
    }
    return renderSectionHeader('context', 'Context') + body
  }

  function renderMcpBlock() {
    const collapsed  = getSectionCollapsed('mcp')
    const mcpServers = getMcpServers()
    const entries    = Object.entries(mcpServers)

    let body = ''
    if (!collapsed) {
      if (!entries.length) {
        body = `<div class="rp-section-body"><span class="rp-muted">No MCP servers configured</span></div>`
      } else {
        const rows = entries.map(([name, info]) => {
          const status      = info?.status ?? info?.state ?? (typeof info === 'string' ? info : 'unknown')
          const statusClass = mcpStatusClass(status)
          const statusLabel = typeof status === 'string' ? status : String(status)
          const errMsg      = (statusClass === 'failed' && info?.error)
            ? `<span class="rp-mcp-error"> — ${escHtml(String(info.error).slice(0, 60))}</span>`
            : ''
          return `<div class="rp-mcp-row">
            <span class="rp-mcp-dot mcp-status--${escHtml(statusClass)}">●</span>
            <span class="rp-mcp-name">${escHtml(name)}</span>
            <span class="rp-mcp-status mcp-status--${escHtml(statusClass)}">${escHtml(statusLabel)}${errMsg}</span>
          </div>`
        }).join('')
        body = `<div class="rp-section-body rp-section-body--tight">${rows}</div>`
      }
    }
    return renderSectionHeader('mcp', 'MCP') + body
  }

  function renderLspBlock() {
    const collapsed = getSectionCollapsed('lsp')
    const clients   = getLspClients()
    let body = ''
    if (!collapsed) {
      if (!clients.length) {
        body = `<div class="rp-section-body rp-lsp-block">
          <span class="rp-muted rp-lsp-fallback">LSPs will activate as files are read</span>
        </div>`
      } else {
        const rows = clients.map(c => {
          const isConnected = c.status === 'connected'
          const dotClass    = isConnected ? 'lsp-dot--connected' : 'lsp-dot--error'
          const errBadge    = !isConnected
            ? `<span class="rp-lsp-error-badge">error</span>`
            : ''
          const rootText    = c.root ? `<span class="rp-lsp-root rp-muted">${escHtml(shortenPath(c.root))}</span>` : ''
          return `<div class="rp-lsp-row">
            <span class="rp-lsp-dot ${dotClass}">●</span>
            <span class="rp-lsp-name">${escHtml(c.name)}</span>
            ${isConnected ? rootText : errBadge}
          </div>`
        }).join('')
        body = `<div class="rp-section-body rp-lsp-block rp-section-body--tight">${rows}</div>`
      }
    }
    return `<div class="rp-section-header rp-section-header--simple" data-section="lsp">
      <span class="rp-section-label">LSP</span>
    </div>` + body
  }

  function renderPathBlock() {
    const collapsed      = getSectionCollapsed('path')
    const activeDir      = getActiveDirectory()
    const project        = getCurrentProject()
    const worktree       = project?.worktree ?? project?.path ?? project?.root ?? null
    // Active directory takes precedence over project root from references
    const displayPath    = activeDir ?? worktree
    const short          = displayPath ? shortenPath(displayPath) : '(default)'
    const titleAttr      = displayPath ?? ''
    const isOverride     = !!activeDir

    let body = ''
    if (!collapsed) {
      const overrideBadge = isOverride
        ? `<span class="rp-path-override-badge" title="${escHtml(activeDir)}">override</span>`
        : ''
      const branchPart = _vcsBranch
        ? `<div class="rp-path-branch"><span class="rp-branch-icon">⎇</span> ${escHtml(_vcsBranch)}</div>`
        : ''
      body = `<div class="rp-section-body rp-path-block">
        <div class="rp-path-text" title="${escHtml(titleAttr)}">${escHtml(short)} ${overrideBadge}</div>
        ${branchPart}
      </div>`
    }
    return `<div class="rp-section-header rp-section-header--simple" data-section="path">
      <span class="rp-section-label">Path</span>
    </div>` + body
  }

  function renderInstanceBlock() {
    let instanceLabel = 'OpenCode local'
    if (_instanceVersion && _instanceVersion !== 'local' && !_instanceVersion.startsWith('0.0')) {
      instanceLabel = `OpenCode ${escHtml(_instanceVersion)}`
    }
    return `<div class="rp-instance-block">
      <span class="rp-instance-dot instance-dot">●</span>
      <span class="rp-instance-label">${instanceLabel}</span>
      <span class="rp-instance-version">v${escHtml(PILOT_VERSION)}</span>
    </div>`
  }

  // ── Update footer usage compact ──────────────────────────────────────────

  function updateFooterUsage(inputTokens, percentUsed) {
    const el = document.getElementById('footer-usage-compact')
    if (!el) return
    if (!inputTokens && !percentUsed) {
      el.textContent = ''
      return
    }
    el.textContent = `${inputTokens.toLocaleString()}  (${percentUsed.toFixed(0)}%)`
  }

  // ── Full render ────────────────────────────────────────────────────────────

  function renderAll(usageState) {
    const { activeSession } = getState()
    const { inputTokens = 0, percentUsed = 0, cumulativeCost = 0, tooltipHtml = '', loading = false } = usageState ?? {}

    // Skip re-render if usage data is identical (prevents flicker during streaming)
    if (!loading && _lastRenderedUsage) {
      const last = _lastRenderedUsage
      if (
        last.inputTokens === inputTokens &&
        last.percentUsed === percentUsed &&
        last.cumulativeCost === cumulativeCost &&
        last.activeSession === activeSession
      ) {
        updateFooterUsage(inputTokens, percentUsed)
        return
      }
    }
    _lastRenderedUsage = { inputTokens, percentUsed, cumulativeCost, activeSession }

    container.innerHTML = `
      <div class="rp-inner">
        <button class="rp-close-btn" id="rp-close-btn" type="button" title="Hide panel (alt+i)" aria-label="Hide right panel">×</button>
        <div class="rp-scroll">
          ${renderSessionBlock(activeSession)}
          <div class="rp-section">${renderContextBlock(inputTokens, percentUsed, cumulativeCost, tooltipHtml, loading)}</div>
          <div class="rp-section">${renderMcpBlock()}</div>
          <div class="rp-section">${renderLspBlock()}</div>
          <div class="rp-section">${renderPathBlock()}</div>
        </div>
        ${renderInstanceBlock()}
      </div>
    `
    wireEvents()
    // Wire the close button — hides the panel via the same class Alt+I uses
    const closeBtn = container.querySelector('#rp-close-btn')
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        container.classList.add('right-panel--hidden')
      })
    }
    // Update footer compact usage
    if (!loading) updateFooterUsage(inputTokens, percentUsed)
  }

  // ── Wire interactive events ────────────────────────────────────────────────

  function wireEvents() {
    // Section headers — toggle collapse
    container.querySelectorAll('.rp-section-header[data-section]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.section
        const curr = getSectionCollapsed(key)
        setSectionCollapsed(key, !curr)
        // Re-render only the section label + chevron without refetching
        refresh()
      })
    })

    // Parent session link
    container.querySelectorAll('.rp-parent-anchor[data-parent]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault()
        const parentId = el.dataset.parent
        if (parentId) {
          import('./sessions.js').then(m => m.selectSession(parentId)).catch(() => {})
        }
      })
    })
  }

  // ── Async refresh with usage fetch (throttled to 250ms) ──────────────────

  async function _refreshImpl() {
    const { activeSession } = getState()

    // Render immediately with what we have (may be stale or zero)
    renderAll({
      inputTokens: 0,
      percentUsed: 0,
      cumulativeCost: 0,
      tooltipHtml: '',
      loading: !!activeSession,
    })

    if (!activeSession) return

    // Fetch messages async, normalise SDK wrapped shape
    try {
      const raw = await fetchMessages(activeSession)
      const msgs = (Array.isArray(raw) ? raw : []).map(normalizeMessage)
      _lastMsgs = msgs
      const assistantMsgs = msgs.filter(m => m.role === 'assistant')
      const usage = computeUsage(assistantMsgs)
      // Re-render with real usage
      renderAll({ ...usage, loading: false })
      // Update cost panel with full message set
      window.__costPanel?.updateSession(activeSession, msgs)
    } catch (_) {
      renderAll({ inputTokens: 0, percentUsed: 0, cumulativeCost: 0, tooltipHtml: '', loading: false })
    }
  }

  /**
   * Throttled public refresh — at most one full re-fetch per 250ms.
   * During SSE streaming this fires many times/second; the throttle keeps
   * the UI responsive without choking on network requests or causing flicker.
   * Callers that need an immediate refresh (session switch) call _refreshImpl directly.
   */
  function refresh() {
    if (_refreshThrottleTimer) {
      // A refresh is already scheduled — mark pending so we run one more after
      _refreshPending = true
      return
    }
    _refreshImpl()
    _refreshThrottleTimer = setTimeout(() => {
      _refreshThrottleTimer = null
      if (_refreshPending) {
        _refreshPending = false
        refresh()
      }
    }, 250)
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  let _lastDirectory = null

  _unsub = subscribe('right-panel', (state) => {
    if (state.activeSession !== _lastSessionId) {
      _lastSessionId = state.activeSession
      // Session switch: clear cached usage so we don't skip on first render
      _lastRenderedUsage = null
      _refreshImpl()
    }
  })

  // Re-render when activeDirectory changes (path block + usage recompute for the newly active session)
  _unsubDir = subscribe('right-panel-dir', (state) => {
    const dir = state.activeDirectory ?? null
    if (dir !== _lastDirectory) {
      _lastDirectory = dir
      // Refresh fetches messages via fetchMessages(activeSession) and recomputes usage
      _lastRenderedUsage = null
      _refreshImpl()
    }
  })

  // ── MCP polling (30s — MCP has no SSE events) ─────────────────────────────

  async function pollMcp() {
    try {
      const res = await fetchMcpStatus()
      const snapshot = JSON.stringify(res?.servers ?? {})
      if (snapshot !== _lastMcpSnapshot) {
        _lastMcpSnapshot = snapshot
        // Update references cache via refresh, then re-render right panel
        await refreshReferences()
        renderAll({ loading: false, inputTokens: 0, percentUsed: 0, cumulativeCost: 0, tooltipHtml: '' })
      }
    } catch (_) {}
  }

  _mcpPollTimer = setInterval(pollMcp, MCP_POLL_INTERVAL_MS)

  // ── Fetch instance version once on init from /health ──────────────────────

  async function fetchVersion() {
    try {
      const health = await fetchHealth()
      if (health?.version) {
        _instanceVersion = health.version
      }
    } catch (_) {
      // Health probe failed — version stays as "local" placeholder
    }
  }

  // ── Public VCS branch setter (called from SSE handler) ────────────────────
  function setBranch(branch) {
    if (branch !== _vcsBranch) {
      _vcsBranch = branch
      // Light re-render — only if visible
      refresh()
    }
  }

  // Expose so SSE can call it
  window.__rightPanelSetBranch = setBranch
  window.__refreshRightPanel   = refresh

  // Initial render
  renderAll({ loading: false, inputTokens: 0, percentUsed: 0, cumulativeCost: 0, tooltipHtml: '' })
  refresh()

  // Fetch version in background — re-render instance block once resolved
  fetchVersion().then(() => {
    renderAll({ loading: false, inputTokens: 0, percentUsed: 0, cumulativeCost: 0, tooltipHtml: '' })
  })

  // ── Destroy ────────────────────────────────────────────────────────────────
  function destroy() {
    if (_unsub)   _unsub()
    if (_unsubDir) _unsubDir()
    if (_mcpPollTimer) clearInterval(_mcpPollTimer)
    delete window.__rightPanelSetBranch
    delete window.__refreshRightPanel
    container.innerHTML = ''
  }

  return { refresh, destroy }
}
