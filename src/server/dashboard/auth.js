// auth.js — Token handling: query param, localStorage, and no-token screen
import { setState } from './state.js'

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
  if (stored) return Promise.resolve(stored)

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
        Run <code>/remote</code> from OpenCode to open a fresh link,
        or click below to clear the stale token and try again.
      </p>
      <button class="btn btn-primary no-token-retry" id="no-token-retry">
        Clear token & reload
      </button>
    </div>
  `
  gate.style.display = 'flex'
  const app = document.getElementById('app')
  if (app) app.style.display = 'none'
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
}
