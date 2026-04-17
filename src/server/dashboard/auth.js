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

export function saveToken(token) {
  localStorage.setItem(STORAGE_KEY, token)
  setState({ token })
}
