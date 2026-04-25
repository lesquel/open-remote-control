// notif-sound.js — Web Audio API notification beep (no audio file dependency)
// Two-tone: 800Hz then 1000Hz, 80ms each, 0.15 volume — soft notification beep.

let _ctx = null

function getAudioContext() {
  if (_ctx && _ctx.state !== 'closed') return _ctx
  try {
    _ctx = new (window.AudioContext || window.webkitAudioContext)()
    return _ctx
  } catch (_) {
    return null
  }
}

function playTone(ctx, freq, startTime, duration, volume) {
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(volume, startTime)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.start(startTime)
  osc.stop(startTime + duration)
}

/**
 * Play a soft two-tone notification beep via Web Audio API.
 * 800Hz → 1000Hz, 80ms each, 0.15 volume.
 * Safe to call any time — fails silently if AudioContext is unavailable.
 */
export function playNotifySound() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    // Browsers may suspend AudioContext until user gesture; resume if needed.
    const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
    resume.then(() => {
      const now = ctx.currentTime
      playTone(ctx, 800,  now,        0.08, 0.15)
      playTone(ctx, 1000, now + 0.09, 0.08, 0.15)
    }).catch(() => {})
  } catch (_) {}
}
