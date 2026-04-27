/**
 * Unit tests for pickBestUrlForMobile — the only extractable pure logic
 * in connect-modal.js (the rest is DOM mutation).
 *
 * Import via dynamic import so the module-level DOM references (document,
 * window) are not evaluated during this test run — only the exported
 * function is exercised.
 */

// We test the pure function by importing it directly from the JS module.
// Bun supports mixed TS/JS imports natively.
import { pickBestUrlForMobile } from './connect-url-picker.js'

const TUNNEL_URL = 'https://tunnel.example.com/?token=abc'
const LAN_URL = 'http://192.168.1.10:4097/?token=abc'

const makeLan = (overrides: object = {}) => ({
  available: true,
  exposed: true,
  url: LAN_URL,
  ip: '192.168.1.10',
  ...overrides,
})

const makeTunnel = (overrides: object = {}) => ({
  available: true,
  url: TUNNEL_URL,
  provider: 'cloudflared',
  status: 'connected',
  ...overrides,
})

const noTunnel = { available: false, provider: null, status: 'off', howTo: '' }

describe('pickBestUrlForMobile', () => {
  it('returns null when info is null', () => {
    expect(pickBestUrlForMobile(null)).toBeNull()
  })

  it('returns null when info is undefined', () => {
    expect(pickBestUrlForMobile(undefined)).toBeNull()
  })

  it('returns LAN URL when only LAN is available', () => {
    const info = { lan: makeLan(), tunnel: noTunnel }
    expect(pickBestUrlForMobile(info)).toBe(LAN_URL)
  })

  it('returns tunnel URL when tunnel is active (tunnel takes priority over LAN)', () => {
    const info = { lan: makeLan(), tunnel: makeTunnel() }
    expect(pickBestUrlForMobile(info)).toBe(TUNNEL_URL)
  })

  it('returns tunnel URL even when LAN is unavailable', () => {
    const info = { lan: makeLan({ available: false, url: null }), tunnel: makeTunnel() }
    expect(pickBestUrlForMobile(info)).toBe(TUNNEL_URL)
  })

  it('returns null when LAN unavailable and no tunnel', () => {
    const info = { lan: makeLan({ available: false, url: null }), tunnel: noTunnel }
    expect(pickBestUrlForMobile(info)).toBeNull()
  })

  it('returns LAN URL when LAN available but not exposed (URL still present)', () => {
    // Not-exposed means the server is on localhost, but the URL field is still set
    // (backend returns the would-be URL). The picker returns it; the render layer
    // decides whether to show it as disabled.
    const info = { lan: makeLan({ exposed: false }), tunnel: noTunnel }
    expect(pickBestUrlForMobile(info)).toBe(LAN_URL)
  })

  it('does NOT return a localhost URL — never', () => {
    const localhostUrl = 'http://127.0.0.1:4097/?token=abc'
    // Even if somehow the LAN url were localhost, tunnel should be returned instead
    const info = {
      lan: makeLan({ url: localhostUrl }),
      tunnel: makeTunnel(),
    }
    expect(pickBestUrlForMobile(info)).toBe(TUNNEL_URL)
    expect(pickBestUrlForMobile(info)).not.toBe(localhostUrl)
  })

  it('returns null when tunnel has available=true but no url', () => {
    const brokenTunnel = { available: true, url: null, provider: 'cloudflared', status: 'connecting' }
    const info = { lan: makeLan({ available: false, url: null }), tunnel: brokenTunnel }
    expect(pickBestUrlForMobile(info)).toBeNull()
  })
})
