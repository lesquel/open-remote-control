// state.js — Single source of truth for app state with simple pub/sub
const listeners = new Map() // key → Set<callback>

const state = {
  token: null,
  sessions: {},      // id → session object
  statuses: {},      // id → status string
  activeSession: null,
  multiviewActive: false,
  mvPanels: new Set(), // sessionIds open in multi-view
  pendingPerms: [],
  settings: {
    sound: false,
    notif: false,
    theme: false,    // false = dark
    tools: true,
  },
  sse: { connected: false },
}

export function getState() {
  return state
}

export function setState(patch) {
  Object.assign(state, patch)
  notifyAll()
}

export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(callback)
  return () => listeners.get(key).delete(callback)
}

function notifyAll() {
  for (const [, set] of listeners) {
    for (const cb of set) cb(state)
  }
}
