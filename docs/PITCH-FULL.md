# OpenCode Pilot — Pitch completo (20 slides)

Deck de 20 slides para una presentación de 20–30 minutos. Cubre problema, solución, arquitectura, casos de uso, seguridad, roadmap. Datos reales al día de v1.14.1.

---

## Slide 1 — Portada

**Título:** OpenCode Pilot

**Subtítulo:** El plugin oficial de control remoto para OpenCode

**Texto de apoyo:**
Dashboard web multi-proyecto, SSE en vivo, PWA móvil, Telegram, Web Push, túnel público. Instalación en un comando.

**Visual:** logo + mockup con 3 dispositivos (laptop, tablet, celular) mostrando la misma sesión.

**Nota para el orador:**
> *Vamos a recorrer qué problema resuelve, cómo funciona por dentro, y qué casos concretos habilita. 20 minutos, 20 slides.*

---

## Slide 2 — Agenda

**Título:** De qué vamos a hablar

**Lista:**

1. El problema — una terminal es una prisión
2. La solución en un comando
3. Arquitectura y stack
4. Features principales (6 slides)
5. Seguridad
6. Configuración
7. Casos de uso reales
8. Estado del proyecto y roadmap
9. Cómo probarlo ahora

**Nota para el orador:**
> *Queda claro desde arranque que vamos a hablar tanto de producto como de implementación. Audiencia técnica se engancha; audiencia no técnica tiene anclas.*

---

## Slide 3 — El problema

**Título:** Una terminal es una prisión

**Párrafo:**

> OpenCode es potente, pero está anclado al lugar físico donde corre. El agente pide permisos que nadie aprueba mientras estás en otra pieza. Las sesiones largas requieren que vuelvas una y otra vez. Múltiples proyectos simultáneos son un caos de terminales abiertas.

**Cuatro dolores concretos:**

- Permisos que se pierden
- Sesiones sin supervisión
- Múltiples proyectos confundidos
- Cero visibilidad desde otro dispositivo

**Visual:** ilustración de una persona con 5 terminales abiertas y cara de frustración.

**Nota para el orador:**
> *Todos los que usan agentes de IA conocen este dolor. Es el motivo por el que existe el plugin.*

---

## Slide 4 — La solución

**Título:** Dashboard web con un comando

**Bloque de código grande:**

```bash
bunx @lesquel/opencode-pilot init
```

**Bullets:**

- Un solo comando instala, registra el plugin y deja todo listo.
- Reabrís OpenCode, tipeás `/remote`, y se abre el dashboard.
- Desde ahí: mandás prompts, aprobás permisos, ves streaming en vivo.

**Visual:** captura del dashboard con una sesión activa streameando.

**Nota para el orador:**
> *El foco está en la simpleza de instalación. No hay un segundo paso. El CLI edita los archivos de config por vos.*

---

## Slide 5 — Stack técnico

**Título:** Lo que hay abajo del capó

**Tabla:**

| Capa | Tecnología |
|------|-----------|
| Runtime | Bun (o Node con `@opencode-ai/plugin`) |
| Backend | TypeScript estricto, sin `any` |
| HTTP | `Bun.serve` con idle timeout alineado a SSE keepalive |
| Streaming | Server-Sent Events, keepalive 25s |
| Frontend | Vanilla JavaScript + ES modules, cero framework |
| Offline | Service worker con cache versionado automáticamente |
| Persistencia | JSON atómico en `~/.opencode-pilot/` |
| Auth | Bearer token 32 bytes, rotable |
| Tests | 232 tests Bun, unitarios + integración |
| Licencia | MIT |

**Nota para el orador:**
> *Decisión consciente de no usar frameworks en el frontend. Reduce dependencias, reduce superficie de ataque, y acelera el first paint. Bundle final son kilobytes.*

---

## Slide 6 — Arquitectura

**Título:** Tres procesos, un protocolo

**Diagrama:**

```
┌─────────────────────┐      ┌─────────────────────┐
│   OpenCode TUI      │      │   Dashboard web     │
│   plugin            │      │   (cualquier device)│
└──────────┬──────────┘      └──────────┬──────────┘
           │  slash cmds                │
           │  (event bus)               │  HTTP + SSE
           │                            │
           └──────────┬─────────────────┘
                      │
           ┌──────────▼──────────┐
           │  Plugin server      │
           │  (Bun.serve)        │
           │                     │
           │  • HTTP router      │
           │  • Auth middleware  │
           │  • Event bus (SSE)  │
           │  • Permission queue │
           │  • Audit log        │
           │  • Settings store   │
           │  • Telegram bot     │
           │  • Web Push service │
           │  • Tunnel manager   │
           │  • Multi-instance   │
           │    coordinator      │
           └─────────────────────┘
```

**Puntos a mencionar:**

- Dos plugins que cargan desde el mismo paquete: `server` y `tui`. Se comunican vía event bus del SDK, no por HTTP.
- El servidor expone 27 endpoints HTTP. El dashboard consume todos.
- Solo 3 archivos persistentes: `pilot-state.json`, `config.json`, `pilot-banner.txt`.

**Nota para el orador:**
> *La arquitectura es simple pero hay sutileza: los plugins server y TUI no se pueden combinar en un solo módulo porque OpenCode los carga por separado. Aprendimos esto en el v1.12.1.*

---

## Slide 7 — Multi-proyecto

**Título:** Pestañas reales para cada proyecto

**Texto:**

Cada vez que abrís OpenCode en una carpeta distinta, el dashboard crea una pestaña. Persiste en localStorage del navegador, así que sobrevive reloads y reinicios del browser.

**Detalles técnicos:**

- Cada tab tiene su propia lista de sesiones, mensajes cargados y estado de carga.
- Cambiar de tab NO hace un nuevo fetch si ya cargaste esa data (cache por tab).
- El auto-focus es vía `#dir=<encoded>` en el hash de la URL que el TUI genera al correr `/remote`.

**Visual:** screenshot del dashboard con 3 tabs distintas (nombres de carpetas reales).

**Nota para el orador:**
> *El v1.14.1 fijó un bug importante acá: `process.cwd()` no refleja el proyecto activo, había que usar `api.state.path.directory`. Bug que el usuario reportó como arrastrado desde hace tiempo.*

---

## Slide 8 — Streaming en vivo (SSE)

**Título:** Cada token, en vivo

**Texto:**

Cuando el agente genera texto, el dashboard lo muestra token por token. No hay polling. No hay refresh. Es un stream SSE persistente con keepalive cada 25 segundos.

**Detalles:**

- Un solo `EventSource` por tab, reconexión automática en caso de error.
- Handlers con cleanup explícito (nombrados, tracked en un array) — evita leaks al reconectar.
- El payload usa el mismo `PilotEvent` discriminated union del SDK.

**Tipos de evento que emite:**

- `pilot.permission.pending` / `pilot.permission.resolved`
- `pilot.tool.started` / `pilot.tool.completed`
- `pilot.subagent.spawned`
- `pilot.client.connected` / `pilot.client.disconnected`
- `pilot.token.rotated`
- `pilot.error`

**Nota para el orador:**
> *Emitir SSE en Bun es literalmente dos líneas. La parte difícil es la limpieza de listeners cuando reconectás; eso lo tenemos cubierto en v1.14.0.*

---

## Slide 9 — Permisos remotos

**Título:** Aprobá desde donde estés

**Texto:**

Cuando el agente pide permiso para ejecutar una herramienta sensible, aparece un banner en el dashboard. Si tenés Web Push configurado, llega también como notificación del navegador. Si tenés Telegram, también ahí.

**Flujo:**

1. Hook `permission.ask` del SDK dispara `pilot.permission.pending` al event bus.
2. Todos los clientes suscritos (dashboard + push + Telegram) reciben el evento.
3. El primero que resuelve (aprueba o rechaza) gana.
4. `pilot.permission.resolved` se emite; el resto de clientes cierran el banner.

**Cola visual:**

Si hay varios permisos pendientes, el banner muestra `1/N` — contador del queue.

**Nota para el orador:**
> *La cola se resuelve en orden FIFO. Timeout configurable (default 5 minutos). Si nadie aprueba, el agente recibe una denegación por timeout.*

---

## Slide 10 — PWA y móvil

**Título:** Una app instalable desde el navegador

**Texto:**

El dashboard es una PWA completa. Service worker, manifest, icons, offline básico. Podés instalarlo como app desde el menú del navegador — tanto en desktop como en mobile.

**Features móviles específicas:**

- Layout responsive, drawer lateral en mobile.
- Touch-friendly: targets mínimos de 44×44 px.
- Toast one-time al primer uso mobile explicando dónde está el panel de detalles.
- WCAG AA en light theme (corregido en v1.14.0).
- Service worker con cache invalidado por versión automáticamente.

**Nota para el orador:**
> *El cache del service worker antes se gestionaba a mano. Ahora el nombre del cache incluye la versión del plugin, así que cada release invalida el anterior sin intervención.*

---

## Slide 11 — Notificaciones (Telegram + Web Push)

**Título:** Alertas a donde ya prestás atención

### Telegram

- Creás un bot con `@BotFather`, obtenés un token.
- Consultás tu chat ID con `@userinfobot`.
- Ponés los dos valores en Settings (o como env vars).
- Circuit breaker interno: 5 fallas seguidas lo desactiva por 60 segundos.

### Web Push

- Generás las claves VAPID desde la UI con un clic (`POST /settings/vapid/generate`).
- Suscribís el browser desde Settings.
- Recibís notificaciones aunque el dashboard esté cerrado.
- Subscripciones persistidas server-side; limpiás desde la misma UI.

**Visual:** dos capturas — una del chat de Telegram con una alerta, otra del banner de notificación en el desktop.

**Nota para el orador:**
> *Los hints inline en Settings te dicen exactamente dónde conseguir cada valor. Intenta minimizar el bounce a la documentación externa.*

---

## Slide 12 — Túnel público

**Título:** Compartir la sesión en 1 flag

**Texto:**

```bash
PILOT_TUNNEL=cloudflared   # o ngrok
```

**Qué pasa:**

- El plugin detecta el binario en el PATH (cross-platform con `path.delimiter`).
- Spawnea el túnel, parsea la URL emitida (regex específico por proveedor).
- La URL aparece en el dashboard + se genera un QR automático.
- Timeout configurable: 20 segundos para que el túnel levante.
- Grace kill de 400ms al cerrar para evitar dangling processes.

**Visual:** captura del modal "Connect" del dashboard con el QR y la URL pública.

**Nota para el orador:**
> *Cloudflared y ngrok son los dos casos comunes. La lista de patterns está en `TUNNEL_URL_PATTERNS` en `constants.ts` — agregar un proveedor nuevo es una línea.*

---

## Slide 13 — Seguridad

**Título:** Defensa en capas

**Lista:**

1. **Bind a localhost** por defecto (`127.0.0.1:4097`). Para LAN hay que optar activamente (`PILOT_HOST=0.0.0.0`).
2. **Bearer token** de 32 bytes aleatorios, generado en cada boot de OpenCode.
3. **Token rotation** vía `POST /auth/rotate` — cualquier cliente puede disparar, toda la red se desconecta y se reconecta.
4. **Audit log** local en `~/.opencode-pilot/` de cada operación remota.
5. **Path traversal detection** — query `?directory=../` rechazada con 400.
6. **Typed errors** sin stack leaks en la respuesta.
7. **CORS** restrictivo: solo origin matching.
8. **Path length limit** — 512 chars máximo en paths, DoS protection.
9. **Null byte check** — paths con `\x00` rechazados.
10. **SW cache versionado** — upgrades invalidan caches anteriores automáticamente.

**Nota para el orador:**
> *Todos los endpoints sensibles requieren auth. Los únicos sin auth son GET / (dashboard), GET /dashboard/*, y GET /health (probe).*

---

## Slide 14 — Configuración

**Título:** Todo configurable, nada obligatorio

**Tabla de env vars (subset):**

| Variable | Default | Qué hace |
|----------|---------|----------|
| `PILOT_PORT` | `4097` | Puerto del dashboard |
| `PILOT_HOST` | `127.0.0.1` | Bind address |
| `PILOT_TUNNEL` | `off` | `cloudflared` o `ngrok` |
| `PILOT_TELEGRAM_TOKEN` | — | Bot de Telegram |
| `PILOT_VAPID_PUBLIC_KEY` | — | Web Push pub key |
| `PILOT_ENABLE_GLOB_OPENER` | `false` | Habilita file browser |

**Tres capas de config con precedencia:**

```
shell env > ~/.opencode-pilot/config.json > .env > defaults
```

Los campos fijados por shell env quedan marcados como "locked" en la UI (ícono de candado), y el PATCH devuelve 409 si intentás editarlos — con message explicando cómo desbloquear.

**Nota para el orador:**
> *Las decisiones importantes son opt-in. Nada que exponga al usuario sin pedirlo: ni LAN, ni túnel, ni file browser, ni notificaciones.*

---

## Slide 15 — Onboarding y ayuda

**Título:** Primeros 5 minutos, cuidados

**Qué hace para ayudarte:**

- **Welcome card** en el dashboard — 4 pasos colapsables, se descarta para siempre con un clic.
- **Hints inline** en Settings — cada campo con texto explicando dónde conseguir el valor.
- **Validación inline** — en blur, valida formato básico sin bloquear el save.
- **Error messages reescritos** — ~22 mensajes de error ahora te dicen cómo arreglar, no solo qué pasó.
- **CLI doctor** — `bunx @lesquel/opencode-pilot doctor` hace 6 checks de salud en <2 segundos.
- **Recuperación de token stale** — pegás URL de `/remote` fresh y extrae el nuevo token sin volver a la terminal.
- **Auto-open del browser** al correr `/remote` (con escape hatch `PILOT_NO_AUTO_OPEN=1`).

**Visual:** captura del welcome card + hint de uno de los campos.

**Nota para el orador:**
> *Un plugin que un desarrollador no sabe usar al minuto 2 es un plugin que no van a usar. Todo lo del v1.14.0 va por acá.*

---

## Slide 16 — Casos de uso

**Título:** Dónde encaja

### 1. Desarrollador solo + celular

Agente corriendo refactor. Te levantás. Push al celular: "pedir permiso para `rm -rf node_modules`". Aprobás con un toque.

### 2. Equipo colaborando en sesión

Activás túnel. Colega abre el link. Ven lo mismo en tiempo real. Pair programming asincrónico.

### 3. Múltiples proyectos a la vez

Tres terminales, tres OpenCode, tres pestañas en un solo dashboard. Contexto cambiado sin perder hilo.

### 4. Debug remoto

Servidor de CI corrió una sesión hace 2 horas. Te conectás por túnel, leés el histórico completo, descargás el diff, entendés qué pasó.

### 5. Notificaciones al equipo

Bot de Telegram conectado a un canal del equipo. Cada fin de sesión larga, el canal se entera. Visibilidad compartida.

**Nota para el orador:**
> *Los 5 casos son reales: cada uno corresponde a una feature específica del plugin. Ninguno es hipotético.*

---

## Slide 17 — Multi-instance

**Título:** Abrís OpenCode dos veces sin miedo

**Texto:**

Si ya hay un OpenCode corriendo y abrís otro, el segundo detecta que el puerto está ocupado y entra en "passive mode". No pelea por el puerto; monitorea si el primary muere.

**Flujo:**

1. Primary tiene el puerto y escribe `pilot-state.json`.
2. Secondary no puede bindear, lee el mismo state file, entra passive.
3. Cada 500ms el secondary intenta bindear.
4. Cuando el primary muere (cierre normal o crash), el port queda libre.
5. El primer secondary que logre bindear se promueve, escribe nuevo state, toast de "Promoted to primary".

**Detalles:**

- El lock es por port, no por PID — más robusto.
- Protección contra doble-promoción con flag `promotingNow`.
- Todos los errores del polling van a logger.warn, nunca crash del interval.

**Nota para el orador:**
> *Esto viene de un bug reportado por el usuario. Tres versiones hasta que quedó estable (1.13.11, 1.13.12, 1.13.13). Ahora es sólido.*

---

## Slide 18 — Estado del proyecto

**Título:** Dónde estamos

**Números:**

- Versión actual: **v1.14.1** (abril 2026)
- **232 tests** verdes, 443 expect calls, 22 archivos de tests
- **0 vulnerabilidades** reportadas
- **27 endpoints HTTP** documentados y cubiertos
- Cross-platform: **Linux, macOS, Windows** (path handling y PATH delimiter testeados en cada uno)
- **MIT license**

**Últimas 3 releases:**

- **v1.14.1** — fix del bug de `/remote` que no abría la carpeta activa.
- **v1.14.0** — release audit-driven: P0/P1 bugs + onboarding + hardcoded centralization.
- **v1.13.15** — dashboard 401 recovery + CLI doctor/uninstall.

**Nota para el orador:**
> *Mantenemos una cadencia de releases apretada. Cada release pasa por typecheck + 232 tests + provenance signing en GH Actions antes de publicar a npm.*

---

## Slide 19 — Roadmap

**Título:** Qué viene

**Deuda técnica ya identificada:**

- Wirear `fetchGeneration` a los call sites que falta (infra está lista desde v1.14.0).
- AbortController en `loadMVMessages` para cancelación de panels en multi-view.
- Command palette per-picker keydown cleanup completo.

**Features planeadas:**

- Integración con Slack (similar al Telegram actual)
- Integración con Discord
- Más tipos de visualización en multi-view (diff grid, cost tracker)
- Keybindings configurables desde la UI

**Investigación abierta:**

- Cloud relay v2 — reemplazo potencial del túnel local con servicio propio (ver `docs/CLOUD_RELAY_v2_DESIGN.md`)
- Session replay — reproducir una sesión grabada de principio a fin

**Nota para el orador:**
> *El roadmap es visible. Las features grandes pasan por un doc de diseño en `docs/`. Todo es público.*

---

## Slide 20 — Llamada a la acción

**Título:** Probalo en 5 segundos

**Bloque de código grande:**

```bash
bunx @lesquel/opencode-pilot init
```

**Tres links:**

- **GitHub:** `github.com/lesquel/open-remote-control`
- **npm:** `@lesquel/opencode-pilot`
- **Sponsors:** `github.com/sponsors/lesquel`

**Cierre:**

> Licencia MIT. 232 tests verdes. Funciona en Linux, macOS, Windows. Issues respondidos rápido.

**Contacto:**

- Issues: `github.com/lesquel/open-remote-control/issues`
- Discusiones: `github.com/lesquel/open-remote-control/discussions`

**Nota para el orador:**
> *La mejor forma de entenderlo es usarlo. Un minuto y tienen el dashboard andando. Lo instalan ahora, lo prueban con el agente que ya tienen corriendo, y nos cuentan.*

---

## Anexo — Datos para preguntas esperables

### "¿Cuánto pesa?"
Paquete npm pesa pocos KB. El runtime del plugin es Bun, sin bundle aparte.

### "¿Dependencias?"
- `@opencode-ai/plugin` (peer, provisto por OpenCode)
- `qrcode-terminal` (para el QR en el banner del TUI)
- `web-push` (solo si activás Web Push)

### "¿Funciona con OpenCode Cloud?"
Sí. El plugin se instala en `~/.config/opencode/plugins/`, que funciona tanto para OpenCode local como para la variante cloud.

### "¿Qué pasa si tengo ya un plugin custom?"
El plugin es aditivo. Edita `opencode.json::plugin` como array y empuja nuestra entry. Si tu entry ya está, no la duplica.

### "¿Requiere root o privilegios?"
No. Bind a puerto >= 1024, paths en `$HOME`, sin llamadas sudo.

### "¿Es compatible con modo offline?"
Parcial. El dashboard es una PWA con service worker — se abre offline mostrando la última data cacheada. Pero sin conexión al plugin server no podés enviar prompts ni recibir streaming.

### "¿Hay telemetría?"
No. Cero telemetría out-of-the-box.

### "¿Qué pasa con versiones viejas del dashboard cacheadas?"
Cada release bumpea `var GEN = "X.Y.Z"` en `index.html`. Al abrir, el self-heal detecta mismatch contra `localStorage[pilot:asset-gen]`, invalida el cache del service worker, y fuerza reload. Transparente.
