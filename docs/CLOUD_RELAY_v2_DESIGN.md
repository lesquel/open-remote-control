# Cloud Relay v2.0 — Design Document

> Status: **proposal / pre-commitment**
> Audience: lesquel (solo dev, deciding whether to invest 4–8 weeks)
> Scope: architecture only — no code
> Date: 2026-04-19

---

## 1. Executive Summary

**Qué es v2.0.** Un servicio centralizado (working name: `pilot-relay`, host tentativo `pilot.lesquel.com`) que hace de puente entre el teléfono del usuario y su plugin `opencode-pilot` corriendo en la máquina local. En vez de que el teléfono se conecte directo al `Bun.serve` del plugin (requiriendo LAN compartida o `cloudflared`), el plugin abre una conexión **saliente** al relay; el teléfono también se conecta al relay; y el relay enruta mensajes entre los dos.

**Por qué existe.** Lo self-hosted (v1.x) resuelve bien al dev técnico: `PILOT_TUNNEL=cloudflared` y listo. Pero hay tres fricciones reales que no se van a resolver sin un relay:

1. **Onboarding no-técnico.** Un PM, un diseñador o un cofounder no va a instalar `cloudflared`, abrir puertos, ni entender qué es un token Bearer.
2. **NAT hostil / redes corporativas.** Algunas redes bloquean outbound salvo 443. El tunnel ya resuelve esto, pero requiere setup por usuario.
3. **Multi-device UX.** Hoy cada teléfono necesita su propia URL del túnel. Con relay, el pairing es una vez y el dispositivo aparece listado.

**Tradeoffs honestos.**

- Ganás: UX de consumidor, onboarding de 60 segundos, zero-config en la máquina del usuario salvo `PILOT_RELAY_TOKEN`, deep-links desde notificaciones push.
- Perdés: autonomía total (ahora dependés de que tu server esté up), costo operativo mensual, responsabilidad sobre datos de usuarios, superficie de ataque **tuya** (no del usuario), un producto que hay que mantener indefinidamente.

**Naming.** Recomiendo **`opencode-pilot-cloud`** como producto y **`pilot-relay`** como componente server. El plugin existente sigue siendo `opencode-pilot` y gana un modo `cloud` opcional. No es un v2 — es un **producto hermano**, porque el modelo de negocio, el soporte y el stack operativo son completamente distintos.

**Verdict TL;DR.** **6/10 para construir ahora.** Buena idea técnica, mercado dudoso, demasiado temprano dado que v1.6.4 todavía tiene pulido pendiente (ver PRODUCTION_READINESS.md). Ver §12.

---

## 2. Architecture Overview

### 2.1 Diagrama

```
 ┌──────────────────┐                          ┌──────────────────────────┐
 │  Phone (PWA)     │                          │  User's local machine    │
 │  - WebAuthn      │                          │  - OpenCode TUI          │
 │  - Service Worker│                          │  - opencode-pilot plugin │
 │  - IndexedDB     │                          │    (cloud mode)          │
 └────────┬─────────┘                          └────────────┬─────────────┘
          │                                                  │
          │ WSS (443)                                        │ WSS (443)
          │ Bearer phone-token                               │ Bearer plugin-token
          │                                                  │
          ▼                                                  ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   Cloudflare (CDN + DDoS + WAF)                         │
 │                   pilot.lesquel.com — TLS termination                   │
 └──────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                     pilot-relay (Bun app, Fly.io)                       │
 │                                                                         │
 │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
 │   │  WS Gateway  │  │  REST API    │  │  Static PWA  │  │ Pairing    │ │
 │   │  /ws/phone   │  │  /api/v1/*   │  │  /dashboard  │  │ /pair/*    │ │
 │   │  /ws/plugin  │  │              │  │  (CDN)       │  │            │ │
 │   └──────┬───────┘  └──────┬───────┘  └──────────────┘  └──────┬─────┘ │
 │          │                 │                                    │       │
 │          └────────┬────────┴────────────────────────────────────┘       │
 │                   │                                                     │
 │          ┌────────▼─────────┐       ┌──────────────────────┐            │
 │          │  Session Router  │──────▶│  Redis (presence,    │            │
 │          │  (in-memory +    │       │   rate limit, ephem. │            │
 │          │   Redis pub/sub) │       │   routing)           │            │
 │          └────────┬─────────┘       └──────────────────────┘            │
 │                   │                                                     │
 │          ┌────────▼─────────┐       ┌──────────────────────┐            │
 │          │  Audit/Persist   │──────▶│  Postgres            │            │
 │          │                  │       │  (users, pairings,   │            │
 │          │                  │       │   audit, billing)    │            │
 │          └──────────────────┘       └──────────────────────┘            │
 └────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Componentes

| Componente | Rol |
|---|---|
| **Phone PWA** | Dashboard (hoy mismo HTML estático) + capa de auth con WebAuthn + Service Worker para push. Servido desde CDN, conecta WSS al relay. |
| **Plugin (cloud mode)** | `opencode-pilot` con `PILOT_MODE=cloud`. Ya no corre `Bun.serve` público; sólo abre un WebSocket saliente al relay. Mantiene toda su lógica de hooks, permission queue, audit log local. |
| **Cloudflare front** | TLS, DDoS protection, WAF, rate limiting L7, cache de assets estáticos del PWA. |
| **WS Gateway** | Dos endpoints: `/ws/plugin` (para instancias de plugin) y `/ws/phone` (para teléfonos pareados). Valida tokens, inscribe la conexión en el Session Router. |
| **Session Router** | Mantiene el mapeo `pairing_id → {pluginSocket, [phoneSockets...]}`. En memoria local + pub/sub Redis para escalar a N nodos. |
| **REST API** | Endpoints de alta (signup, pairing, billing, token rotation). Lo que NO requiere WebSocket. |
| **Pairing service** | Flujo de pareo: genera códigos de un solo uso, valida WebAuthn, emite tokens. |
| **Postgres** | Datos duraderos. |
| **Redis** | Presence (¿está el plugin X online?), rate limiting por token, estado efímero de enrutado en multi-nodo. |

### 2.3 Flujo: "mandá este prompt desde el teléfono"

```
Phone                  Relay                    Plugin                  OpenCode
  │                      │                         │                       │
  │ 1. WSS send:         │                         │                       │
  │   {type:"cmd",       │                         │                       │
  │    op:"prompt",      │                         │                       │
  │    pairing:"p_7x…",  │                         │                       │
  │    sessionId:"…",    │                         │                       │
  │    text:"…",         │                         │                       │
  │    nonce:"…"}        │                         │                       │
  ├─────────────────────▶│                         │                       │
  │                      │ 2. validate token,      │                       │
  │                      │    lookup pairing,      │                       │
  │                      │    check rate limit,    │                       │
  │                      │    audit-log(pending)   │                       │
  │                      │                         │                       │
  │                      │ 3. forward              │                       │
  │                      ├────────────────────────▶│                       │
  │                      │                         │ 4. local validate,    │
  │                      │                         │    call SDK           │
  │                      │                         ├──────────────────────▶│
  │                      │                         │                       │
  │                      │                         │◀──────────────────────┤
  │                      │                         │ 5. stream SDK events  │
  │                      │ 6. fan out events       │                       │
  │                      │◀────────────────────────┤                       │
  │ 7. {type:"event", …} │                         │                       │
  │◀─────────────────────┤                         │                       │
  │                      │                         │                       │
  │ 8. final result      │                         │                       │
  │◀─────────────────────┤◀────────────────────────┤                       │
```

Punto clave: el **relay no interpreta el payload del comando**, sólo valida estructura (JSON schema), pairing y rate limit. La semántica (¿es válido este prompt? ¿está permitido este tool?) vive en el plugin, igual que hoy.

---

## 3. Pairing Protocol

El pairing es el paso que más UX puede romper. Simple, auditable y resistente a phishing.

### 3.1 Flujo inicial (primera vez)

```
Usuario corre localmente:              Usuario en teléfono:
┌─────────────────────────────┐        ┌─────────────────────────────┐
│ $ opencode-pilot pair        │        │ Open pilot.lesquel.com      │
│                              │        │                              │
│ → Generates plugin keypair   │        │ → Create account (WebAuthn) │
│ → POST /api/v1/pair/init     │        │ → Click "Pair a plugin"     │
│   with public key            │        │ → Enter 6-digit code        │
│                              │        │   (shown in CLI)            │
│ ← Returns:                   │        │                              │
│   pairing_code: "ABC-123-Z"  │        │ → POST /api/v1/pair/confirm │
│   expires_in: 600s           │        │   {code, attestation}        │
│                              │        │                              │
│ Shows code on terminal       │        │ ← Returns pairing_id         │
│ + QR (encodes deep link)     │        │                              │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │                                       │
               └─────────────┬─────────────────────────┘
                             ▼
                 ┌───────────────────────┐
                 │ Relay matches code,   │
                 │ binds plugin_pk ↔     │
                 │ phone_credential      │
                 │                       │
                 │ Emits to both:        │
                 │  - plugin_token       │
                 │  - phone_token        │
                 └───────────────────────┘
```

**Two-factor por diseño:**

1. **Posesión del plugin** — sólo quien corre el CLI local ve el código de pareo.
2. **Posesión del teléfono + biometría** — WebAuthn/passkey: el teléfono presenta una assertion con FaceID/huella.

Un atacante necesita ambos simultáneamente dentro de los 10 min de la ventana.

### 3.2 Tokens y rotación

- **plugin_token**: 256-bit random, guardado en `~/.opencode-pilot/cloud-token` (permisos 0600). **No rota automático** — la máquina del dev se asume confiable. Rota manual con `opencode-pilot pair rotate`.
- **phone_token**: 256-bit random, guardado en IndexedDB del PWA encriptado con WebAuthn-wrapped key. **Rota cada 30 días** en background; si la rotación falla por estar offline, el token sigue válido 7 días extra (grace period).
- **short-lived JWT de sesión**: cada WSS connect, el relay emite un JWT de 1h firmado con su key privada. Todos los mensajes de la sesión llevan este JWT en el handshake, no en cada frame.

**Por qué rotación diferenciada:** el teléfono se puede perder; el laptop del dev se asume igual de confiable que su shell. Rotación agresiva en el lado más perdible.

### 3.3 Revocación

Tres niveles:

1. **Self-service desde el PWA**: `Settings → Devices → Revoke`. Elimina el pairing de Postgres, hace pub a `revoke:<pairing_id>` en Redis, WS gateway cierra la conexión en el siguiente frame.
2. **Self-service desde CLI local**: `opencode-pilot pair list` / `pair revoke <id>`. Útil si perdiste acceso al PWA.
3. **Relay admin** (vos): panel interno para banear tokens/usuarios ante incidentes.

Tiempo de revocación observado: **<2 segundos** en happy path (Redis pub/sub). Hard limit: 60 segundos (TTL del JWT corto).

---

## 4. Transport Layer

### 4.1 Decisión: **WebSocket (WSS) para todo el tráfico bidireccional**

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| **WebSocket** | Full-duplex, low latency, framing nativo, una sola conexión por dirección | Stateful (más carga en el server), sticky sessions en multi-nodo | **Elegido** |
| SSE + POST | Ya lo usás en v1, simple, funciona tras proxies tontos | Unidireccional — necesitás un canal separado POST para comandos, más latencia, más overhead de conexión | Descartado |
| HTTP long-poll | Funciona en todos lados | Latencia alta, polling constante, peor para batería del teléfono | Descartado |
| gRPC-web | Tipado, eficiente | Complicado en browsers, tooling pesado, overkill para este volumen | Descartado |

**Argumento principal:** el caso de uso real es el **teléfono pidiendo permiso al plugin y esperando respuesta humana**. Eso es bidireccional, interactivo, y SSE te fuerza a un pipe extra.

### 4.2 Formato de frame

JSON sobre WebSocket text frames (binario no suma aquí):

```
{
  "v": 1,
  "type": "cmd" | "event" | "ack" | "error" | "ping",
  "id": "<uuid>",
  "pairing_id": "<short>",
  "ts": <unix ms>,
  "payload": { ... }
}
```

Todas las operaciones llevan `id` para correlación request/response. `type:"ack"` confirma recepción (no ejecución). MsgPack evaluable a futuro si el volumen lo justifica; empezar con JSON.

### 4.3 Reconnection

- Cliente (plugin y phone) hace **exponential backoff**: 1s, 2s, 4s, 8s, 16s, 30s, 60s cap.
- Jitter ±20% para evitar thundering herd tras una caída del relay.
- Al reconectar, el cliente manda `{type:"resume", last_event_id}` y el relay reenvía eventos perdidos de los últimos 60 segundos (buffer Redis por pairing).
- Si el gap excede 60s, el cliente pide full state vía REST (`GET /api/v1/pairings/:id/state`).

### 4.4 Presence detection

- **Server → Client**: ping WS cada 25s (igual que el keepalive actual de SSE), timeout 60s.
- **Client → Server**: si 3 pings fallan, cierra y reconecta.
- **Redis key** `presence:plugin:<id>` con TTL 30s, refrescado en cada ping. Permite a los teléfonos pareados saber si el plugin está online antes de mandar comandos.

### 4.5 Multiplexing

Un plugin puede tener **N teléfonos conectados simultáneos** (ej. el dev + su PM). El Session Router mantiene:

```
pairing_id: "p_7x..."
├── plugin: ws_plugin_socket (exactly one)
└── phones: [ws_phone_A, ws_phone_B, ...]
```

Eventos del plugin → fan-out a todos los phones. Comandos de phone A → ruteados al plugin; respuesta vuelve SÓLO a phone A (por el `id` del frame). Los eventos lifecycle (`tool.started`, etc.) van a todos.

---

## 5. Security Model

### 5.1 Threat model

| Actor | Capacidad asumida | Defensa principal |
|---|---|---|
| **Script kiddie** | Escanea puertos, prueba creds débiles | WAF Cloudflare + rate limit + tokens 256-bit |
| **Atacante targeted** | Conoce al usuario, intenta phishing de pairing | Two-factor (código local + WebAuthn) |
| **Teléfono robado con pantalla desbloqueada** | Acceso físico momentáneo | Re-auth WebAuthn cada 15 min de inactividad, revocación remota |
| **Relay operator malicioso (vos)** | Acceso total al server | E2E opcional, audit log firmado, subpoena transparency |
| **Atacante que rompe el relay** | Acceso a Postgres + Redis + WS | Sin E2E: lee comandos. Con E2E: ve metadata pero no payloads |
| **Man-in-the-middle en red** | Sniffa tráfico | TLS 1.3 only, HSTS preload, cert pinning opcional en el plugin |

### 5.2 E2E encryption — **la decisión más dolorosa**

**Opción A (recomendada para MVP): TLS al relay, plaintext adentro.**

- **Pros:** más simple, permitís dashboard web con features ricas (search de sesiones, replay, notificaciones push con preview del contenido), debugging tratable, feature-velocity alta.
- **Contras:** el relay ve todo. Vos tenés que mantener postura de seguridad "como si" tuvieras responsabilidad legal sobre esos datos. Un breach del relay expone prompts.
- **Mitigación:** no persistas payloads por defecto (sólo metadata); opción opt-in de "quiet logging" para usuarios paranoicos; SOC-2 lite si llegás a ese tamaño.

**Opción B: E2E entre plugin y teléfono (Signal-style double ratchet sobre WebSocket).**

- **Pros:** si el relay es comprometido, el atacante ve timestamps y tamaños, nada más. Argumento de venta fuerte para clientes enterprise.
- **Contras:** perdés la capacidad de hacer un web dashboard con features server-side (búsqueda full-text, replays, notif-previews). Gestión de claves complicada: si el usuario pierde teléfono, ¿cómo recupera historial? No podés. Debuggeo pesadillesco.

**Recomendación:** **A para MVP**, con un flag `PILOT_E2E=true` como opción en Phase 3 para usuarios que lo pidan. Documentá honesto en la privacy policy: "el relay puede ver el contenido de tus comandos; no los persistimos más allá de X segundos salvo audit metadata". Esto es aceptable para el 95% del mercado y te permite shipear.

### 5.3 Key management

- **Relay TLS**: Cloudflare maneja el cert público; internamente Fly.io rota certs automáticos.
- **JWT signing key**: par Ed25519 del relay, guardado en secret manager (Fly Secrets). Rotación manual cada 90 días, overlap de 24h.
- **Plugin pubkey**: generado en `opencode-pilot pair init`, guardado localmente. El relay guarda la pubkey por pairing. **Nunca** tocás private keys del plugin desde el server.
- **Phone key material (WebAuthn)**: vive en el Secure Enclave / TPM del teléfono. Nunca sale. El relay sólo ve assertions firmadas.

### 5.4 Rate limiting

Multi-tier, todo en Redis con `INCRBY + EXPIRE`:

| Capa | Límite por defecto | Bypass |
|---|---|---|
| Por IP | 60 req/min al REST API | — |
| Por plugin_token | 300 msgs/min en WSS | Tier paid ×5 |
| Por phone_token | 120 msgs/min en WSS | Tier paid ×3 |
| Por pairing | 1000 msgs/hora combinados | Tier paid ×10 |
| Global (relay) | N conexiones concurrentes (según capacity) | Circuit breaker |

Exceder devuelve `{type:"error", code:"rate_limited", retry_after: <s>}` y cierra el socket si persiste.

### 5.5 Audit log

- **Relay log** (Postgres): `timestamp, pairing_id, source (plugin/phone/admin), action, result, ip_hash, user_agent_hash`. **NO guarda payload** por defecto. Retention: 90 días, luego TTL delete.
- **Plugin local log** (archivo, ya existe en v1): audit completo, incluyendo payloads. Vive en la máquina del usuario, el relay no lo ve.
- **Phone log** (IndexedDB): ack de acciones que el usuario hizo desde ese dispositivo; útil para "¿qué hice ayer?".

Cualquier acción sensible (rotation, revocation, billing change) también va a un `security_events` aparte con retención de 1 año.

### 5.6 DDoS

- **Cloudflare Pro** (USD 25/mes) delante de todo — DDoS L3/L4 incluido.
- Rate limit por IP en Cloudflare (L7) antes de llegar al origen.
- Per-token rate limit (arriba).
- Circuit breaker en el relay: si la CPU supera 85% por 30s, rechaza nuevas conexiones con `503` y backoff alto.

---

## 6. Server Architecture

### 6.1 Stack recomendado

| Capa | Elección | Por qué |
|---|---|---|
| **Runtime** | **Bun** | Consistencia con el plugin, startup rápido, WebSocket nativo performante, Bun.serve handler ya lo conocés |
| **DB** | **Postgres 16** | Relacional lo justo (users, pairings, audits), JSONB para configs flexibles, maduro |
| **Cache / ephemeral** | **Redis 7** | Pub/sub para multi-nodo WS, rate limiting atómico, presence con TTL, resume buffer |
| **ORM** | **Drizzle** | Type-safe, SQL-first, bajo overhead, trabaja bien con Bun |
| **Auth (phone)** | **WebAuthn nativo** (SimpleWebAuthn) | Passkeys en iOS 16+ / Android 9+ / Chrome. Cero passwords. |
| **Observability** | **Sentry + Axiom (logs) + Uptime Kuma** | Errores + logs estructurados + uptime external |
| **Payments** (Phase 3+) | **Stripe** | Subscriptions, customer portal, webhooks |

**Alternativas descartadas:**
- Node.js: funciona, pero rompés consistencia con el plugin sin ganar nada.
- SQLite + Litestream: tentador para solo dev, pero WebSocket multi-nodo exige Redis; una vez que tenés Redis, Postgres es marginal.
- Cloudflare Workers: excelente para REST, **pésimo para WebSocket persistente** (Durable Objects ayuda pero complica el modelo). Queda fuera como opción principal pero útil para el REST API si querés híbrido.

### 6.2 Schema Postgres (outline)

```sql
-- users
id (uuid pk), email (unique), created_at, plan (enum: free|pro),
stripe_customer_id (nullable), email_verified_at

-- webauthn_credentials
id (uuid pk), user_id (fk), credential_id (bytea unique),
public_key (bytea), counter (int), device_name, created_at, last_used_at

-- pairings
id (uuid pk), user_id (fk), name (e.g. "work laptop"), plugin_pubkey (bytea),
plugin_token_hash (bytea), created_at, last_seen_at, status (active|revoked),
tier (free|pro)

-- phone_devices
id (uuid pk), user_id (fk), pairing_ids (uuid[]),
phone_token_hash (bytea), credential_id (fk webauthn),
push_subscription (jsonb nullable), created_at, last_seen_at

-- audit_entries  (retention 90 days — partitioned by month)
id (bigint pk), ts, pairing_id, source (enum), action (text),
result (enum), ip_hash, user_agent_hash, metadata (jsonb)

-- security_events  (retention 1 year)
id, ts, user_id, event_type (enum), details (jsonb), ip_hash

-- rate_limit_overrides  (manual bumps, rare)
id, target_type (token|pairing|user), target_id, multiplier, expires_at

-- billing_events
id, user_id, stripe_event_id, type, amount_cents, ts, raw (jsonb)
```

Todo con índices en `user_id`, `pairing_id`, `ts DESC`. Particionado mensual en `audit_entries` para que el cleanup sea un `DROP PARTITION`.

### 6.3 Redis keyspace

```
presence:plugin:<pairing_id>      TTL 30s    heartbeat
presence:phone:<device_id>        TTL 30s
route:plugin:<pairing_id>         hash { node_id, socket_id }
route:phone:<device_id>           hash { node_id, socket_id }
resume:<pairing_id>               list (events últimos 60s, LTRIM)
rate:token:<hash>:<min_bucket>    counter, TTL 120s
rate:pairing:<id>:<hour_bucket>   counter, TTL 3700s
pubsub channel: relay.route       fan-out entre nodos WS
pubsub channel: relay.revoke      fan-out de revocaciones
```

### 6.4 Hosting — comparación honesta

Para un solo dev, workload WebSocket persistente, presupuesto apretado:

| Opción | Pros | Contras | Costo 100 usuarios | Veredicto |
|---|---|---|---|---|
| **Fly.io** | Apps con persistent processes, multi-region fácil, Postgres managed, pricing predecible, WS nativo | Región cold starts si scale-to-zero, soporte medio | ~USD 30/mes (1x shared-1x machine + pg-nano + upstash-redis-free) | **Elegido** |
| **Railway** | DX excelente, despliegue simple | Más caro a escala, vendor lock-in creciente | ~USD 50/mes | Viable, más caro |
| **DigitalOcean App Platform** | Barato, managed | DX flojo, WS con quirks en el LB | ~USD 25/mes | Alternativa low-cost |
| **Cloudflare Workers + Durable Objects** | Global edge, escala infinita, USD 5/mes base | Durable Objects para WS es OK pero limita debug, pricing por duration confuso | ~USD 15/mes + egress | Buena, pero complejidad inicial alta |
| **AWS EKS / ECS** | Todo lo que quieras | Solo dev **no debería** tocar esto | ~USD 150+/mes | Descartado |
| **VPS (Hetzner/DO droplet) + Docker** | Barato, control total | Vos mantenés todo: backups, parches, monitoring, certs | ~USD 10/mes | **Alternativa si te gusta ops** |

**Recomendación:** empezar en **Fly.io** con `fly postgres` + Upstash Redis free tier. Escalar horizontal cuando pase de 500 conexiones WS concurrentes.

### 6.5 Cost estimates (run-rate mensual)

Asume 1 dev, sin soporte pagado, Cloudflare Pro ($25), monitoring (Sentry free + Axiom starter $25).

| Usuarios activos | Fly compute | Postgres | Redis | CF+Obs | **Total** | Por usuario |
|---|---|---|---|---|---|---|
| 10 | $5 (shared-1x) | $0 (pg-nano free) | $0 (upstash free) | $50 | **$55** | $5.50 |
| 100 | $15 (2× shared-1x) | $15 (pg-micro) | $10 (upstash pay-as-go) | $50 | **$90** | $0.90 |
| 1,000 | $60 (2× shared-2x) | $30 (pg-basic) | $30 | $75 | **$195** | $0.20 |
| 10,000 | $300 (autoscale 4–8 nodes) | $150 (pg-performance) | $100 | $200 | **$750** | $0.075 |

**Insight:** el break-even per-user cae dramáticamente después de los primeros 100. La parte fija (observability, CF Pro) te mata abajo. Si no pasás de 50 usuarios en 6 meses, perdés plata.

---

## 7. Plugin Changes

### 7.1 Qué cambia

**Nuevas env vars:**

```bash
PILOT_MODE=cloud                       # default: "local" (v1 behavior)
PILOT_RELAY=https://pilot.lesquel.com  # URL del relay
PILOT_RELAY_TOKEN=<plugin_token>       # set por `opencode-pilot pair`
```

**Archivos nuevos:**

| Archivo | Rol |
|---|---|
| `src/server/services/relay-client.ts` | WebSocket client hacia el relay. Reconnection, resume, frame (de)ser. Reemplaza `Bun.serve` cuando `PILOT_MODE=cloud`. |
| `src/server/relay/routes.ts` | Dispatcher de mensajes del relay a los handlers existentes. |
| `src/cli/pair.ts` | CLI de pareo (ejecutable separado o subcomando del plugin). |
| `src/server/services/pairing-store.ts` | Lee/escribe `~/.opencode-pilot/cloud-token` con permisos 0600. |

**Nuevo comando CLI:**

```
$ opencode-pilot pair init
  → genera keypair
  → POST /api/v1/pair/init
  ← pairing_code "ABC-123-Z"
  → QR + texto en terminal
  → long-poll /api/v1/pair/wait hasta que el teléfono confirme
  → guarda token en ~/.opencode-pilot/cloud-token

$ opencode-pilot pair list
$ opencode-pilot pair revoke <pairing_id>
$ opencode-pilot pair rotate
```

### 7.2 Qué se reusa

Ironía feliz: **casi todo el core del plugin se reutiliza**. El relay no reemplaza la lógica, reemplaza el **transport**.

| Componente existente | Estado |
|---|---|
| `hooks/*` (event, permission.ask, tool) | **Sin cambios**. Siguen emitiendo a `eventBus`. |
| `services/event-bus.ts` | **Sin cambios**. El `relay-client` se suscribe como un consumer más. |
| `services/permission-queue.ts` | **Sin cambios**. El relay-client tradúce comandos del teléfono a resolves en la queue. |
| `services/audit.ts` | **Sin cambios**. Sigue logueando local. |
| `services/state.ts`, `banner.ts` | Banner cambia el mensaje (ver debajo). |
| `http/handlers.ts` | **Reusados** por el relay-client: mapean 1:1 a mensajes del relay. Se vuelven funciones puras que devuelven JSON, sin `Response`. |
| `http/auth.ts` | **Sin sentido** en cloud (el relay hace auth). El code se mantiene para `PILOT_MODE=local`. |

Esto es la parte buena. El trabajo real es el relay, no el plugin.

### 7.3 Qué se deprecia en cloud mode

- `services/tunnel.ts` — innecesario, no se ejecuta.
- `banner.ts` — deja de mostrar URL local + QR. Muestra "Paired with pilot.lesquel.com as 'work-laptop' · 2 phones online".
- `http/server.ts` (`Bun.serve`) — no arranca. El relay-client lo reemplaza.
- `PILOT_HOST` / `PILOT_PORT` — no aplican.
- Telegram bot — **conflicto de features** con notificaciones push nativas del PWA. Mantenerlo funcional para `PILOT_MODE=local`, opcional en cloud.

---

## 8. Phone Dashboard Changes

### 8.1 Situación actual

El dashboard vive en `src/server/dashboard/`, HTML/CSS/JS vanilla. Se sirve desde `Bun.serve` del plugin. Service Worker parcialmente implementado (web-push está en deps).

### 8.2 Decisión: **reutilizar el mismo codebase**

No reescribirlo a React. Razones:

1. Ya funciona, ya está testeado, la UX es lo suficientemente buena.
2. Un solo dev no necesita la complejidad de un build pipeline React para ganar nada funcional.
3. PWA con vanilla JS + Web Components si hace falta es perfectamente válido en 2026.

**Cambio necesario:** el dashboard hoy asume `fetch('/sessions')` contra el mismo origin. En cloud mode, el backend es el relay en otro dominio. Abstraer el transport detrás de un módulo `api.js`:

```
// api.js (conceptual)
const API_BASE = window.__PILOT_RELAY__ ?? location.origin
const WS_URL   = window.__PILOT_WS__    ?? `wss://${location.host}/ws/phone`
```

En local mode, `window.__PILOT_*` no están seteados y usa origin (comportamiento actual). En cloud mode, el HTML entry lo inyecta con los valores del relay.

### 8.3 Hosting del PWA

- **Relay sirve el HTML entry** (`/`) con los env vars inyectados.
- **Assets estáticos** (JS, CSS, iconos) detrás de Cloudflare CDN con cache agresivo (1 año con fingerprint en nombre de archivo).
- **Service Worker** sirve assets desde cache, network-first para `/api/v1/*`, ya está parcialmente construido.

### 8.4 Push notifications

`web-push` ya está en `package.json`. Migrar al relay:

- Relay genera VAPID keys (una vez).
- Phone hace `subscribe` al Service Worker, manda la subscription al relay (`POST /api/v1/devices/:id/push`).
- Cuando el plugin emite `pilot.permission.pending`, el relay hace fan-out por WS **y** por WebPush al teléfono offline.

Esto reemplaza el caso de uso principal del Telegram bot en cloud mode.

---

## 9. Privacy & Compliance

### 9.1 Qué ve el relay

Con E2E deshabilitado (MVP):

| Dato | Ve | No ve |
|---|---|---|
| Metadata de pairing (user, device name, created_at) | ✔ | |
| Timestamps de cada mensaje | ✔ | |
| Estructura del comando (`{op:"prompt", sessionId, text}`) | ✔ | |
| **Contenido del prompt del usuario** | ✔ (tránsito) | No persistido por default |
| Outputs de OpenCode (respuestas del modelo) | ✔ (tránsito) | No persistido por default |
| Código fuente local | | ✔ (sólo paths si los comandos lo incluyen) |
| Credenciales de providers (Anthropic key, etc.) | | ✔ — **nunca** salen de la máquina local |
| IPs del usuario | ✔ (hashed en audit) | IP en claro no se guarda |

### 9.2 Privacy policy — puntos obligatorios

1. Qué se procesa, por qué (ejecución de comandos remotos).
2. Qué se persiste (metadata, no contenido), retention (90d audit, 1y security events).
3. Derecho a delete (endpoint `DELETE /api/v1/account` que borra todo de Postgres + invalida tokens).
4. Subprocessors: Fly.io (hosting), Cloudflare (CDN), Upstash (Redis), Sentry (errors), Stripe (billing).
5. Dónde se alojan los datos (región Fly.io).

### 9.3 GDPR

Si aceptás usuarios EU, obligaciones:

- **DPA con subprocessors** (Fly, Cloudflare, Stripe lo proveen estándar).
- **Data export** endpoint (`GET /api/v1/account/export` → JSON con todo lo que el relay tiene de ese usuario).
- **Right to erasure** (arriba).
- **No transferir datos a jurisdicciones non-adecuate** sin SCC — elegí región UE en Fly.io si targetás EU.
- **Cookie banner**: si usás analytics (Posthog), sí. Si no usás cookies, no.

**Recomendación práctica:** limitá MVP a no-EU users inicialmente (ToS clause). Cuando valides mercado, contratás una revisión legal de 2h para aprobar GDPR compliance. Costo: ~USD 300-500.

### 9.4 Terms of Service

Copy-paste desde plantillas (Termly, Docular) y adaptar:

- **No warranty** — software provisto "as is".
- **Usuario responsable** de lo que su plugin ejecute. Si hace un `rm -rf` por un comando del teléfono, es problema suyo.
- **No liability** por pérdidas derivadas del uso del relay.
- **Acceptable use** — no ejecutar malware, no phishing, no crypto mining en máquinas ajenas, etc.
- **Account termination** — podés cerrar cuentas que violen ToS sin notice previo para casos de abuso.

---

## 10. Phased Rollout

### Phase 1 — MVP (4 semanas, full-time / 6-7 semanas, part-time)

**Scope:**
- Relay básico: WS gateway, Session Router single-node, Postgres + Redis.
- Pairing flow (plugin CLI + WebAuthn phone).
- REST API mínima (account, pairings, revoke).
- Plugin mode `cloud` con `relay-client.ts`.
- Dashboard servido por el relay con auth WSS.
- Deploy: Fly.io single region, pg-nano, upstash-free.
- Self-testing: vos como único usuario, 2 teléfonos, 1 laptop.

**Gate para Phase 2:**
- Zero-crash 48h de uso continuo.
- Latencia P95 phone→plugin→respuesta < 400ms.
- Reconnection funciona tras 10 desconexiones forzadas.

### Phase 2 — Closed Beta (2 semanas)

**Scope:**
- Invitar 5-10 amigos/colegas (idealmente mix: devs + no-devs).
- Sentry + Axiom integrados.
- Feedback form en el dashboard.
- Iterar UX del pairing (es el único punto de onboarding).
- Bug triage con issue tracker público (GitHub Projects).

**Gate para Phase 3:**
- ≥80% de los beta users completan pairing sin ayuda.
- ≤1 security issue crítico abierto.
- Churn esperado (gente que deja de usar tras la primera semana): medido.

### Phase 3 — Public Beta (2 semanas)

**Scope:**
- Rate limiting full (tiers free/pro).
- Stripe integrado (checkout + webhook + customer portal).
- Pricing visible en el landing.
- Status page (Uptime Kuma público).
- Privacy policy + ToS publicados.
- Launch soft: Reddit `/r/opencode` si existe, HN Show HN, Twitter del proyecto.

**Gate para estable:**
- ≥50 usuarios registrados, ≥10 pagos.
- SLA informal 99.5% mensual durante 4 semanas.

### Phase 4 — GA

- Versioning semver del API.
- Backup automatizado de Postgres (diario, retención 30d).
- Runbook de incidentes (qué hacer si el relay cae, cómo restaurar, cómo comunicar).
- Considerar multi-region si tenés usuarios en APAC/EU con latencia dolorosa.

**Tiempo total hasta GA: 8-12 semanas full-time.**

---

## 11. Pricing Model

### 11.1 Propuesta de tiers

| Tier | Precio | Incluye |
|---|---|---|
| **Free** | $0 | 1 pairing, 1 teléfono, 500 msgs/día, audit 7 días |
| **Pro** | **$8/mes** o $80/año | 5 pairings, ilimitados teléfonos, 50k msgs/día, audit 90 días, push notifications, prioridad de soporte |
| **Team** (Phase 4+) | $25/mes por seat | Pro + compartir pairings con el equipo, SSO básico, retention 1 año |

### 11.2 Justificación del precio Pro

Costo marginal por usuario a 1000 users: ~USD 0.20/mes. $8 deja margen amplio (~97% gross margin) y es comparable:

| Producto comparable | Precio |
|---|---|
| **Tailscale** (personal) | Free hasta 3 users, $5/user/mes Starter |
| **ngrok** (Personal) | $10/mes por 3 endpoints |
| **Cloudflare Tunnel** | Gratis (pero requiere setup técnico) |
| **Claude Code** nativo remote access (cuando lanzen) | Probable $20+/mes incluido en plan Pro |

$8 es el **price point psicológico** donde un dev lo aprueba sin pensar. Subir a $15 limita adopción. Bajar a $5 no cubre el overhead de soporte.

### 11.3 Free tier — propósito

No monetizar. El free tier existe para:
1. **Onboarding frictionless** — el usuario prueba antes de pagar.
2. **Demo para el PM/diseñador** — el dev invita al no-dev al free tier, luego upgrada cuando necesita más de 1 pairing.
3. **Hobbyistas** — no van a pagar nunca, pero son evangelistas potenciales.

Límite de 500 msgs/día evita abuso pero permite uso real bajo.

---

## 12. Honest Verdict — Should You Build This?

### 12.1 Build effort

- **Diseño cuidadoso (ya hecho)**: este documento.
- **MVP Phase 1**: 4 semanas full-time o 6-7 semanas part-time.
- **Hasta GA (Phase 4)**: 8-12 semanas full-time.
- **Mantenimiento post-GA**: 4-8 horas/semana (soporte, patches, iterar UX).

**Total real incluyendo GA: ~3 meses de atención concentrada.** Más bajo de lo que parece, más alto de lo que querés.

### 12.2 Ongoing operational cost

- **Servers**: $55-200/mes en los primeros 6 meses.
- **Tiempo mental**: el big one. Un servicio en producción con usuarios pagos es un trabajo part-time. Vas a recibir reports de bugs, pedidos de features, alguien va a quedarse afuera un viernes a las 11pm. Eso desgasta.
- **Riesgo legal**: bajo con ToS claras, no cero. Un incidente de seguridad te cuesta tiempo de respuesta pública.

### 12.3 Market — ¿quién paga realmente?

**Honestidad brutal:** el dev que ya usa `cloudflared` y `opencode-pilot` v1 **no va a pagar**. Le funciona gratis lo que tiene.

El **ICP (ideal customer profile)** del relay es:

1. **Dev solo que quiere acceso móvil y no quiere lidiar con tunnels** — válido, tal vez $8/mes sí, tal vez no.
2. **Dev con equipo no-técnico que necesita visibilidad/control de agents** — PM aprueba permisos, dev no tiene que estar en la compu. **Este es el caso fuerte.** Equipo paga $25/mes Team tier sin parpadear.
3. **Dev en red corporativa hostil** — outbound-only resuelve donde el tunnel no llega. Pequeño segmento pero real.

**El bottleneck de adopción NO es técnico, es awareness.** Hoy `opencode-pilot` v1 tiene ¿cuántos? 100-500 usuarios self-hosted. El TAM inmediato del relay es ese grupo × (% que quiere cloud) × (% que pagaría). Probablemente <50 customers pagos en 6 meses sin marketing dedicado.

### 12.4 Competition

- **Anthropic/Claude Code** — es **casi seguro** que van a meter cloud sync / remote access oficial en los próximos 12 meses. Cuando lo hagan, tu diferenciación se reduce a "multi-provider" (OpenCode soporta varios LLMs) y "self-hosted option".
- **OpenCode equipo oficial** — podrían meter un relay propio en su roadmap. Hablar con ellos antes de invertir meses.
- **Generic SSH/tunnel solutions** — no son competencia real, diferentes usecase.

**Riesgo de timing:** si Anthropic lanza remote access nativo en Junio 2026, vos shipeás GA en Julio, tu proposición se debilita drásticamente.

### 12.5 Riesgos concretos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| OpenCode SDK breaking changes | Media | Alto | Pin de versión, tests E2E contra SDK releases |
| Security incident (token leak) | Baja | Catastrófico | Pentest antes de GA ($500-1500), bug bounty $100-500 |
| Low adoption (<20 paid users en 6 meses) | **Alta** | Alto | Budget explícito de "fail fast": si Phase 3 no muestra tracción, sunset |
| Anthropic ships competing feature | Media-Alta | Alto | Diferenciarse en multi-provider y self-hosted option |
| Burnout por soporte 24/7 | Media | Alto | SLA honesto "best effort", no hacer promesas que no podés cumplir solo |

### 12.6 Alternativa: pulir self-hosted (1-2 semanas)

En vez de 3 meses de relay, podés:

- **1 semana**: docs brillantes para setup con `cloudflared` + Tailscale Funnel + ngrok (step-by-step con screenshots, video de 5 min).
- **3-5 días**: `opencode-pilot tunnel init` wizard que automatiza `cloudflared login && cloudflared tunnel create && ...`. **Esto resuelve el 80% del pain point del onboarding.**
- **2-3 días**: mejoras de dashboard PWA pendientes según PRODUCTION_READINESS.md.

Resultado: capturás a la mayoría del mercado técnico sin asumir costo operativo, sin superficie de ataque, sin obligación legal. **Los no-técnicos siguen sin poder usarlo** — ese segmento lo perdés. Pero si ese segmento resulta ser chico (cosa que no sabés), ahorraste 3 meses.

### 12.7 Recomendación final

**Score: 6/10 — interesante, pero no ahora.**

**Traducción:** la idea es sólida técnicamente y el diseño es implementable. El problema no es el diseño, es el **momento**:

- v1.6.4 tiene pulido pendiente (dashboard, docs, production-readiness) que da más ROI con menos riesgo.
- No validaste demanda: ¿cuántos de los usuarios actuales te pidieron esto explícitamente? Si son <5 y no hay waitlist, el mercado es suposición.
- Anthropic sombra grande en el horizonte de 12 meses.

**Plan propuesto en orden de prioridad:**

1. **Semana 1-2**: polish self-hosted + tunnel wizard (§12.6). Publicá. Medí adopción.
2. **Semana 3-4**: pedí feedback explícito a 20 usuarios actuales: "¿pagarías $8/mes por una versión cloud que no requiera setup?". Buscá 5 commitments reales (no "sí, interesante").
3. **Si <5 commitments**: no construyas el relay. Seguí con features self-hosted (multi-project UX, mejores notificaciones, etc.).
4. **Si ≥5 commitments**: volvé a este doc, ajustá scope según feedback, construí Phase 1-2. Lanzá con waitlist que ya tenés.

**Score ajustado por timing:**
- **Ahora (Abril 2026):** 6/10.
- **Con 10+ commitments de pago validados:** 8/10.
- **Con 0 validación y v1 sin pulir:** 3/10.

El diseño está. La decisión es de negocio, no técnica. Y en negocio, **los solo devs que shippean relays antes de validar terminan manteniendo servers para 12 usuarios gratis durante años.** No seas ese dev.

---

## Anexos

### A. Referencias de precios consultadas (Abril 2026)

- Fly.io pricing: shared-1x machine ~$2-5/mes, fly-postgres nano free tier.
- Upstash Redis: 10k commands/day free, pay-as-go thereafter.
- Cloudflare Pro: $25/mes.
- Sentry: free tier 5k errors/mes, Team $26/mes.
- Axiom: free tier 0.5GB/mes, starter $25/mes.
- Stripe: 2.9% + $0.30 per transaction.

### B. Notas para implementación futura (no ahora)

- Si escalás a múltiples nodos WS, documentá el sticky-session requirement en el LB.
- Considerar **CRDT-based state sync** (Yjs) si llegás a multiplayer real-time en el dashboard.
- Evaluá MsgPack sobre JSON si los volúmenes superan 1M msgs/día por pairing.
- Para E2E (Opción B), estudiá MLS (Messaging Layer Security) como alternativa a double ratchet.

---

*Fin del documento. ~3,600 palabras. Escrito para ser leído en una sentada y releído antes de commitear 3 meses.*
