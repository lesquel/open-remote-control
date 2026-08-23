const STORAGE_KEY = 'pilot_activity_center_v1'
const MAX_ENTRIES = 100
const MAX_TEXT = 200

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return (normalized || fallback).slice(0, MAX_TEXT)
}

function validEntry(value) {
  return value && typeof value === 'object' && typeof value.id === 'string' &&
    typeof value.kind === 'string' && typeof value.title === 'string' &&
    Number.isFinite(value.createdAt) && !Number.isNaN(new Date(value.createdAt).getTime())
}

export function createActivityStore({ storage, now = Date.now } = {}) {
  let sequence = 0
  let entries = []
  const listeners = new Set()
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(parsed)) entries = parsed.filter(validEntry).slice(0, MAX_ENTRIES)
  } catch { entries = [] }

  function list() { return entries.map(entry => ({ ...entry })) }
  function persist() {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(entries)) } catch { /* UI remains usable */ }
    for (const listener of listeners) listener(list())
  }
  function add(input) {
    const key = text(input.key)
    if (key) {
      const existing = entries.find(entry => entry.key === key)
      if (existing) return { ...existing }
    }
    const entry = {
      id: `${now()}-${sequence++}`, key, kind: text(input.kind, 'event'),
      title: text(input.title, 'Activity'), detail: text(input.detail),
      sessionID: text(input.sessionID), project: text(input.project), createdAt: now(),
      attention: input.attention === true, resolved: input.resolved === true, read: false,
    }
    entries = [entry, ...entries].slice(0, MAX_ENTRIES)
    persist()
    return { ...entry }
  }
  function resolve(key) {
    let changed = false
    entries = entries.map(entry => {
      if (entry.key !== key || entry.resolved) return entry
      changed = true
      return { ...entry, resolved: true, attention: false }
    })
    if (changed) persist()
    return changed
  }
  function markAllRead() {
    if (!entries.some(entry => !entry.read)) return
    entries = entries.map(entry => ({ ...entry, read: true }))
    persist()
  }
  function clearRecent() {
    entries = entries.filter(entry => entry.attention && !entry.resolved)
    persist()
  }
  function counts() {
    return {
      unread: entries.filter(entry => !entry.read).length,
      attention: entries.filter(entry => entry.attention && !entry.resolved).length,
    }
  }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
  return { list, add, resolve, markAllRead, clearRecent, counts, subscribe }
}

let defaultStore = null
export function getActivityStore() {
  if (!defaultStore) defaultStore = createActivityStore({ storage: globalThis.localStorage })
  return defaultStore
}
