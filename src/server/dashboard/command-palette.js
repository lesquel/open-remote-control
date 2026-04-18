// command-palette.js — Fuzzy-searchable command palette (Ctrl+P / Cmd+K)
// Intentionally untested visual code.
import { getState, setState, setActiveDirectory, getActiveDirectory } from './state.js'
import { createSession, selectSession, statusClass, loadSessions, deleteSessionById } from './sessions.js'
import { toast } from './toast.js'
import { getAgents, getProviders, getConnectedProviders } from './references.js'
import { sendPromptWithOpts, fetchProjects, updateSessionTitle } from './api.js'
import { openDebugModal } from './debug-modal.js'

// Per-session agent preference (client-side only, resets on reload)
const _sessionAgentPrefs = new Map()

// Per-session model preference (client-side only, resets on reload)
const _sessionModelPrefs = new Map()

// LS key for active directory (replaces legacy pilot_active_project)
const LS_ACTIVE_DIR_KEY = 'pilot_active_directory'

export function getActiveSessionModelPref() {
  const { activeSession } = getState()
  return activeSession ? _sessionModelPrefs.get(activeSession) ?? null : null
}

// ── Path shortener (mirrors sessions.js — no shared module to avoid dep) ──
function shortenPath(dir) {
  if (!dir) return '(unknown)'
  let p = dir.replace(/^\/(?:home|Users)\/[^/]+/, '~')
  const parts = p.split('/').filter(Boolean)
  if (parts.length <= 3) return p
  return `…/${parts.slice(-2).join('/')}`
}

// ── Fuzzy match ────────────────────────────────────────────────────────────
/**
 * Simple fuzzy match: returns { matched: bool, score: number, html: string }
 * Higher score = better match. html wraps matched chars in <mark>.
 */
function fuzzyMatch(str, query) {
  if (!query) return { matched: true, score: 0, html: escHtml(str) }
  const s = str.toLowerCase()
  const q = query.toLowerCase()
  let si = 0, qi = 0, score = 0
  const chars = []
  while (si < s.length && qi < q.length) {
    if (s[si] === q[qi]) {
      chars.push({ ch: str[si], match: true })
      score += (si === qi) ? 2 : 1  // bonus for positional match
      qi++
    } else {
      chars.push({ ch: str[si], match: false })
    }
    si++
  }
  if (qi < q.length) return { matched: false, score: 0, html: escHtml(str) }
  // append remainder
  while (si < str.length) { chars.push({ ch: str[si], match: false }); si++ }
  const html = chars.map(c => c.match ? `<mark>${escHtml(c.ch)}</mark>` : escHtml(c.ch)).join('')
  return { matched: true, score, html }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── State ──────────────────────────────────────────────────────────────────
let isOpen = false
let selectedIndex = 0
let currentItems = []  // flat list of rendered items for keyboard nav

// ── Open / Close ───────────────────────────────────────────────────────────

export function openPalette() {
  const el = document.getElementById('command-palette')
  if (!el) return
  el.classList.add('open')
  isOpen = true
  selectedIndex = 0
  const input = document.getElementById('palette-input')
  input.value = ''
  renderPaletteList('')
  input.focus()
}

export function closePalette() {
  const el = document.getElementById('command-palette')
  if (!el) return
  el.classList.remove('open')
  isOpen = false
}

export function togglePalette() {
  if (isOpen) closePalette(); else openPalette()
}

// ── Build item list ────────────────────────────────────────────────────────

function buildItems(query) {
  const { sessions, statuses, activeSession, settings } = getState()
  const items = []

  // ── Sessions ──
  const sessionIds = Object.keys(sessions)
    .sort((a, b) => (sessions[b]?.time?.updated ?? 0) - (sessions[a]?.time?.updated ?? 0))

  for (const id of sessionIds) {
    const s = sessions[id]
    const label = s?.title || id.slice(0, 8)
    const fm = fuzzyMatch(label, query)
    if (!fm.matched && query) continue
    const status = statuses[id] ?? 'idle'
    const folderLabel = shortenPath(s?.directory)
    items.push({
      section: 'Sessions',
      icon: id === activeSession ? '▶' : '○',
      labelHtml: `${fm.html}<span class="palette-item-folder">${escHtml(folderLabel)}</span>`,
      label,
      meta: status,
      metaClass: `badge badge-${statusClass(status)}`,
      score: fm.score + (id === activeSession ? 10 : 0),
      action: () => {
        closePalette()
        selectSession(id)
      },
    })
  }

  // ── Actions ──
  const actions = [
    { label: 'New Session',          icon: '+', kbd: 'alt+n', action: () => { closePalette(); createSession() } },
    { label: 'Rename Session',       icon: '✎', action: () => { closePalette(); renameActiveSession() } },
    { label: 'Delete Session',       icon: '✕', variant: 'danger', action: () => { closePalette(); deleteActiveSession() } },
    { label: 'Delete old sessions (>30 days)', icon: '⌫', variant: 'danger', action: () => { closePalette(); deleteOldSessions() } },
    { label: 'Copy Session ID',      icon: '⊕', action: () => { closePalette(); copySessionId() } },
    { label: 'Resume in TUI',        icon: '↩', action: () => { closePalette(); copyTuiCommand() } },
    { label: 'Switch Folder',        icon: '▤', kbd: 'alt+f', action: () => { closePalette(); openFolderPicker() } },
    { label: 'Collapse All Folders', icon: '▸', kbd: 'alt+[', action: () => { closePalette(); import('./sessions.js').then(m => m.setAllFoldersCollapsed('collapse')) } },
    { label: 'Expand All Folders',   icon: '▾', kbd: 'alt+]', action: () => { closePalette(); import('./sessions.js').then(m => m.setAllFoldersCollapsed('expand')) } },
    { label: 'Toggle Theme',         icon: '◑', kbd: 'alt+t', action: () => { closePalette(); toggleTheme() } },
    { label: 'Toggle Sound',         icon: '♪', action: () => { closePalette(); toggleSound() } },
    { label: 'Toggle Hide Tools',    icon: '⊟', action: () => { closePalette(); toggleTools() } },
    { label: 'Open Settings',        icon: '⚙', action: () => { closePalette(); openSettings() } },
    { label: 'Scan QR / Connect',    icon: '▣', action: () => { closePalette(); toast('Reload with ?token= or scan the QR from your terminal') } },
    { label: 'Rotate Token',         icon: '↺', action: () => { closePalette(); rotateToken() } },
    // ── References actions ───────────────────────────────────────────────────
    { label: 'Switch Agent',         icon: '◈', action: () => { closePalette(); openAgentPicker() } },
    { label: 'Switch Model',         icon: '◇', action: () => { closePalette(); openModelPicker() } },
    { label: 'Open Project',         icon: '▤', action: () => { closePalette(); openProjectPicker() } },
    { label: 'Show Agent Context',   icon: '◉', action: () => { closePalette(); window.__agentPanel?.open?.() } },
    { label: 'Refresh References',   icon: '⟳', action: () => { closePalette(); window.__refreshReferences?.().then(() => toast('References refreshed')) } },
    { label: 'Show Debug Info',      icon: '⚑', action: () => { closePalette(); openDebugModal() } },
    { label: 'Clear Prompt History', icon: '⌫', action: () => {
      closePalette()
      if (!confirm('Clear all prompt history?')) return
      window.__commandHistory?.clearHistory()
      toast('Prompt history cleared')
    }},
  ]

  for (const a of actions) {
    if (query) {
      const fm = fuzzyMatch(a.label, query)
      if (!fm.matched) continue
      a.labelHtml = fm.html
      a.score = fm.score
    } else {
      a.labelHtml = escHtml(a.label)
      a.score = 0
    }
    items.push({ ...a, section: 'Actions' })
  }

  // ── Subagents (if current session has any) ──
  // They live in DOM — read from sessions state children via API lazily
  // We skip this if no query and section is too noisy; shown when query matches
  const { subagentItems } = getPaletteSubagentItems(query)
  items.push(...subagentItems)

  return items
}

function getPaletteSubagentItems(query) {
  // Sub-agent items are derived from sessions that are children of the active session.
  // Since we don't have a direct in-memory children list, we use sessions that have parentId.
  const { sessions, statuses, activeSession } = getState()
  const subagentItems = []
  for (const id of Object.keys(sessions)) {
    const s = sessions[id]
    const parentId = s?.parentId ?? s?.parent ?? null
    if (!parentId || parentId !== activeSession) continue
    const label = s?.title || id.slice(0, 8)
    const fm = fuzzyMatch(label, query)
    if (!fm.matched && query) continue
    const status = statuses[id] ?? 'idle'
    subagentItems.push({
      section: 'Subagents',
      icon: '⇢',
      labelHtml: fm.matched ? fm.html : escHtml(label),
      label,
      meta: status,
      metaClass: `badge badge-${statusClass(status)}`,
      score: fm.score,
      action: () => { closePalette(); selectSession(id) },
    })
  }
  return { subagentItems }
}

// ── Actions helpers ────────────────────────────────────────────────────────

/**
 * Open a mini folder picker: list all unique directories → select the most
 * recent session in the chosen folder.
 */
function openFolderPicker() {
  const { sessions, statuses } = getState()
  const ids = Object.keys(sessions)
  if (!ids.length) { toast('No sessions'); return }

  // Build folder list sorted by most-recent session
  const folderMap = new Map() // dir → { ids, maxUpdated }
  for (const id of ids) {
    const s = sessions[id]
    const dir = s?.directory || '(unknown)'
    if (!folderMap.has(dir)) folderMap.set(dir, { ids: [], maxUpdated: 0 })
    const g = folderMap.get(dir)
    g.ids.push(id)
    const upd = s?.time?.updated ?? 0
    if (upd > g.maxUpdated) g.maxUpdated = upd
  }

  const folders = Array.from(folderMap.entries())
    .sort((a, b) => {
      if (a[0] === '(unknown)') return 1
      if (b[0] === '(unknown)') return -1
      return b[1].maxUpdated - a[1].maxUpdated
    })

  if (folders.length === 1) {
    // Only one folder — jump to most recent session in it directly
    const [, g] = folders[0]
    const best = g.ids.sort((a, b) => (sessions[b]?.time?.updated ?? 0) - (sessions[a]?.time?.updated ?? 0))[0]
    selectSession(best)
    return
  }

  // Build a sub-palette overlay for folder selection
  const overlay = document.getElementById('command-palette')
  if (!overlay) return

  const listEl = document.getElementById('palette-list')
  if (!listEl) return

  let selIdx = 0

  const folderItems = folders.map(([dir, g], i) => {
    const label = shortenPath(dir)
    const count = g.ids.length
    const bestId = g.ids.sort((a, b) => (sessions[b]?.time?.updated ?? 0) - (sessions[a]?.time?.updated ?? 0))[0]
    return { label, dir, count, bestId }
  })

  const render = () => {
    listEl.innerHTML = `<div class="palette-section">
      <div class="palette-section-label">Switch Folder</div>
      ${folderItems.map((f, i) => `
        <div class="palette-item${i === selIdx ? ' selected' : ''}" data-folder-idx="${i}">
          <span class="palette-item-icon">▤</span>
          <span class="palette-item-label">${escHtml(f.label)}</span>
          <span class="palette-item-meta" style="color:var(--text-muted);font-size:10px">${f.count} session${f.count !== 1 ? 's' : ''}</span>
        </div>`).join('')}
    </div>`

    listEl.querySelectorAll('.palette-item[data-folder-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.folderIdx, 10)
        if (!isNaN(idx) && folderItems[idx]) {
          closePalette()
          selectSession(folderItems[idx].bestId)
        }
      })
    })
  }

  render()

  // Temporary keyboard handler for folder picker
  const input = document.getElementById('palette-input')
  const originalValue = input.value
  input.value = ''
  input.placeholder = 'Select folder…'

  const keyHandler = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = (selIdx + 1) % folderItems.length; render() }
    if (e.key === 'ArrowUp')   { e.preventDefault(); selIdx = (selIdx - 1 + folderItems.length) % folderItems.length; render() }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (folderItems[selIdx]) {
        closePalette()
        selectSession(folderItems[selIdx].bestId)
      }
      input.removeEventListener('keydown', keyHandler)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closePalette()
      input.removeEventListener('keydown', keyHandler)
    }
    e.stopImmediatePropagation()
  }
  input.addEventListener('keydown', keyHandler)
}

/**
 * Open a mini agent picker. Lets the user select an agent for the active session.
 * If the backend /sessions/:id/prompt accepts `agent` in the body, the next
 * prompt sent via sendPromptWithOpts will include it.
 * NOTE: We check api.js sendPromptWithOpts — it now accepts an optional agent param
 * and forwards it. Whether the backend handler processes it depends on the handlers.ts
 * implementation by the backend subagent.
 */
function openAgentPicker() {
  const { activeSession } = getState()
  const agents = getAgents()

  if (!agents.length) {
    toast('No agents found — try "Refresh References" first')
    return
  }

  const overlay = document.getElementById('command-palette')
  if (!overlay) return
  overlay.classList.add('open')
  isOpen = true

  const listEl = document.getElementById('palette-list')
  if (!listEl) return

  let selIdx = 0

  const renderAgentList = () => {
    listEl.innerHTML = `<div class="palette-section">
      <div class="palette-section-label">Switch Agent (next prompt)</div>
      ${agents.map((a, i) => `
        <div class="palette-item${i === selIdx ? ' selected' : ''}" data-agent-idx="${i}">
          <span class="palette-item-icon">◈</span>
          <span class="palette-item-label">${escHtml(a.name)}</span>
          ${a.description ? `<span class="palette-item-meta" style="color:var(--text-muted);font-size:10px">${escHtml(a.description.slice(0, 50))}</span>` : ''}
        </div>`).join('')}
    </div>`

    listEl.querySelectorAll('.palette-item[data-agent-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.agentIdx, 10)
        if (!isNaN(idx) && agents[idx]) {
          applyAgentChoice(agents[idx].name)
        }
      })
    })
  }

  const applyAgentChoice = (agentName) => {
    closePalette()
    if (!activeSession) {
      toast('No session selected')
      return
    }
    _sessionAgentPrefs.set(activeSession, agentName)
    // Immediately update label strip with pending indicator (B2 / B3 fix)
    window.__labelStripSetPending?.({ agent: agentName })
    toast(`Agent set to "${agentName}" for next prompt`)
  }

  renderAgentList()

  const input = document.getElementById('palette-input')
  input.value = ''
  input.placeholder = 'Select agent…'
  input.focus()

  const keyHandler = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = (selIdx + 1) % agents.length; renderAgentList() }
    if (e.key === 'ArrowUp')   { e.preventDefault(); selIdx = (selIdx - 1 + agents.length) % agents.length; renderAgentList() }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (agents[selIdx]) applyAgentChoice(agents[selIdx].name)
      input.removeEventListener('keydown', keyHandler)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closePalette()
      input.removeEventListener('keydown', keyHandler)
    }
    e.stopImmediatePropagation()
  }
  input.addEventListener('keydown', keyHandler)
}

/**
 * Open a model picker. Lists all models from connected providers.
 * Sets a per-session model preference used in sendPromptWithOpts.
 */
function openModelPicker() {
  const { activeSession } = getState()
  const providers  = getProviders()
  const connected  = getConnectedProviders()

  // Flatten models from connected providers
  const modelItems = []

  // "Default" entry at top
  modelItems.push({ label: 'Default (OpenCode decides)', providerName: '', modelId: null, providerId: null, isDefault: true })

  for (const provider of providers) {
    // Only connected providers
    if (!connected.includes(provider.id)) continue
    const providerName = provider.name ?? provider.id
    const models = provider.models ?? {}
    for (const [, model] of Object.entries(models)) {
      const modelName = model.name ?? model.id ?? '(unknown)'
      modelItems.push({
        label: `${providerName} / ${modelName}`,
        providerName,
        modelId:    model.id ?? null,
        providerId: provider.id,
        isDefault:  false,
      })
    }
  }

  if (modelItems.length <= 1) {
    toast('No models found — try "Refresh References" first')
    return
  }

  const overlay = document.getElementById('command-palette')
  if (!overlay) return
  overlay.classList.add('open')
  isOpen = true

  const listEl = document.getElementById('palette-list')
  if (!listEl) return

  let selIdx = 0
  const currentPref = activeSession ? _sessionModelPrefs.get(activeSession) ?? null : null

  const renderModelList = () => {
    listEl.innerHTML = `<div class="palette-section">
      <div class="palette-section-label">Switch Model (next prompt)</div>
      ${modelItems.map((m, i) => {
        const isActive = m.isDefault ? !currentPref : (currentPref?.modelId === m.modelId && currentPref?.providerId === m.providerId)
        return `<div class="palette-item${i === selIdx ? ' selected' : ''}" data-model-idx="${i}">
          <span class="palette-item-icon">${isActive ? '✓' : '◇'}</span>
          <span class="palette-item-label">${escHtml(m.label)}</span>
        </div>`
      }).join('')}
    </div>`

    listEl.querySelectorAll('.palette-item[data-model-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.modelIdx, 10)
        if (!isNaN(idx) && modelItems[idx]) applyModelChoice(modelItems[idx])
      })
    })
  }

  const applyModelChoice = (item) => {
    closePalette()
    if (!activeSession) { toast('No session selected'); return }
    if (item.isDefault) {
      _sessionModelPrefs.delete(activeSession)
      // Clear pending indicator
      window.__labelStripSetPending?.(null)
      toast('Model reset to OpenCode default')
    } else {
      _sessionModelPrefs.set(activeSession, { modelId: item.modelId, providerId: item.providerId })
      // Immediately update label strip with pending indicator (B2 fix)
      window.__labelStripSetPending?.({ modelID: item.modelId, providerID: item.providerId })
      toast(`Model set to "${item.label}" for next prompt`)
    }
  }

  renderModelList()

  const input = document.getElementById('palette-input')
  input.value = ''
  input.placeholder = 'Select model…'
  input.focus()

  const keyHandler = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = (selIdx + 1) % modelItems.length; renderModelList() }
    if (e.key === 'ArrowUp')   { e.preventDefault(); selIdx = (selIdx - 1 + modelItems.length) % modelItems.length; renderModelList() }
    if (e.key === 'Enter')     { e.preventDefault(); if (modelItems[selIdx]) applyModelChoice(modelItems[selIdx]); input.removeEventListener('keydown', keyHandler) }
    if (e.key === 'Escape')    { e.preventDefault(); closePalette(); input.removeEventListener('keydown', keyHandler) }
    e.stopImmediatePropagation()
  }
  input.addEventListener('keydown', keyHandler)
}

/**
 * Open a project picker. Lists all projects from /projects.
 * Switching a project sets activeDirectory which routes all subsequent API calls
 * to that project's instance via ?directory= query param.
 */
async function openProjectPicker() {
  let projects = []
  try {
    const res = await fetchProjects()
    projects = Array.isArray(res) ? res : (res?.projects ?? [])
  } catch (_) {
    toast('Could not fetch projects')
    return
  }

  if (!projects.length) {
    toast('No projects found')
    return
  }

  const overlay = document.getElementById('command-palette')
  if (!overlay) return
  overlay.classList.add('open')
  isOpen = true

  const listEl = document.getElementById('palette-list')
  if (!listEl) return

  let selIdx = 0

  // Read current active directory from state
  const currentDir = getActiveDirectory()

  // Build items: "Default (back to OpenCode default)" at top + one per project
  const items = [
    { label: 'Default (back to OpenCode instance)', path: null, isDefault: true },
    ...projects.map(p => ({
      label:     p.name ?? shortenPath(p.path ?? p.root ?? ''),
      path:      p.path ?? p.root ?? null,
      isDefault: false,
    })),
  ]

  const renderProjectList = () => {
    listEl.innerHTML = `<div class="palette-section">
      <div class="palette-section-label">Open Project (routes all API calls)</div>
      ${items.map((it, i) => {
        const isActive = it.isDefault ? !currentDir : (currentDir === it.path)
        return `<div class="palette-item${i === selIdx ? ' selected' : ''}" data-proj-idx="${i}">
          <span class="palette-item-icon">${isActive ? '✓' : '▤'}</span>
          <span class="palette-item-label">${escHtml(it.label)}</span>
          ${it.path ? `<span class="palette-item-folder">${escHtml(shortenPath(it.path))}</span>` : ''}
        </div>`
      }).join('')}
    </div>`

    listEl.querySelectorAll('.palette-item[data-proj-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.projIdx, 10)
        if (!isNaN(idx) && items[idx]) applyProjectChoice(items[idx])
      })
    })
  }

  const applyProjectChoice = async (item) => {
    closePalette()
    const newDir = item.isDefault ? null : item.path

    // 1. Update state — this makes api.js append ?directory= to all subsequent calls
    setActiveDirectory(newDir)

    // 2. Persist to localStorage
    try {
      if (newDir) localStorage.setItem(LS_ACTIVE_DIR_KEY, newDir)
      else        localStorage.removeItem(LS_ACTIVE_DIR_KEY)
    } catch (_) {}

    // 3. Clear active session (it belongs to the old project)
    setState({ activeSession: null, sessions: {}, statuses: {} })

    // 3b. Clear the files-changed panel (belonged to the old session/project)
    try {
      const { refreshFilesChanged } = await import('./files-changed-bridge.js')
      refreshFilesChanged(null)
    } catch (_) {}

    // 4. Re-fetch references (agents / providers / MCP / project) for new directory — AWAIT it
    try {
      await window.__refreshReferences?.()
    } catch (_) {}

    // 5. Re-fetch sessions for the new directory (after references are ready)
    await loadSessions()

    // 6. Refresh right panel and label strip to reflect new path/model
    window.__refreshRightPanel?.()
    window.__refreshLabelStrip?.()

    // 7. Toast
    const shortLabel = newDir ? shortenPath(newDir) : 'default instance'
    toast(`Switched to: ${shortLabel}`)
  }

  renderProjectList()

  const input = document.getElementById('palette-input')
  input.value = ''
  input.placeholder = 'Select project…'
  input.focus()

  const keyHandler = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = (selIdx + 1) % items.length; renderProjectList() }
    if (e.key === 'ArrowUp')   { e.preventDefault(); selIdx = (selIdx - 1 + items.length) % items.length; renderProjectList() }
    if (e.key === 'Enter')     { e.preventDefault(); if (items[selIdx]) applyProjectChoice(items[selIdx]); input.removeEventListener('keydown', keyHandler) }
    if (e.key === 'Escape')    { e.preventDefault(); closePalette(); input.removeEventListener('keydown', keyHandler) }
    e.stopImmediatePropagation()
  }
  input.addEventListener('keydown', keyHandler)
}

/**
 * Expose the current session agent preference so sessions.js / prompt sender
 * can read it before sending.
 */
export function getActiveSessionAgentPref() {
  const { activeSession } = getState()
  return activeSession ? _sessionAgentPrefs.get(activeSession) ?? null : null
}

function copySessionId() {
  const { activeSession } = getState()
  if (!activeSession) { toast('No session selected'); return }
  navigator.clipboard?.writeText(activeSession)
  toast('Session ID copied')
}

async function renameActiveSession() {
  const { activeSession, sessions } = getState()
  if (!activeSession) { toast('No session selected'); return }
  const current = sessions[activeSession]?.title ?? ''
  const next = window.prompt('Rename session', current)
  if (next === null) return
  const trimmed = next.trim()
  if (!trimmed || trimmed === current) return
  try {
    await updateSessionTitle(activeSession, trimmed)
    // Optimistic local update — SSE session.updated will sync the rest
    const nextSessions = { ...sessions, [activeSession]: { ...sessions[activeSession], title: trimmed } }
    setState({ sessions: nextSessions })
    const { renderSessions, updateHeaderSession, updateInfoBar } = await import('./sessions.js')
    renderSessions()
    const { statuses } = getState()
    const status = statuses[activeSession] ?? 'idle'
    updateHeaderSession(trimmed, status)
    updateInfoBar(activeSession, trimmed, status, nextSessions[activeSession])
    toast('Session renamed')
  } catch (err) {
    toast(`Rename failed: ${err?.message ?? 'unknown error'}`)
  }
}

async function deleteActiveSession() {
  const { activeSession, sessions } = getState()
  if (!activeSession) { toast('No session selected'); return }
  const title = sessions[activeSession]?.title || activeSession.slice(0, 8)
  if (!window.confirm(`Delete session "${title}"? This cannot be undone.`)) return
  await deleteSessionById(activeSession)
}

async function deleteOldSessions() {
  const { sessions } = getState()
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - THIRTY_DAYS_MS
  const candidates = Object.values(sessions).filter(s => {
    const t = s?.time?.updated ?? s?.time?.created ?? 0
    return t > 0 && t < cutoff
  })

  if (!candidates.length) {
    toast('No sessions older than 30 days')
    return
  }

  if (!window.confirm(`Delete ${candidates.length} session(s) older than 30 days? This cannot be undone.`)) {
    return
  }

  let done = 0
  let failed = 0
  for (const s of candidates) {
    try {
      const ok = await deleteSessionById(s.id, s.directory ? { directory: s.directory } : {})
      if (ok) done++
      else failed++
    } catch (_) {
      failed++
    }
    // Progress toast every few deletions
    if (done % 5 === 0 || done + failed === candidates.length) {
      toast(`Deleting old sessions: ${done + failed}/${candidates.length}`)
    }
  }
  toast(`Deleted ${done} session(s)${failed ? ` (${failed} failed)` : ''}`)
}

function copyTuiCommand() {
  const { activeSession } = getState()
  if (!activeSession) { toast('No session selected'); return }
  const cmd = `opencode --session ${activeSession}`
  navigator.clipboard?.writeText(cmd)
  toast('TUI command copied')
}

function toggleTheme() {
  const { settings } = getState()
  const next = { ...settings, theme: !settings.theme }
  setState({ settings: next })
  document.body.classList.toggle('theme-light', next.theme)
  try {
    const saved = JSON.parse(sessionStorage.getItem('pilot_settings') || '{}')
    sessionStorage.setItem('pilot_settings', JSON.stringify({ ...saved, theme: next.theme }))
  } catch (_) {}
  // Sync with settings checkboxes
  const el = document.getElementById('s-theme')
  if (el) el.checked = next.theme
  toast(next.theme ? 'Light theme on' : 'Dark theme on')
}

function toggleSound() {
  const { settings } = getState()
  const next = { ...settings, sound: !settings.sound }
  setState({ settings: next })
  try {
    const saved = JSON.parse(sessionStorage.getItem('pilot_settings') || '{}')
    sessionStorage.setItem('pilot_settings', JSON.stringify({ ...saved, sound: next.sound }))
  } catch (_) {}
  const el = document.getElementById('s-sound')
  if (el) el.checked = next.sound
  toast(next.sound ? 'Sound on' : 'Sound off')
}

function toggleTools() {
  const { settings } = getState()
  const next = { ...settings, tools: !settings.tools }
  setState({ settings: next })
  try {
    const saved = JSON.parse(sessionStorage.getItem('pilot_settings') || '{}')
    sessionStorage.setItem('pilot_settings', JSON.stringify({ ...saved, tools: next.tools }))
  } catch (_) {}
  const el = document.getElementById('s-tools')
  if (el) el.checked = next.tools
  document.querySelectorAll('.tool-block').forEach(tb => tb.classList.toggle('hidden-tools', !next.tools))
  toast(next.tools ? 'Tool calls visible' : 'Tool calls hidden')
}

function openSettings() {
  document.getElementById('settings-modal')?.classList.add('open')
}

async function rotateToken() {
  if (!confirm('Rotate auth token? The current token will stop working immediately.')) return
  try {
    const { token } = await import('./api.js').then(m => m.rotateAuthToken())
    if (!token) {
      toast('Rotation succeeded but no new token returned')
      return
    }
    const state = await import('./state.js').then(m => m.getState())
    localStorage.setItem('pilot_token', token)
    state.token = token
    toast('Token rotated. Reconnecting with the new token…')
    setTimeout(() => location.reload(), 600)
  } catch (err) {
    toast(`Rotate failed: ${err && err.message ? err.message : 'unknown error'}`)
  }
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderPaletteList(query) {
  const listEl = document.getElementById('palette-list')
  if (!listEl) return

  const allItems = buildItems(query)
  currentItems = allItems

  if (!allItems.length) {
    listEl.innerHTML = `<div class="palette-empty">No results for "${escHtml(query)}"</div>`
    selectedIndex = 0
    return
  }

  // Group by section
  const sections = {}
  for (const item of allItems) {
    if (!sections[item.section]) sections[item.section] = []
    sections[item.section].push(item)
  }

  // Sort within each section by score descending
  for (const sec of Object.keys(sections)) {
    sections[sec].sort((a, b) => b.score - a.score)
  }

  // Flatten back for keyboard nav tracking
  currentItems = Object.values(sections).flat()

  let html = ''
  let globalIdx = 0
  for (const [sectionName, items] of Object.entries(sections)) {
    html += `<div class="palette-section">
      <div class="palette-section-label">${escHtml(sectionName)}</div>`
    for (const item of items) {
      const sel = globalIdx === selectedIndex ? ' selected' : ''
      const kbdHtml = item.kbd
        ? `<span class="palette-item-kbd">${escHtml(item.kbd)}</span>`
        : ''
      const metaHtml = item.meta && !item.kbd
        ? `<span class="palette-item-meta ${item.metaClass ?? ''}">${escHtml(item.meta)}</span>`
        : ''
      const variantClass = item.variant === 'danger' ? ' palette-item--danger' : ''
      html += `<div class="palette-item${sel}${variantClass}" data-idx="${globalIdx}">
        <span class="palette-item-icon">${escHtml(item.icon ?? '○')}</span>
        <span class="palette-item-label">${item.labelHtml}</span>
        ${metaHtml}${kbdHtml}
      </div>`
      globalIdx++
    }
    html += '</div>'
  }

  listEl.innerHTML = html

  // Wire click handlers
  listEl.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx, 10)
      if (!isNaN(idx) && currentItems[idx]) {
        currentItems[idx].action()
      }
    })
  })
}

function updateSelection(delta) {
  if (!currentItems.length) return
  selectedIndex = (selectedIndex + delta + currentItems.length) % currentItems.length
  const listEl = document.getElementById('palette-list')
  if (!listEl) return
  listEl.querySelectorAll('.palette-item').forEach((el, i) => {
    el.classList.toggle('selected', i === selectedIndex)
  })
  // Scroll into view
  const selected = listEl.querySelector('.palette-item.selected')
  selected?.scrollIntoView({ block: 'nearest' })
}

function confirmSelection() {
  if (currentItems[selectedIndex]) {
    currentItems[selectedIndex].action()
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

export function initCommandPalette() {
  const overlay = document.getElementById('command-palette')
  if (!overlay) return

  const input = document.getElementById('palette-input')

  input?.addEventListener('input', e => {
    selectedIndex = 0
    renderPaletteList(e.target.value)
  })

  input?.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); updateSelection(1); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); updateSelection(-1); return }
    if (e.key === 'Enter')     { e.preventDefault(); confirmSelection(); return }
    if (e.key === 'Escape')    { e.preventDefault(); closePalette(); return }
  })

  // Click outside to close
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closePalette()
  })
}
