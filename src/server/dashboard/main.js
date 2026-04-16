// main.js — Entry point: resolves auth, bootstraps all modules
import { resolveToken, saveToken } from './auth.js'
import { setState } from './state.js'
import { initMarkdown } from './markdown.js'
import { loadSettings } from './settings.js'
import { loadMVState, initMultiView, showMultiview } from './multi-view.js'
import { loadSessions, initSessions } from './sessions.js'
import { loadPermissions, initPermissions } from './permissions.js'
import { initSettings } from './settings.js'
import { initShortcuts } from './shortcuts.js'
import { connect as sseConnect } from './sse.js'

async function bootstrap() {
  const token = await resolveToken()
  if (!token) return

  setState({ token })

  // Show app shell
  document.getElementById('token-gate').style.display = 'none'
  const app = document.getElementById('app')
  app.style.display = 'flex'

  // Init all modules
  initMarkdown()
  loadSettings()
  loadMVState()

  initSessions()
  initPermissions()
  initSettings()
  initShortcuts()
  initMultiView()

  // Load initial data
  await loadSessions()
  await loadPermissions()

  // Connect SSE (triggers loadSessions on open)
  sseConnect()

  // If multiview was restored, show it
  const { multiviewActive } = (await import('./state.js')).getState()
  if (multiviewActive) showMultiview()
}

bootstrap()
