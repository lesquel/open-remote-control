// sessions.js — Sessions list, single-session panel, send prompt, abort
import { getState, setState } from './state.js'
import { fetchSessions, createSession as apiCreateSession, sendPromptWithOpts, abortSession as apiAbortSession } from './api.js'
import { loadMessages } from './messages.js'
import { loadDiff } from './diff.js'
import { toast } from './toast.js'
import { loadSubagents } from './subagents.js'
import { refreshFilesChanged } from './files-changed-bridge.js'

// Dynamic import to break circular dependency with multi-view.js
async function addToMultiview(id) {
  const { addToMultiview: fn } = await import('./multi-view.js')
  return fn(id)
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function statusClass(s) {
  if (s === 'busy' || s === 'running') return 'busy'
  if (s === 'error') return 'error'
  return 'idle'
}

export function timeAgo(ts) {
  if (!ts) return ''
  const d = Math.floor((Date.now() - ts) / 1000)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Folder helpers ─────────────────────────────────────────────────────────

const FOLDER_STORAGE_KEY = 'pilot_folder_collapsed'

/**
 * Shorten a directory path for display.
 * - Replace home prefix with ~
 * - Truncate to last 2 segments if longer than 3 segments
 */
function shortenPath(dir) {
  if (!dir) return '(unknown)'
  // Replace common home prefixes with ~
  let p = dir
  // /home/<user>/... or /Users/<user>/...
  p = p.replace(/^\/(?:home|Users)\/[^/]+/, '~')
  const parts = p.split('/').filter(Boolean)
  if (parts.length <= 3) return p
  return `…/${parts.slice(-2).join('/')}`
}

/**
 * Get the collapsed state for all folders from localStorage.
 * Returns a plain object: { [folderPath]: bool (true = collapsed) }
 */
function getFolderCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(FOLDER_STORAGE_KEY) || '{}')
  } catch (_) {
    return {}
  }
}

function setFolderCollapsed(path, collapsed) {
  try {
    const current = getFolderCollapsed()
    current[path] = collapsed
    localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(current))
  } catch (_) {}
}

/**
 * Group session ids by directory.
 * Returns an array of { dir, label, ids, maxUpdated } sorted:
 *   1. folder with active session first
 *   2. then by most recent maxUpdated desc
 */
function groupSessionsByFolder(ids, sessions, activeSession) {
  const groups = new Map() // dir → { ids, maxUpdated }
  for (const id of ids) {
    const s = sessions[id]
    const dir = s?.directory || '(unknown)'
    if (!groups.has(dir)) groups.set(dir, { ids: [], maxUpdated: 0 })
    const g = groups.get(dir)
    g.ids.push(id)
    const upd = s?.time?.updated ?? 0
    if (upd > g.maxUpdated) g.maxUpdated = upd
  }

  const activeDir = activeSession ? (sessions[activeSession]?.directory || '(unknown)') : null

  return Array.from(groups.entries())
    .map(([dir, g]) => ({
      dir,
      label: shortenPath(dir),
      ids: g.ids.sort((a, b) => (sessions[b]?.time?.updated ?? 0) - (sessions[a]?.time?.updated ?? 0)),
      maxUpdated: g.maxUpdated,
      hasActive: dir === activeDir,
    }))
    .sort((a, b) => {
      if (a.hasActive && !b.hasActive) return -1
      if (!a.hasActive && b.hasActive) return 1
      // unknown always last
      if (a.dir === '(unknown)' && b.dir !== '(unknown)') return 1
      if (a.dir !== '(unknown)' && b.dir === '(unknown)') return -1
      return b.maxUpdated - a.maxUpdated
    })
}

// ── Load & render sessions list ────────────────────────────────────────────

export async function loadSessions(autoSelectMostRecent) {
  try {
    const data = await fetchSessions()
    const sessions = {}
    const statuses = data.statuses ?? {}
    for (const s of (data.sessions ?? [])) sessions[s.id] = s
    setState({ sessions, statuses })
    updateAgentFilterOptions()
    renderSessions()
    if (autoSelectMostRecent && !getState().activeSession) autoSelect()
    const { multiviewActive } = getState()
    if (multiviewActive) {
      const { renderMultiviewGrid } = await import('./multi-view.js')
      renderMultiviewGrid()
    }
  } catch (_) {
    toast('Failed to load sessions')
  }
}

function autoSelect() {
  const { sessions } = getState()
  const ids = Object.keys(sessions)
  if (!ids.length) return
  const best = ids.reduce((a, b) => {
    const ta = sessions[a]?.time?.updated ?? 0
    const tb = sessions[b]?.time?.updated ?? 0
    return tb > ta ? b : a
  })
  selectSession(best)
}

export function renderSessions() {
  const { sessions, statuses, activeSession, mvPanels, agentFilter } = getState()
  const list = document.getElementById('sessions-list')
  let ids = Object.keys(sessions)

  if (!ids.length) {
    list.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:.82rem;text-align:center">No sessions yet</div>'
    return
  }

  // Filter by agent if set
  if (agentFilter) {
    ids = ids.filter(id => sessionAgent(sessions[id]) === agentFilter)
    if (!ids.length) {
      list.innerHTML = `<div style="padding:16px;color:var(--text-dim);font-size:.82rem;text-align:center;line-height:1.5">No sessions match agent: <b>${esc(agentFilter)}</b><br><a href="#" id="clear-agent-filter" style="color:var(--accent);text-decoration:none">Clear filter</a></div>`
      const clear = document.getElementById('clear-agent-filter')
      if (clear) {
        clear.addEventListener('click', (e) => {
          e.preventDefault()
          setState({ agentFilter: '' })
          const sel = document.getElementById('agent-filter')
          if (sel) sel.value = ''
          renderSessions()
        })
      }
      return
    }
  }

  const scrollTop = list.scrollTop
  const collapsed = getFolderCollapsed()
  const folders = groupSessionsByFolder(ids, sessions, activeSession)

  const html = folders.map(folder => {
    // Active-session folder is expanded by default; others collapsed by default.
    // User override stored in localStorage takes precedence.
    let isCollapsed
    if (Object.prototype.hasOwnProperty.call(collapsed, folder.dir)) {
      isCollapsed = collapsed[folder.dir]
    } else {
      // default: expanded if it contains the active session, collapsed otherwise
      isCollapsed = !folder.hasActive
    }

    const chevron = isCollapsed ? '▸' : '▾'
    const accentBorder = folder.hasActive ? ' folder-row--active' : ''
    const count = folder.ids.length

    const folderRow = `<div class="folder-row${accentBorder}" data-folder-dir="${esc(folder.dir)}" data-collapsed="${isCollapsed}">
      <span class="folder-chevron${isCollapsed ? ' folder-chevron--collapsed' : ''}">${chevron}</span>
      <span class="folder-label" title="${esc(folder.dir)}">${esc(folder.label)}</span>
      <span class="folder-count">${count}</span>
    </div>`

    const childrenHtml = folder.ids.map(id => {
      const s = sessions[id]
      const status = statuses[id] ?? 'idle'
      const title = s.title || id.slice(0, 8)
      const cls = id === activeSession ? 'active' : ''
      const ago = timeAgo(s?.time?.updated)
      const inMV = mvPanels.has(id) ? ' style="border-left-color:var(--warning)"' : ''
      const agent = sessionAgent(s)
      const agentBadge = agent
        ? `<span class="agent-badge agent-badge--compact ${agentBadgeClass(agent)}" title="${esc(agent)}">${esc(truncateAgent(agent))}</span>`
        : ''
      return `<div class="session-item ${cls}" data-id="${id}"${inMV}>
        <div class="session-title">${esc(title)}</div>
        <div class="session-meta">
          ${agentBadge}
          <span class="badge badge-${statusClass(status)}">${status}</span>
          ${ago ? `<span class="session-time">${ago}</span>` : ''}
        </div>
      </div>`
    }).join('')

    const childrenStyle = isCollapsed ? 'display:none' : ''
    return `${folderRow}<div class="folder-children" style="${childrenStyle}">${childrenHtml}</div>`
  }).join('')

  list.innerHTML = html

  // Restore scroll position
  list.scrollTop = scrollTop

  // Wire folder toggle
  list.querySelectorAll('.folder-row').forEach(el => {
    el.addEventListener('click', () => {
      const dir = el.dataset.folderDir
      const wasCollapsed = el.dataset.collapsed === 'true'
      const nowCollapsed = !wasCollapsed
      setFolderCollapsed(dir, nowCollapsed)
      // Update DOM directly (no full re-render to preserve scroll)
      el.dataset.collapsed = String(nowCollapsed)
      const chevronEl = el.querySelector('.folder-chevron')
      if (chevronEl) {
        chevronEl.textContent = nowCollapsed ? '▸' : '▾'
        chevronEl.classList.toggle('folder-chevron--collapsed', nowCollapsed)
      }
      const children = el.nextElementSibling
      if (children && children.classList.contains('folder-children')) {
        children.style.display = nowCollapsed ? 'none' : ''
      }
    })
  })

  // Wire session clicks
  list.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      const { multiviewActive } = getState()
      if (multiviewActive) {
        addToMultiview(el.dataset.id)
      } else {
        selectSession(el.dataset.id)
      }
    })
  })
}

/**
 * Collapse all folders or expand all folders.
 * direction: 'collapse' | 'expand'
 */
export function setAllFoldersCollapsed(direction) {
  const { sessions, activeSession } = getState()
  const ids = Object.keys(sessions)
  const folders = groupSessionsByFolder(ids, sessions, activeSession)
  const collapsed = getFolderCollapsed()
  for (const f of folders) {
    collapsed[f.dir] = direction === 'collapse'
  }
  try {
    localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(collapsed))
  } catch (_) {}
  renderSessions()
}

/**
 * Populate the #agent-filter <select> with unique agent strings from all
 * current sessions. Preserves the current selection if still valid.
 */
export function updateAgentFilterOptions() {
  const sel = document.getElementById('agent-filter')
  if (!sel) return
  const { sessions, agentFilter } = getState()
  const unique = new Set()
  for (const id of Object.keys(sessions)) {
    const a = sessionAgent(sessions[id])
    if (a) unique.add(a)
  }
  const agents = Array.from(unique).sort((a, b) => a.localeCompare(b))
  const current = agentFilter || ''
  const options = ['<option value="">All</option>']
    .concat(agents.map(a => `<option value="${esc(a)}"${a === current ? ' selected' : ''}>${esc(a)}</option>`))
  sel.innerHTML = options.join('')
  // If the previously selected agent disappeared, reset state and selection
  if (current && !unique.has(current)) {
    setState({ agentFilter: '' })
    sel.value = ''
  }
}

// ── Select session ─────────────────────────────────────────────────────────

export async function selectSession(id) {
  const { sessions, statuses } = getState()
  setState({ activeSession: id })
  const s = sessions[id]
  const status = statuses[id] ?? 'idle'
  const title = s?.title || id?.slice(0, 8) || 'Session'
  renderSessions()
  updateHeaderSession(title, status)
  updateInfoBar(id, title, status, s)
  document.getElementById('session-tabs').style.display = ''
  const input = document.getElementById('prompt-input')
  input.disabled = false
  input.placeholder = 'Type a prompt… (Enter to send)'
  await loadMessages(id)
  // Load subagents tree for this session (non-blocking)
  loadSubagents(id).catch(() => {})
  // Refresh files changed panel (non-blocking)
  refreshFilesChanged(id)
  input.focus()
  // Load diff tab if it's currently active
  if (document.getElementById('diff-tab').classList.contains('active')) {
    loadDiff(id)
  }
}

export function updateHeaderSession(title, status) {
  const label = document.getElementById('header-session-label')
  const badge = document.getElementById('header-status-badge')
  if (label) label.textContent = title
  if (badge) {
    badge.textContent = status
    badge.className = `badge badge-${statusClass(status)}`
    badge.style.display = ''
  }
}

/**
 * Classify an agent mode string for badge styling.
 * Known modes: "plan", "build"; anything else → "custom".
 */
export function agentBadgeClass(mode) {
  if (mode === 'plan') return 'agent-badge--plan'
  if (mode === 'build') return 'agent-badge--build'
  return 'agent-badge--custom'
}

/**
 * Read the agent/mode from a session object, tolerating the several shapes
 * the OpenCode SDK uses across versions.
 *
 * Covers:
 *   - s.mode as string ("plan", "build", …)
 *   - s.agent as string (custom agents like "sdd-orchestrator", "pr-review")
 *   - s.mode / s.agent as { name: string }
 */
export function sessionAgent(s) {
  if (!s) return null
  const raw = s.mode ?? s.agent ?? null
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (raw && typeof raw === 'object' && typeof raw.name === 'string' && raw.name.trim()) {
    return raw.name.trim()
  }
  return null
}

/**
 * Truncate an agent label so it fits the compact list badge.
 * Keeps a leading ellipsis-friendly slice of up to N chars.
 */
function truncateAgent(name, max = 12) {
  if (!name) return ''
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

export function updateInfoBar(id, title, status, session) {
  const bar = document.getElementById('session-info-bar')
  bar.classList.remove('hidden')
  document.getElementById('info-title').textContent = title
  const statusBadge = document.getElementById('info-status-badge')
  statusBadge.textContent = status
  statusBadge.className = `badge badge-${statusClass(status)}`

  // Full session ID — copyable, prominent
  const infoId = document.getElementById('info-id')
  infoId.textContent = id
  const copyAll = () => {
    navigator.clipboard?.writeText(id)
    toast('Session ID copied')
  }
  infoId.onclick = copyAll
  const copyBtn = document.getElementById('info-id-copy')
  if (copyBtn) copyBtn.onclick = copyAll

  // TUI hint
  const hint = document.getElementById('info-id-hint')
  if (hint) {
    hint.innerHTML = `Resume in TUI: <code>opencode --session ${esc(id)}</code>`
  }

  // Agent badge on the session header (if the session exposes a mode/agent)
  const agentBadge = document.getElementById('info-agent-badge')
  const agent = sessionAgent(session)
  if (agentBadge) {
    if (agent) {
      agentBadge.textContent = agent
      agentBadge.className = `agent-badge ${agentBadgeClass(agent)}`
      agentBadge.style.display = ''
    } else {
      agentBadge.style.display = 'none'
    }
  }

  const abortBtn = document.getElementById('abort-btn')
  if (status === 'busy' || status === 'running') abortBtn.classList.add('visible')
  else abortBtn.classList.remove('visible')
}

// ── Create session ─────────────────────────────────────────────────────────

export async function createSession() {
  try {
    const s = await apiCreateSession()
    if (s?.id) {
      const { sessions, multiviewActive } = getState()
      setState({ sessions: { ...sessions, [s.id]: s } })
      updateAgentFilterOptions()
      renderSessions()
      if (multiviewActive) {
        addToMultiview(s.id)
      } else {
        selectSession(s.id)
      }
    }
  } catch (_) {
    toast('Failed to create session')
  }
}

// ── Send prompt ────────────────────────────────────────────────────────────

async function sendPrompt() {
  const { activeSession } = getState()
  if (!activeSession) { toast('Select a session first'); return }
  const input = document.getElementById('prompt-input')
  const msg = input.value.trim()
  if (!msg) return
  // Push to command history before clearing
  window.__commandHistory?.push(msg)
  input.value = ''
  input.style.height = ''
  try {
    // Read agent/model preferences set by command-palette (if any)
    const opts = {}
    try {
      const paletteMod = await import('./command-palette.js')
      const agentPref = paletteMod.getActiveSessionAgentPref?.()
      const modelPref = paletteMod.getActiveSessionModelPref?.()
      if (agentPref) opts.agent = agentPref
      if (modelPref?.modelId) {
        opts.modelID    = modelPref.modelId
        opts.providerID = modelPref.providerId ?? ''
      }
    } catch (_) {}
    await sendPromptWithOpts(activeSession, msg, opts)
    // Clear pending label indicator after successful send
    window.__labelStripSetPending?.(null)
    await loadMessages(activeSession)
  } catch (err) {
    toast(`Failed to send prompt: ${err?.message ?? 'unknown error'}`)
  }
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      tab.classList.add('active')
      document.getElementById(tab.dataset.tab)?.classList.add('active')
      const { activeSession } = getState()
      if (tab.dataset.tab === 'diff-tab' && activeSession) loadDiff(activeSession)
    })
  })
}

// ── Wire up DOM events ─────────────────────────────────────────────────────

export function initSessions() {
  initTabs()

  document.getElementById('send-btn').addEventListener('click', sendPrompt)

  document.getElementById('prompt-input').addEventListener('keydown', e => {
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && e.ctrlKey)) {
      e.preventDefault()
      sendPrompt()
    }
  })

  document.getElementById('prompt-input').addEventListener('input', function() {
    this.style.height = ''
    this.style.height = Math.min(this.scrollHeight, 120) + 'px'
  })

  document.getElementById('abort-btn').addEventListener('click', async () => {
    const { activeSession } = getState()
    if (!activeSession) return
    try {
      await apiAbortSession(activeSession)
      toast('Session aborted')
    } catch (_) {
      toast('Failed to abort')
    }
  })

  document.getElementById('header-new-btn').addEventListener('click', createSession)
  document.getElementById('new-session-big').addEventListener('click', createSession)
  document.getElementById('no-session-new-btn').addEventListener('click', createSession)

  const agentFilterSelect = document.getElementById('agent-filter')
  if (agentFilterSelect) {
    agentFilterSelect.addEventListener('change', () => {
      setState({ agentFilter: agentFilterSelect.value })
      renderSessions()
    })
  }

  // Alt+[ = collapse all folders; Alt+] = expand all folders
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === '[') { e.preventDefault(); setAllFoldersCollapsed('collapse') }
    if (e.altKey && e.key === ']') { e.preventDefault(); setAllFoldersCollapsed('expand') }
  })
}
