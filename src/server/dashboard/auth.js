// auth.js — Token handling: query param, sessionStorage, and gate UI
import { setState } from './state.js'

const STORAGE_KEY = 'pilot_token'

/**
 * Resolve token from URL → sessionStorage → gate UI.
 * Returns a Promise that resolves to the token string once known.
 */
export function resolveToken() {
  // 1. Check URL query param
  const params = new URLSearchParams(location.search)
  const urlToken = params.get('token')
  if (urlToken) {
    sessionStorage.setItem(STORAGE_KEY, urlToken)
    history.replaceState({}, '', location.pathname)
    return Promise.resolve(urlToken)
  }

  // 2. Check sessionStorage
  const stored = sessionStorage.getItem(STORAGE_KEY)
  if (stored) return Promise.resolve(stored)

  // 3. Show gate UI and wait for user input
  return promptTokenGate()
}

function promptTokenGate() {
  return new Promise(resolve => {
    const gate = document.getElementById('token-gate')
    gate.style.display = 'flex'

    const submit = () => {
      const val = document.getElementById('token-input').value.trim()
      if (!val) return
      sessionStorage.setItem(STORAGE_KEY, val)
      gate.style.display = 'none'
      resolve(val)
    }

    document.getElementById('token-submit').addEventListener('click', submit)
    document.getElementById('token-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') submit()
    })
  })
}

export function saveToken(token) {
  sessionStorage.setItem(STORAGE_KEY, token)
  setState({ token })
}
