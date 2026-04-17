// push-notifications.js — Browser push notifications for pending permissions
// Factory: createPushNotifications({ state }) → { requestPermission, notify, destroy }
//
// Design notes:
// - Never auto-prompts. Only calls Notification.requestPermission() when the user
//   explicitly enables notifications via the settings checkbox.
// - Sends a system notification when a pilot.permission.pending SSE event fires
//   AND the tab is hidden (document.hidden).
// - Graceful degradation: hides the settings row if Notification API is unavailable.

const LS_NOTIF_KEY = 'pilot_push_notif_enabled'

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
        return
      }

      // User opted in — request permission
      const result = await requestPermission()
      if (result === 'granted') {
        _setEnabled(true)
        if (testBtn) testBtn.style.display = ''
        _syncCheckbox()
      } else {
        // Denied or dismissed
        e.target.checked = false
        _setEnabled(false)
        if (result === 'denied') {
          e.target.disabled = true
          e.target.title = 'Notifications blocked by browser. Allow in site settings.'
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

  // ── Destroy ────────────────────────────────────────────────────────────────
  function destroy() {
    window.removeEventListener('pilot:permission:pending', _onPermissionPending)
  }

  return { requestPermission, notify, destroy }
}
