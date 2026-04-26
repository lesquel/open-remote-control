// push-notifications.js — Browser push notifications for pending permissions
// Factory: createPushNotifications({ state }) → { requestPermission, notify, destroy }
//
// Design notes:
// - Never auto-prompts. Only calls Notification.requestPermission() when the user
//   explicitly enables notifications via the settings checkbox.
// - Two layers:
//     1. Local Notification API — fires on SSE events while the tab is hidden.
//     2. Web Push — real server push via the Service Worker, works even when the
//        tab is closed. Gated by VAPID keys on the server.
// - Graceful degradation: hides the settings row if Notification API is unavailable.

import { pushPublicKey, pushSubscribe, pushUnsubscribe } from '../api/api.js'
import { toast } from './toast.js'

const LS_NOTIF_KEY = 'pilot_push_notif_enabled'
const LS_PUSH_ENDPOINT_KEY = 'pilot_push_endpoint'

// Convert a URL-safe base64 VAPID key to the Uint8Array expected by pushManager.subscribe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const out = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i)
  return out
}

export function createPushNotifications() {
  // ── Feature detection ────────────────────────────────────────────────────
  const supported = typeof Notification !== 'undefined'

  // Hide the settings row entirely if unsupported
  const settingRow = document.getElementById('push-notif-setting-row')
  if (!supported && settingRow) {
    settingRow.style.display = 'none'
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _isEnabled() {
    try { return localStorage.getItem(LS_NOTIF_KEY) === 'true' } catch (_) { return false }
  }

  function _setEnabled(val) {
    try { localStorage.setItem(LS_NOTIF_KEY, String(val)) } catch (_) {}
  }

  // ── Sync checkbox state on open ──────────────────────────────────────────
  function _syncCheckbox() {
    const cb = document.getElementById('s-push-notif')
    if (!cb) return
    if (!supported) { cb.disabled = true; return }

    const perm = Notification.permission
    // If browser denied, disable the checkbox
    if (perm === 'denied') {
      cb.disabled = true
      cb.checked = false
      cb.title = 'Notifications blocked by browser. Allow in site settings.'
      _setEnabled(false)
      return
    }
    cb.disabled = false
    // Restore from localStorage (respects user preference across reloads)
    cb.checked = perm === 'granted' && _isEnabled()
  }

  // ── Request permission ────────────────────────────────────────────────────
  async function requestPermission() {
    if (!supported) return 'unavailable'
    if (Notification.permission === 'granted') return 'granted'
    if (Notification.permission === 'denied')  return 'denied'
    try {
      const result = await Notification.requestPermission()
      return result
    } catch (_) {
      return 'error'
    }
  }

  // ── Send a notification ──────────────────────────────────────────────────
  function notify({ title, body, tag, onClick }) {
    if (!supported) return
    if (Notification.permission !== 'granted') return

    const n = new Notification(title ?? 'OpenCode Pilot', {
      body: body ?? '',
      icon: './icons/icon.svg',
      tag:  tag ?? 'pilot-notif',
      requireInteraction: false,
    })

    n.onclick = () => {
      window.focus()
      if (typeof onClick === 'function') onClick()
      n.close()
    }
  }

  // ── SSE event handler ─────────────────────────────────────────────────────
  // Listens to the custom DOM event dispatched from sse.js bridge
  function _onPermissionPending(e) {
    if (!document.hidden) return       // tab is visible — banner handles it
    if (!_isEnabled()) return
    if (!supported) return
    if (Notification.permission !== 'granted') return

    const payload = e.detail ?? {}
    const desc = String(payload?.tool ?? payload?.description ?? 'Tool needs permission')
    const body = desc.length > 80 ? desc.slice(0, 77) + '…' : desc

    notify({
      title: 'OpenCode Pilot — permission needed',
      body,
      tag: 'pilot-perm-' + (payload?.id ?? Date.now()),
      onClick: () => {
        // Focus the tab + surface the permissions banner
        const banner = document.getElementById('perm-banner')
        banner?.scrollIntoView?.({ behavior: 'smooth' })
      },
    })
  }

  window.addEventListener('pilot:permission:pending', _onPermissionPending)

  // ── Test notification (for settings UI) ──────────────────────────────────
  function testNotification() {
    notify({
      title: 'OpenCode Pilot — test notification',
      body: 'Notifications are working correctly.',
      tag: 'pilot-test',
    })
  }

  // ── Web Push subscription (secondary layer) ───────────────────────────────
  // Register the SW on localhost too (bypasses the HTTPS-only gate in main.js).
  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) return null
    const isLocalhost = ['127.0.0.1', 'localhost'].includes(location.hostname)
    if (location.protocol !== 'https:' && !isLocalhost) return null
    try {
      let reg = await navigator.serviceWorker.getRegistration('./sw.js')
      if (!reg) reg = await navigator.serviceWorker.register('./sw.js')
      return await navigator.serviceWorker.ready
    } catch (e) {
      console.warn('[pilot:push] SW register failed', e)
      return null
    }
  }

  function _ensureStatusEl() {
    let el = document.getElementById('push-notif-status')
    if (el) return el
    const row = document.getElementById('push-notif-setting-row')
    if (!row) return null
    el = document.createElement('div')
    el.id = 'push-notif-status'
    el.style.fontSize = '11px'
    el.style.marginTop = '4px'
    el.style.opacity = '0.8'
    el.style.display = 'none'
    row.appendChild(el)
    return el
  }

  function _setWebPushStatus(msg, isError = false) {
    const el = _ensureStatusEl()
    if (!el) return
    el.textContent = msg || ''
    el.style.color = isError ? 'var(--color-error, #c33)' : ''
    el.style.display = msg ? '' : 'none'
  }

  async function _enableWebPush() {
    const reg = await ensureServiceWorker()
    if (!reg || !('pushManager' in reg)) {
      _setWebPushStatus('Web Push unsupported in this browser', true)
      return false
    }
    let publicKey = null
    try {
      publicKey = await pushPublicKey()
    } catch (err) {
      _setWebPushStatus('Could not reach server', true)
      return false
    }
    if (!publicKey) {
      _setWebPushStatus(
        'Server VAPID keys missing. Set PILOT_VAPID_PUBLIC_KEY and PILOT_VAPID_PRIVATE_KEY.',
        true,
      )
      return false
    }
    try {
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        try { localStorage.removeItem(LS_PUSH_ENDPOINT_KEY) } catch (_) {}
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }
      await pushSubscribe(sub.toJSON())
      try { localStorage.setItem(LS_PUSH_ENDPOINT_KEY, sub.endpoint) } catch (_) {}
      _setWebPushStatus('Push notifications active')
      return true
    } catch (err) {
      console.warn('[pilot:push] subscribe failed', err)
      _setWebPushStatus('Subscription failed: ' + (err?.message ?? 'unknown'), true)
      return false
    }
  }

  async function _disableWebPush() {
    const reg = await ensureServiceWorker()
    if (!reg || !('pushManager' in reg)) return
    try {
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const endpoint = sub.endpoint
        try { localStorage.removeItem(LS_PUSH_ENDPOINT_KEY) } catch (_) {}
        await sub.unsubscribe().catch(() => {})
        try { await pushUnsubscribe(endpoint) } catch (_) {}
      }
    } catch (_) {}
    _setWebPushStatus('')
  }

  // ── Checkbox wiring (called after settings modal DOM is ready) ────────────
  function _wireSettingsModal() {
    const cb       = document.getElementById('s-push-notif')
    const testBtn  = document.getElementById('push-notif-test-btn')

    if (!cb) return

    _syncCheckbox()

    cb.addEventListener('change', async (e) => {
      if (!e.target.checked) {
        _setEnabled(false)
        if (testBtn) testBtn.style.display = 'none'
        // Best-effort: tear down Web Push subscription too
        _disableWebPush().catch(() => {})
        return
      }

      // User opted in — request permission
      const result = await requestPermission()
      if (result === 'granted') {
        _setEnabled(true)
        if (testBtn) testBtn.style.display = ''
        _syncCheckbox()
        toast('Push notifications enabled')
        // Best-effort: also upgrade to Web Push for background delivery
        _enableWebPush().catch((err) => console.warn('[pilot:push] enable failed', err))
      } else {
        // Denied or dismissed
        e.target.checked = false
        _setEnabled(false)
        if (result === 'denied') {
          e.target.disabled = true
          e.target.title = 'Notifications blocked by browser. Allow in site settings.'
          toast('Notifications blocked by browser. Allow in site settings.')
        } else {
          toast('Notification permission dismissed')
        }
      }
    })

    if (testBtn) {
      // Show test button only when enabled
      testBtn.style.display = (_isEnabled() && Notification?.permission === 'granted') ? '' : 'none'
      testBtn.addEventListener('click', testNotification)
    }
  }

  // Wire immediately (settings modal exists at this point)
  _wireSettingsModal()

  // Best-effort: if the user previously enabled push, silently re-subscribe on
  // load so we don't miss notifications after a token refresh or browser restart.
  if (supported && _isEnabled() && Notification.permission === 'granted') {
    _enableWebPush().catch(() => {})
  }

  // ── Destroy ────────────────────────────────────────────────────────────────
  function destroy() {
    window.removeEventListener('pilot:permission:pending', _onPermissionPending)
  }

  return { requestPermission, notify, destroy }
}
