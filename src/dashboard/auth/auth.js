// auth.js — Token handling: query param, localStorage, and no-token screen
import { setState, getState } from '../state/state.js'
import { resetTokenInvalidated } from '../api/api.js'
import { closeEventSource } from '../sse/sse.js'

const STORAGE_KEY = 'pilot_token'

/**
 * Resolve token from URL → localStorage → no-token screen.
 * Returns a Promise that resolves to the token string once known,
 * or rejects with an Error if the user has no token.
 *
 * localStorage is used (not sessionStorage) so the token survives
 * browser restarts and is shared across tabs on the same origin.
 */
export function resolveToken() {
  // 1. Check URL query param (e.g. from QR scan or banner link)
  const params = new URLSearchParams(location.search)
  const urlToken = params.get('token')
  if (urlToken) {
    localStorage.setItem(STORAGE_KEY, urlToken)
    // Clean up the URL so the token doesn't linger in history
    history.replaceState({}, '', location.pathname)
    return Promise.resolve(urlToken)
  }

  // 2. Check localStorage (persistent across reloads + restarts)
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    // A stored token is considered valid at boot; reset the guard so that
    // any future 401 (e.g. from a second OpenCode restart) can surface the
    // recovery UI again.
    resetTokenInvalidated()
    return Promise.resolve(stored)
  }

  // 3. No token anywhere — show the "scan QR" screen.
  //    This Promise never resolves: the user must either scan the QR or
  //    reload the page from a link that contains ?token=...
  showNoTokenScreen()
  return Promise.reject(new Error('NO_TOKEN'))
}

/**
 * Discard the currently-stored token. Used when the server rejects a request
 * with 401 — the token in localStorage is clearly stale (OpenCode restarted,
 * generating a fresh token; the one we saved from the previous session no
 * longer matches). Leaving it in localStorage would mean every subsequent
 * request keeps 401ing forever.
 *
 * Introduced in 1.13.15 for issue #1 follow-up — the "token inválido" report.
 */
export function clearStoredToken() {
  localStorage.removeItem(STORAGE_KEY)
  setState({ token: null })
}

/**
 * Render a screen telling the user there is no token stored and
 * that they need to scan the QR code from their OpenCode terminal.
 */
function showNoTokenScreen() {
  const gate = document.getElementById('token-gate')
  if (!gate) return
  gate.innerHTML = `
    <div class="no-token-card">
      <h2>No token found</h2>
      <p>
        Scan the QR code from your OpenCode terminal, or open the link
        shown in your banner.
      </p>
      <button class="btn btn-primary no-token-retry" id="no-token-retry">
        Try again
      </button>
    </div>
  `
  gate.style.display = 'flex'
  const retry = document.getElementById('no-token-retry')
  if (retry) {
    retry.addEventListener('click', () => location.reload())
  }
}

/**
 * Render a screen specifically for the "token rejected by server" case
 * (HTTP 401 from any endpoint). This is NOT the same as "no token in
 * localStorage" — the user HAS a token, it just doesn't match what the
 * server is expecting (usually because OpenCode restarted and rotated
 * tokens between sessions). The recovery is always the same: re-open
 * via `/remote` from the TUI to pick up the current token.
 */
export function showTokenExpiredScreen() {
  try { closeEventSource() } catch (_) {}
  const gate = document.getElementById('token-gate')
  if (!gate) return
  gate.innerHTML = `
    <div class="no-token-card">
      <h2>Token expired</h2>
      <p>
        OpenCode has restarted since you last opened the dashboard.
        The token we had in your browser no longer matches the running
        server.
      </p>
      <p style="margin-top: 0.75rem; color: var(--muted);">
        Run <code>/remote</code> from OpenCode to get a fresh dashboard URL,
        then paste it below.
      </p>
      <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
        <input
          id="token-url-input"
          class="input"
          type="url"
          placeholder="Paste new dashboard URL here"
          style="flex: 1; min-width: 0;"
        />
        <button class="btn btn-primary" id="token-url-submit">
          Use this URL
        </button>
      </div>
      <p id="token-url-error" style="display: none; margin-top: 0.5rem; color: var(--error, #f87171); font-size: 0.875rem;"></p>
      <p style="margin-top: 1rem; color: var(--muted); font-size: 0.875rem;">
        Or clear the stale token and reload to start fresh:
      </p>
      <button class="btn btn-secondary no-token-retry" id="no-token-retry" style="margin-top: 0.25rem;">
        Clear token & reload
      </button>
    </div>
  `
  gate.style.display = 'flex'
  const app = document.getElementById('app')
  if (app) app.style.display = 'none'

  const urlInput = document.getElementById('token-url-input')
  const urlSubmit = document.getElementById('token-url-submit')
  const urlError = document.getElementById('token-url-error')

  if (urlSubmit) {
    urlSubmit.addEventListener('click', () => {
      const raw = urlInput ? urlInput.value.trim() : ''
      if (!raw) {
        showUrlError('Please paste a URL.')
        return
      }
      let parsed
      try {
        parsed = new URL(raw)
      } catch (_) {
        showUrlError('That doesn\'t look like a valid URL.')
        return
      }
      const token = parsed.searchParams.get('token')
      if (!token) {
        showUrlError('That URL doesn\'t contain a token.')
        return
      }
      saveToken(token)
      location.reload()
    })
  }

  if (urlInput) {
    urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') urlSubmit && urlSubmit.click()
    })
  }

  function showUrlError(msg) {
    if (!urlError) return
    urlError.textContent = msg
    urlError.style.display = 'block'
  }

  const retry = document.getElementById('no-token-retry')
  if (retry) {
    retry.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY)
      location.reload()
    })
  }
}

export function saveToken(token) {
  localStorage.setItem(STORAGE_KEY, token)
  setState({ token })
  // New token is valid — allow future 401s to surface the recovery UI again.
  resetTokenInvalidated()
}

// ── Visibility-change token validation (Bug 1) ────────────────────────────
// When the tab becomes visible after being hidden (e.g. user left tab open
// overnight), validate the stored token against /status. If it 401s, the
// server rotated tokens while we were away, so show the recovery screen
// immediately instead of waiting for a user action to trigger a 401.

let _lastValidationTs = 0
const VALIDATION_COOLDOWN_MS = 30_000

async function validateStoredToken() {
  const token = localStorage.getItem(STORAGE_KEY)
  if (!token) return // nothing to validate

  const now = Date.now()
  if (now - _lastValidationTs < VALIDATION_COOLDOWN_MS) return
  _lastValidationTs = now

  try {
    // Use /status (auth-required) as the lightweight validation probe.
    // serverUrl is empty string in embedded (same-origin) mode.
    const serverUrl = getState().serverUrl || ''
    const r = await fetch(serverUrl + '/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.status === 401) {
      showTokenExpiredScreen()
    }
  } catch (_) {
    // Network error (server down, offline) — don't show the screen; let normal
    // request flow handle it when the user actually tries to do something.
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      validateStoredToken()
    }
  })
}
