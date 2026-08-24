// bootstrap.js — non-module dashboard boot work that must run before main.js.
// Kept external so the dashboard can use a strict script-src 'self' CSP.

;(function clearStaleAssets() {
  try {
    // The version is injected into the script URL by index.html templating, so
    // the same bootstrap asset works for both the local server and GitHub Pages.
    const scriptUrl = document.currentScript?.src ?? location.href
    const generation = new URL(scriptUrl).searchParams.get('generation')
    if (!generation) return
    const key = 'pilot:asset-gen'
    if (localStorage.getItem(key) === generation) return
    localStorage.setItem(key, generation)

    const serviceWorkers = 'serviceWorker' in navigator
      ? navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined)
      : Promise.resolve()
    const cachedAssets = window.caches && typeof caches.keys === 'function'
      ? caches.keys()
        .then((keys) => Promise.all(keys.map((keyName) => caches.delete(keyName))))
        .catch(() => undefined)
      : Promise.resolve()

    Promise.all([serviceWorkers, cachedAssets]).then(() => {
      // The localStorage generation flag makes this reload single-shot.
      setTimeout(() => location.reload(), 50)
    })
  } catch {
    // Cache cleanup must never stop the dashboard from loading.
  }
})()

;(function applyThemeBeforePaint() {
  try {
    let saved = localStorage.getItem('pilot-theme')
    if (!saved) {
      const legacy = localStorage.getItem('pilot_settings')
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy)
          if (parsed && parsed.theme === true) saved = 'mono-light'
        } catch {
          // Malformed legacy settings fall back to the safe default.
        }
      }
    }
    const themes = ['terminal-green', 'amber', 'violet', 'mono-light']
    const theme = themes.includes(saved) ? saved : 'terminal-green'
    document.documentElement.setAttribute('data-theme', theme)
    if (saved !== theme) {
      try { localStorage.setItem('pilot-theme', theme) } catch {}
    }
  } catch {
    document.documentElement.setAttribute('data-theme', 'terminal-green')
  }
})()

;(function applyDecorations() {
  function setDecorations() {
    try {
      if (localStorage.getItem('pilot-grid') === '1') document.body.setAttribute('data-grid', 'true')
      if (localStorage.getItem('pilot-scanlines') === '1') document.body.setAttribute('data-scanlines', 'true')
    } catch {
      // Decorations are cosmetic and must never block startup.
    }
  }

  if (document.body) setDecorations()
  else document.addEventListener('DOMContentLoaded', setDecorations, { once: true })
})()
