// main.js — Entry point: resolves auth, bootstraps all modules
import { resolveToken } from './auth.js'
import { setState, setActiveDirectory } from './state.js'
import { initMarkdown } from './markdown.js'
import { loadSettings } from './settings.js'
import { loadMVState, initMultiView, showMultiview } from './multi-view.js'
import { loadSessions, initSessions } from './sessions.js'
import { loadPermissions, initPermissions } from './permissions.js'
import { initSettings } from './settings.js'
import { initShortcuts } from './shortcuts.js'
import { connect as sseConnect } from './sse.js'
import { initCommandPalette } from './command-palette.js'
import {
  getConnection,
  saveConnection,
  parseConnectHash,
  showConnectScreen,
} from './connect.js'
import { createFilesChangedPanel } from './files-changed.js'
import { registerFilesChangedPanel } from './files-changed-bridge.js'
import { init as initReferences, refresh as refreshReferences } from './references.js'
import { createLabelStrip } from './label-strip.js'
import { createUsageIndicator } from './usage-indicator.js'
import { createAgentPanel } from './agent-panel.js'
import { createRightPanel } from './right-panel.js'
import { createTodoDock } from './todo-dock.js'
import { createPushNotifications } from './push-notifications.js'
import { createCommandHistory } from './command-history.js'
import { createFileBrowser } from './file-browser.js'

// Expose references refresh globally so command-palette can call it
window.__refreshReferences = refreshReferences

// ── PWA: register service worker (HTTPS only, not localhost) ─────────────
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

// ── Mode detection ───────────────────────────────────────────────────────
function isEmbeddedMode() {
  return ['127.0.0.1', 'localhost'].includes(location.hostname)
}

async function bootstrap() {
  // 1. Check for connect deep-link in URL hash (from QR code scan)
  const fromHash = parseConnectHash()
  if (fromHash) {
    saveConnection(fromHash.serverUrl, fromHash.token)
    history.replaceState(null, '', location.pathname + location.search)
  }

  // 2. Determine mode
  if (isEmbeddedMode()) {
    let token
    try {
      token = await resolveToken()
    } catch {
      return
    }
    if (!token) return
    setState({ serverUrl: '', token })
  } else {
    const conn = getConnection()
    if (!conn) {
      showConnectScreen()
      return
    }
    setState({ serverUrl: conn.serverUrl, token: conn.token })

    const gate = document.getElementById('token-gate')
    if (gate) gate.style.display = 'none'
  }

  // 3. Show app shell
  const app = document.getElementById('app')
  app.style.display = 'flex'

  // 3.5 Restore active directory from localStorage (must happen before any API call)
  try {
    const savedDir = localStorage.getItem('pilot_active_directory')
    if (savedDir) setActiveDirectory(savedDir)
  } catch (_) {}

  // 4. Init references FIRST (agents, models, MCP servers, project) — must
  //    complete before any module that uses getAgent/getModel/getMcpServers.
  await initReferences()

  // 5. Init all modules
  initMarkdown()
  loadSettings()
  loadMVState()

  initSessions()
  initPermissions()
  initSettings()
  initCommandPalette()
  initShortcuts()
  initMultiView()

  // Mount files-changed panel
  const filesContainer = document.getElementById('files-changed-panel')
  if (filesContainer) {
    const filesPanel = createFilesChangedPanel({ container: filesContainer })
    registerFilesChangedPanel(filesPanel)
  }

  // Mount label strip (prompt composer footer — agent · model · provider)
  const labelStripContainer = document.getElementById('input-label-strip')
  if (labelStripContainer) {
    const labelStrip = createLabelStrip({ container: labelStripContainer })
    // Expose refresh so SSE handler can call it on message.updated
    window.__refreshLabelStrip = labelStrip.refresh
  }

  // Mount usage indicator in TUI header (right side)
  const headerEl = document.getElementById('tui-header')
  if (headerEl) {
    const usageEl = document.createElement('div')
    usageEl.id = 'usage-indicator-mount'
    usageEl.className = 'usage-indicator-wrap'
    headerEl.appendChild(usageEl)
    const usageIndicator = createUsageIndicator({ container: usageEl })
    window.__refreshUsageIndicator = usageIndicator.refresh
  }

  // Mount agent context panel (below files-changed in sessions sidebar)
  const sessionsPanel = document.getElementById('sessions-panel')
  if (sessionsPanel) {
    const agentPanelEl = document.createElement('div')
    agentPanelEl.id = 'agent-context-panel'
    agentPanelEl.className = 'agent-panel'
    sessionsPanel.appendChild(agentPanelEl)
    const agentPanel = createAgentPanel({ container: agentPanelEl })
    window.__agentPanel = agentPanel  // exposed for command-palette "Show Agent Context" action
  }

  // Mount file browser panel (below agent context panel, at bottom of sessions sidebar)
  if (sessionsPanel) {
    const fileBrowserEl = document.createElement('div')
    fileBrowserEl.id = 'file-browser-mount'
    sessionsPanel.appendChild(fileBrowserEl)
    const fileBrowser = createFileBrowser({ container: fileBrowserEl })
    window.__fileBrowser = fileBrowser
  }

  // Mount right info panel
  const rightPanelEl = document.getElementById('right-panel')
  if (rightPanelEl) {
    const rightPanel = createRightPanel({ container: rightPanelEl })
    window.__rightPanel = rightPanel
  }

  // Mount todo dock (above messages list, inside messages-tab)
  const todoDockMount = document.getElementById('todo-dock-mount')
  if (todoDockMount) {
    createTodoDock({ container: todoDockMount })
  }

  // Init push notifications (wires settings checkbox + SSE listener)
  createPushNotifications()

  // Init command history for prompt input
  const promptInputEl = document.getElementById('prompt-input')
  if (promptInputEl) {
    const commandHistory = createCommandHistory({
      inputEl: promptInputEl,
      storageKey: 'pilot_prompt_history',
    })
    // Expose push so the send handler (messages.js / shortcuts.js) can call it
    window.__commandHistory = commandHistory
  }

  // Wire footer label strip from label-strip values (sync with existing label-strip)
  function syncFooterLabels() {
    const agentEl    = document.getElementById('lbl-agent')
    const modelEl    = document.getElementById('lbl-model')
    const providerEl = document.getElementById('lbl-provider')
    const fAgent     = document.getElementById('footer-lbl-agent')
    const fModel     = document.getElementById('footer-lbl-model')
    const fProvider  = document.getElementById('footer-lbl-provider')
    if (fAgent && agentEl) {
      fAgent.textContent  = agentEl.textContent
      fAgent.style.color  = agentEl.style.color || ''
    }
    if (fModel    && modelEl)    fModel.textContent    = modelEl.textContent
    if (fProvider && providerEl) fProvider.textContent = providerEl.textContent
  }
  // Patch the label-strip refresh to also sync footer
  const origRefresh = window.__refreshLabelStrip
  if (origRefresh) {
    window.__refreshLabelStrip = async (...args) => {
      await origRefresh(...args)
      syncFooterLabels()
    }
  }
  // Initial sync after a tick
  setTimeout(syncFooterLabels, 200)

  // Alt+I — toggle right panel
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault()
      const rp = document.getElementById('right-panel')
      if (rp) rp.classList.toggle('right-panel--hidden')
    }
  })

  // Footer help button — keymap modal
  const footerHelpBtn = document.getElementById('footer-help-btn')
  const keymapModal   = document.getElementById('keymap-modal')
  const keymapClose   = document.getElementById('keymap-close')
  footerHelpBtn?.addEventListener('click', () => keymapModal?.classList.add('open'))
  keymapClose?.addEventListener('click',   () => keymapModal?.classList.remove('open'))
  keymapModal?.addEventListener('click',   (e) => { if (e.target === keymapModal) keymapModal.classList.remove('open') })

  // Footer action buttons (alt+p handled by shortcuts.js; wire info toggle here too)
  document.getElementById('tui-footer')?.querySelectorAll('.footer-shortcut--btn[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action
      if (action === 'info') {
        document.getElementById('right-panel')?.classList.toggle('right-panel--hidden')
      }
    })
  })

  // 6. Load initial data
  await loadSessions()
  await loadPermissions()

  // 7. Connect SSE
  sseConnect()

  // 8. If multiview was restored, show it
  const { multiviewActive } = (await import('./state.js')).getState()
  if (multiviewActive) showMultiview()
}

bootstrap()
