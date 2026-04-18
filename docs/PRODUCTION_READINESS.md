# Production Readiness Assessment — opencode-pilot v1.5.0

**Date:** 2026-04-17
**Scope:** Honest evaluation of whether opencode-pilot is ready for production, public deployment, or SaaS-style multi-tenant hosting, with prioritized recommendations.

---

## 1. Current State

opencode-pilot is an **in-process plugin** loaded by the OpenCode CLI. It runs inside the user's terminal, on the user's machine, bound to `127.0.0.1:4097` by default. No central server. No user database. No signup.

### Deployment modes supported today

| Mode | Binding | Auth | Comments |
|------|---------|------|----------|
| **Local only** (default) | 127.0.0.1 | Bearer token | Single user, single browser tab. Token persisted in `.opencode/pilot-state.json`. |
| **LAN** | 0.0.0.0 | Bearer token | Trusted network only. |
| **Tunnel** | 0.0.0.0 + cloudflared/ngrok | Bearer token | Exposes to public internet. |
| **PWA** | Any of the above | Bearer token + pairing | Dashboard can be installed as a PWA and pre-paired with a token hash. |

### Strengths

- **103 passing tests** across `auth`, `config`, `validation`, `circuit-breaker`, `audit`, `permissions`, `push`, HTTP integration.
- **Input validation is solid.** Path traversal rejected, JSON parsing guarded, schemas hand-written and strict.
- **Audit log on every remote operation** with append-only file + 5 MB rotation.
- **Stack traces never leak to clients** — internal errors go to `logger`, clients get generic `{ error: CODE }` shapes.
- **Very lean dependency surface:** 3 runtime deps (`@opencode-ai/plugin`, `qrcode-terminal`, `web-push`) + 2 dev types.
- **Clean architecture:** factory functions with `create*` prefix, dependency injection via `deps` object, no classes, no hidden globals.
- **Circuit breaker** wraps every external call (Telegram, web-push).
- **Graceful shutdown** with `uncaughtException` / `unhandledRejection` → audit log → file log → exit.

### Critical gaps

- **NO rate limiting.** An attacker on a tunnel can brute-force the Bearer token at network speed. This is the single biggest blocker for public exposure.
- **Auth token in plaintext state file.** Anyone with read access to `.opencode/pilot-state.json` has full control. Fine on a personal machine, **risky on shared servers**.
- **Token rotates on every restart.** Any user-facing URL (QR code, bookmark, PWA) dies when OpenCode restarts. Annoying for the user and prevents stable external links.
- **CORS is `*`.** Works, but is wider than needed. Should be allowlisted to the configured host/origin or `null`.
- **No load tests.** We don't know how the SSE bus behaves under 50 / 100 / 500 concurrent clients.
- **Push subscriptions in-memory.** Survive a tab reload (browser persists them) but the backend forgets all subscriptions on restart, so users have to re-enable push. Acceptable for MVP, not for production.

---

## 2. Verdict by Deployment Mode

### a) Single-user, LAN-only — ✅ READY

The primary use case. Code is well-engineered for this scope.

**Ship caveats:**
- Document the state-file permission caveat (`chmod 600` on shared servers).
- Known-issue: dev stderr pollution in the TUI when `/remote` opened a browser (fixed in the v1.5 patch that included this doc).

### b) Single-user, tunnel to internet — ❌ NOT READY

The auth model (single static Bearer) + no rate limit = brute-forceable in hours on a 1 Gbps tunnel.

**Before shipping:**
1. Rate limit per IP: 100 req/min sliding window, 10 failed auths/min lockout, exponential backoff.
2. Token refresh strategy: dual-token with grace period so restarts don't kill external URLs.
3. Make the token entropy explicit (`crypto.randomBytes(32)` already used, but add `--refresh-on-start=false` option).

### c) Multi-user, same machine (shared dev server) — ❌ NOT READY

One token = identical access for everyone. No per-user context. No isolation. No way to scope a session to a user.

**Architectural gap.** Making this work means adding a user/session identity layer — not a small change.

### d) Public SaaS / "anyone can use without installing" — ❌ NOT COMPATIBLE WITH CURRENT ARCHITECTURE

OpenCode runs as an in-process CLI on the user's machine. For a hosted SaaS you would need:
- OpenCode running in the cloud (big ops lift, per-tenant containers, cost model)
- OR a completely different architecture where the cloud is only a RELAY (see option e).

Do not attempt (a) as a v1.x move — too far from current scope.

### e) Cloud relay (pairing model) — ⏳ FEASIBLE, NEEDS SEPARATE SERVICE

Architecture:

```
┌────────────────────┐                   ┌────────────────────┐
│  User's machine    │                   │  Phone / laptop    │
│                    │                   │                    │
│  OpenCode CLI      │                   │  Dashboard (PWA)   │
│  + pilot plugin    │                   │                    │
│  + relay client    │◄──── outbound ────┤                    │
└──────────┬─────────┘                   └──────────▲─────────┘
           │                                        │
           │                                        │
           └─────────► relay.opencode-pilot.app ◄───┘
                         (WebSocket broker,
                          pairing codes,
                          E2E opaque traffic)
```

- Plugin connects **outbound** to the relay over WebSocket (no port forwarding, works behind NAT).
- User pairs a device by scanning a QR that contains a pairing code.
- Relay is **dumb**: it only routes frames between paired endpoints. Traffic is E2E encrypted with a shared secret derived from the pairing code (TLS to the relay + an inner seal).
- No OpenCode state in the cloud. Relay is a relay, not a server.

**Risks:**
- Trust in relay operator (DOS, subpoena, operator-level traffic analysis even with E2E).
- Complexity of key management and rotation.
- Cost of operating the relay at scale (WebSocket fanout can be cheap-ish — Cloudflare Workers, Fly.io, or a tiny VPS is enough for thousands of concurrent pairs).

**Effort:** This is a separate project (`opencode-pilot-relay`), probably 2–4 weeks of work including a decent web UI for the pairing flow. **Out of scope for v1.5.**

---

## 3. Prioritized Recommendations

### MUST — before any public exposure

| # | Recommendation | Effort | Files |
|---|---|---|---|
| 1 | **Rate limiting per IP** — sliding window, 100 req/min, lockout on repeated 401s | M | New `util/rate-limit.ts`, `http/server.ts` |
| 2 | **Token refresh strategy** — dual-token with grace period, survives restart | M | `util/auth.ts`, `services/state.ts`, `http/handlers.ts::rotateToken` |
| 3 | **CORS allowlist** — match origin to configured host instead of `*` | S | `http/cors.ts` |
| 4 | **Hide stack traces from logger when NODE_ENV=production** (they already don't leak to clients, but stdout log currently shows them) | S | `util/logger.ts` |

### SHOULD — before calling it production-grade

| # | Recommendation | Effort | Files |
|---|---|---|---|
| 5 | **Persist push subscriptions to disk** — JSON file alongside audit log | S | `services/push.ts`, `index.ts` |
| 6 | **Load tests for SSE bus** — benchmark 100 concurrent subscribers, ensure no memory leak | M | New `test/load/sse.test.ts` |
| 7 | **State file permission hardening** — `chmod 600` on write | S | `services/state.ts` |
| 8 | **Metrics endpoint** — Prometheus-compatible `/metrics` with auth-required | M | New `http/metrics.ts` |
| 9 | **Dashboard bundle hash in cache name** — currently bumped manually (`pilot-v9`); automate via build hash | S | `dashboard/sw.js`, future build step |

### NICE — polish and DX

| # | Recommendation | Effort | Files |
|---|---|---|---|
| 10 | **Token in URL fragment instead of query** — prevents leaks to logs/referrers | S | Frontend connect flow + `http/auth.ts` |
| 11 | **Dark-mode toggle persisted server-side** — currently localStorage only | S | `dashboard/state.js`, `settings.js` |
| 12 | **Session search/filter by content** — local index of fetched messages | M | `dashboard/sessions.js` |

---

## 4. Top 5 Features I'd Ship Next (Functional, Not Demo)

All five work with the **real OpenCode SDK** — no mocked data.

### 1. Cost-tracking dashboard

Pull `messages.billing` (cost per assistant message, cumulative) and render a per-session + per-model + per-day view. We already display current cumulative cost — extend with history and a sparkline.

- **Why:** Token cost is the single biggest operational concern. Today users have no way to see "how much did I spend on this project this week?".
- **Effort:** M. Backend aggregation endpoint + frontend chart (vanilla SVG sparkline, no Chart.js needed).
- **Files:** New `http/handlers.ts::getCostSummary`, new `dashboard/cost-panel.js`, CSS.

### 2. Shareable read-only session links

Generate a pre-signed URL with a read-only scope + expiration: `?share=<JWT>` or `?share=<opaque>`. Recipient sees the session messages but cannot send prompts or approve permissions. Audit every share creation.

- **Why:** Lets users show a teammate "look at this bug I'm chasing" without giving full access.
- **Effort:** M. Signed token helper + new auth layer (read-only context) + frontend UI for creating + revoking shares.
- **Files:** `util/share-token.ts`, `http/auth.ts` (extend to read-only scope), `dashboard/command-palette.js` (new action).

### 3. Offline prompt queue + replay

When the browser is offline (common on mobile), queue prompts locally in IndexedDB. When the SSE reconnects, drain the queue in order.

- **Why:** Real mobile use is lossy. Currently a prompt sent while offline silently fails.
- **Effort:** M. Service worker + IndexedDB wrapper + retry logic in `api.js::sendPrompt`.
- **Files:** `dashboard/sw.js`, new `dashboard/offline-queue.js`, `dashboard/api.js`.

### 4. WebAuthn / passkey auth for the dashboard

Replace the Bearer token for the browser with a passkey. User pairs once with a QR (transports the challenge), then unlocks with Touch ID / Face ID / Windows Hello.

- **Why:** Materially better than a static token. Survives URL leaks. Supported on every modern device.
- **Effort:** M–L. WebAuthn registration + assertion flow, server-side credential store (file-backed). Keep the Bearer path for programmatic/curl access.
- **Files:** New `services/webauthn.ts`, `http/handlers.ts::{registerPasskey,assertPasskey}`, `dashboard/auth.js` extend.

### 5. Cross-session pinned TODOs

OpenCode already tracks TODOs per session. Add a global "pinned" list that survives across sessions. User can move a TODO from one session to another, or create a TODO that auto-attaches to a new session on prompt.

- **Why:** Long-running projects span many sessions. Today TODOs are siloed.
- **Effort:** M. Small persistence layer (JSON file) + endpoints + frontend.
- **Files:** New `services/todos.ts`, new handlers + routes, new `dashboard/todos-global.js`.

---

## 5. Honest Take

opencode-pilot is **well-engineered for the scope it currently targets**: a LAN-only, single-user remote control plugin. The code is clean, tested, and thoughtful.

- **Ship v1.5 as-is for LAN** — it's ready.
- **Do NOT ship tunnel mode without the MUST-list above (items 1–4)** — specifically rate limiting.
- **Do NOT attempt a hosted SaaS with this architecture** — it's the wrong shape. If you want a public "anyone can use without installing" experience, build `opencode-pilot-relay` as a separate service that handles only pairing + E2E-opaque traffic. Plugin stays in-process, relay stays dumb.

The plugin is honest about its limitations, and that's a strength — easier to trust a tool that says "LAN only by default" than one that claims to be production SaaS while leaking stack traces.

---

## Appendix — File references

- Auth: `src/server/util/auth.ts`, `src/server/http/auth.ts`
- Config: `src/server/config.ts`, `.env.example`
- Audit: `src/server/services/audit.ts`, `src/server/services/audit-rotation.ts`
- Handlers: `src/server/http/handlers.ts`
- Routes: `src/server/http/routes.ts`
- CORS: `src/server/http/cors.ts`
- Circuit breaker: `src/server/util/circuit-breaker.ts`
- Telegram: `src/server/services/telegram.ts`
- Web push: `src/server/services/push.ts`
- Entry: `src/server/index.ts`
