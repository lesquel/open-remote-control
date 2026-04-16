// main.js — Entry point: resolves auth, bootstraps all modules
import { resolveToken } from './auth.js'
import { setState } from './state.js'
import { initMarkdown } from './markdown.js'
import { loadSettings } from './settings.js'
import { loadMVState, initMultiView, showMultiview } from './multi-view.js'
import { loadSessions, initSessions } from './sessions.js'
import { loadPermissions, initPermissions } from './permissions.js'
import { initSettings } from './settings.js'
import { initShortcuts } from './shortcuts.js'
import { connect as sseConnect } from './sse.js'
import {
  getConnection,
  saveConnection,
  parseConnectHash,
  showConnectScreen,
} from './connect.js'

// ── PWA: register service worker (HTTPS only, not localhost) ─────────────────
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

// ── Mode detection ───────────────────────────────────────────────────────────
function isEmbeddedMode() {
  return ['127.0.0.1', 'localhost'].includes(location.hostname)
}

async function bootstrap() {
  // 1. Check for connect deep-link in URL hash (from QR code scan)
  const fromHash = parseConnectHash()
  if (fromHash) {
    saveConnection(fromHash.serverUrl, fromHash.token)
    // Remove the hash so it doesn't linger in history
    history.replaceState(null, '', location.pathname + location.search)
  }

  // 2. Determine mode
  if (isEmbeddedMode()) {
    // ── Embedded mode ──────────────────────────────────────────────────────
    // Served by the plugin at 127.0.0.1; API is same-origin; token via URL/storage/gate
    const token = await resolveToken()
    if (!token) return
    setState({ serverUrl: '', token })
  } else {
    // ── Standalone mode ────────────────────────────────────────────────────
    // Deployed on GitHub Pages or another host; needs saved server URL + token
    const conn = getConnection()
    if (!conn) {
      showConnectScreen()
      return
    }
    setState({ serverUrl: conn.serverUrl, token: conn.token })

    // Hide the embedded token gate — we manage auth ourselves in standalone mode
    const gate = document.getElementById('token-gate')
    if (gate) gate.style.display = 'none'
  }

  // 3. Show app shell
  const app = document.getElementById('app')
  app.style.display = 'flex'

  // 4. Init all modules
  initMarkdown()
  loadSettings()
  loadMVState()

  initSessions()
  initPermissions()
  initSettings()
  initShortcuts()
  initMultiView()

  // 5. Load initial data
  await loadSessions()
  await loadPermissions()

  // 6. Connect SSE (triggers loadSessions on open)
  sseConnect()

  // 7. If multiview was restored, show it
  const { multiviewActive } = (await import('./state.js')).getState()
  if (multiviewActive) showMultiview()
}

bootstrap()
