# OpenCode Pilot — Contenido para la landing page

Material crudo en español para armar la landing del plugin. Todos los datos son reales al día de v1.14.1. Usalo como fuente para cualquier framework (Astro, Next, Nuxt, HTML plano) — el contenido está estructurado por secciones y con sus CTAs.

---

## 0. Metadatos base

| Campo | Valor |
|-------|-------|
| Nombre | OpenCode Pilot |
| Paquete npm | `@lesquel/opencode-pilot` |
| Versión actual | `1.14.1` |
| Licencia | MIT |
| Repositorio | `https://github.com/lesquel/open-remote-control` |
| Issues | `https://github.com/lesquel/open-remote-control/issues` |
| Autor | lesquel |
| Sponsors | `https://github.com/sponsors/lesquel` |
| Runtime requerido | OpenCode `>= 0.1.0`, Node/Bun moderno |
| Engines | `opencode >= 0.1.0` |
| Peer dependency | `@opencode-ai/plugin` |

---

## 1. Hero

**Tagline principal (elegí uno):**

- *"Controlá OpenCode desde el teléfono, sin levantar la vista del laptop."*
- *"Tu sesión de OpenCode, en cualquier dispositivo, con aprobación remota."*
- *"El plugin oficial de control remoto para OpenCode — dashboard web, notificaciones push, soporte móvil."*

**Subtítulo:**

> Dashboard web con pestañas multi-proyecto, streaming en vivo vía SSE, notificaciones por Telegram y Web Push, túnel público opcional, y una PWA para seguir la sesión desde el celular. Un solo comando instala todo.

**CTA primario:** `Instalar ahora` → ancla a sección "Instalación"
**CTA secundario:** `Ver en GitHub` → `https://github.com/lesquel/open-remote-control`

**Código del hero (copy-paste directo):**

```bash
bunx @lesquel/opencode-pilot init
```

---

## 2. Problema que resuelve

Párrafo para contexto:

> OpenCode es un agente de IA que corre en tu terminal. Funciona perfecto mientras estés sentado frente a él — pero en cuanto te levantás, todo se frena. El agente pide permiso para ejecutar un comando, no hay nadie para aprobarlo. Querés seguir la ejecución desde el teléfono mientras hacés otra cosa, no podés. Abrís otro proyecto en otra terminal y perdés el hilo de lo que estaba haciendo el primero.
>
> OpenCode Pilot resuelve esto con un dashboard web que se conecta a tu OpenCode y te deja aprobar permisos, enviar prompts y ver el streaming de respuestas desde cualquier dispositivo en tu red — o desde afuera, si activás el túnel.

**Lista de dolores concretos (para cards o bullets):**

- Aprobar permisos de herramientas peligrosas sin estar frente a la terminal.
- Seguir sesiones largas desde el sofá, el celular o una segunda máquina.
- Coordinar varios proyectos de OpenCode abiertos al mismo tiempo — cada uno con su tab.
- Recibir una notificación por Telegram o push cuando el agente termina algo.
- Compartir el dashboard con un colega detrás de un túnel (cloudflared o ngrok).

---

## 3. Features

Cada feature con título corto + una línea descriptiva. Usalos como cards.

### Dashboard multi-proyecto

Pestañas para todos los proyectos que abriste con OpenCode. Cambiás de contexto sin perder sesiones. Cada tab recuerda sus propias sesiones, mensajes y estado.

### Streaming en vivo vía SSE

Cada token de la respuesta aparece a medida que OpenCode lo genera. Sin recargar, sin polling, sin latencia. Efecto typewriter real.

### Aprobación remota de permisos

Cuando el agente pide permiso para ejecutar una herramienta, aparece un banner en el dashboard — desde tu celular también. Aprobás o rechazás con un toque. Si hay cola, se muestra el contador `1/N`.

### PWA y soporte móvil

La interfaz es responsive. Podés instalar el dashboard como app desde el menú del navegador. Service worker con cache versionado, detección de cambios de red, y banner de reconexión.

### Notificaciones por Web Push

Generás las claves VAPID desde Settings con un clic. Te suscribís desde el navegador. Recibís notificación aunque el dashboard esté cerrado.

### Bot de Telegram

Configurás token + chat ID (hay hints en el dashboard con dónde conseguirlos). Recibís alertas de permisos, errores y fin de sesión directamente en Telegram.

### Túnel público opcional

`PILOT_TUNNEL=cloudflared` (o `ngrok`) y el plugin levanta un túnel automático, detecta la URL, te la muestra en el dashboard y genera un QR para que cualquier dispositivo se conecte desde afuera de tu LAN.

### Browser de archivos con glob

Opcionalmente (opt-in vía `PILOT_ENABLE_GLOB_OPENER=true`), explorás el árbol de archivos del proyecto, buscás por patrón glob con debounce, y abrís archivos para ver su contenido.

### Command palette + shortcuts

Ctrl/Cmd + K abre la paleta. Cambiás de agente, de modelo, de proveedor, creás sesión nueva, cambiás de proyecto — todo con teclado.

### Settings UI

Configurás puerto, host, túnel, Telegram, VAPID keys, timeouts y más desde una modal en el dashboard. Se guarda atómicamente en `~/.opencode-pilot/config.json`. Los valores fijados por shell env quedan marcados como locked.

### Auto-focus de la carpeta activa

`/remote` levanta el dashboard y automáticamente enfoca la pestaña de la carpeta donde estás trabajando. Si no existe, la crea. Esto usa el estado real del TUI (`api.state.path.directory`), no la cwd del proceso.

### Welcome card + onboarding in-app

Primer visitante del dashboard ve un checklist de 4 pasos: enviar un prompt, aprobar permisos, conectar el teléfono, abrir Settings. Se descarta para siempre con un clic.

### Recuperación de token pegando URL

Si OpenCode reinició y tu token quedó stale, la pantalla de "token inválido" te deja pegar la URL fresca de `/remote` y extrae el nuevo token sola. No tenés que volver a la terminal.

### CLI con `doctor` y `uninstall`

`bunx @lesquel/opencode-pilot doctor` hace 6 checks de salud en <2 segundos para pegar en un issue. `uninstall` revierte toda la instalación (opcional `--keep-config`).

### Hints y validación inline

Cada campo de Settings tiene un hint con dónde conseguir el valor (ej: "Get a Telegram token from @BotFather"). Al perder foco, valida formato básico sin bloquear el save.

---

## 4. Cómo funciona (arquitectura resumida)

Párrafo + diagrama conceptual:

```
┌─────────────────────┐      ┌─────────────────────┐
│   OpenCode TUI      │      │   Dashboard web     │
│   (tu terminal)     │      │   (cualquier navegador)│
└──────────┬──────────┘      └──────────┬──────────┘
           │                            │
           │    hooks del SDK           │    HTTP + SSE
           │                            │
           └──────────┬─────────────────┘
                      │
           ┌──────────▼──────────┐
           │  Plugin server      │
           │  (Bun.serve)        │
           │                     │
           │  • Permisos queue   │
           │  • Event bus (SSE)  │
           │  • Settings store   │
           │  • Audit log        │
           │  • Telegram bot     │
           │  • Tunnel service   │
           │  • Web Push         │
           │  • Multi-instance   │
           │    coordinator      │
           └─────────────────────┘
```

### El flujo en 3 pasos

1. **Instalás** con `bunx @lesquel/opencode-pilot init`. El CLI edita `opencode.json` y `tui.json` para registrar el plugin.
2. **Reabrís OpenCode.** El plugin arranca un servidor HTTP en `127.0.0.1:4097`, escribe el token en `~/.opencode-pilot/pilot-state.json`, y carga los slash commands.
3. **Corrés `/remote`** en el TUI. El plugin abre tu navegador por defecto, con un hash `#dir=<carpeta-actual>` que el dashboard usa para auto-enfocar la pestaña correcta.

---

## 5. Especificaciones técnicas

### Stack

- **Runtime del plugin:** Bun (o Node con `@opencode-ai/plugin`)
- **Lenguaje backend:** TypeScript estricto, sin `any`
- **HTTP:** `Bun.serve` con idle timeout alineado al keepalive SSE
- **Dashboard:** Vanilla JavaScript + ES modules (sin framework)
- **Service worker:** PWA con cache versionado por release
- **Persistencia:** JSON atómico en disco (`~/.opencode-pilot/config.json` + `pilot-state.json`)
- **Eventos:** Server-Sent Events (SSE) con keepalive de 25s
- **Tests:** 232 tests unitarios y de integración (Bun test)

### Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PILOT_PORT` | `4097` | Puerto HTTP del dashboard |
| `PILOT_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` para LAN |
| `PILOT_PERMISSION_TIMEOUT` | `300000` | Milisegundos de espera para aprobar |
| `PILOT_TUNNEL` | `off` | `cloudflared` o `ngrok` |
| `PILOT_TELEGRAM_TOKEN` | — | Token del bot de BotFather |
| `PILOT_TELEGRAM_CHAT_ID` | — | Tu chat ID numérico |
| `PILOT_VAPID_PUBLIC_KEY` | — | Web Push public key |
| `PILOT_VAPID_PRIVATE_KEY` | — | Web Push private key |
| `PILOT_VAPID_SUBJECT` | `mailto:admin@opencode-pilot.local` | VAPID subject |
| `PILOT_ENABLE_GLOB_OPENER` | `false` | Habilita `/fs/glob` + `/fs/read` |
| `PILOT_DEV` | `false` | Re-lee HTML en cada request |
| `PILOT_FETCH_TIMEOUT_MS` | `10000` | Timeout de calls externos |
| `PILOT_NO_AUTO_OPEN` | — | `=1` para no abrir navegador automáticamente |

### Endpoints HTTP

El servidor expone 27 endpoints. Los más relevantes:

- `GET /` + `GET /dashboard/*` — sirve la UI (sin auth)
- `GET /health` — probe público (sin auth)
- `GET /status` — estado general (auth)
- `GET /events` — stream SSE (auth via Bearer o `?token=`)
- `GET /sessions` / `POST /sessions` — lista y crea sesiones
- `POST /sessions/:id/prompt` — enviar prompt
- `GET /sessions/:id/messages` — mensajes de una sesión
- `GET /sessions/:id/diff` — diff del worktree
- `POST /sessions/:id/abort` — cortar generación
- `GET /permissions` / `POST /permissions/:id` — aprobar/rechazar
- `GET /settings` / `PATCH /settings` — leer y modificar config
- `POST /settings/vapid/generate` — generar claves VAPID
- `POST /auth/rotate` — rotar token
- `GET /connect-info` — info para QR / túnel

Routing multi-proyecto: los endpoints per-proyecto aceptan `?directory=<path>` para auto-bootear la instancia del worktree correcto.

### Seguridad

- Bind a `localhost` por defecto
- Auth Bearer token generado por sesión (32 bytes random)
- Token rotation vía `POST /auth/rotate`
- Audit log de cada operación remota
- Path traversal detection en `?directory=`
- CORS restrictivo
- Typed errors sin stack leaks
- Service worker cache invalidado por versión automáticamente

### Comandos en el TUI

| Slash | Alias | Qué hace |
|-------|-------|----------|
| `/remote` | `/dashboard` | Abre el dashboard en el navegador |
| `/remote-control` | `/pilot`, `/rc` | Muestra estado + banner con QR |
| `/pilot-token` | — | Muestra el token completo + ejemplos curl |

---

## 6. Instalación

### Pre-requisitos

- OpenCode instalado (`npm i -g opencode` o tu método preferido)
- Bun (recomendado) o Node moderno

### Instalación en un comando

```bash
bunx @lesquel/opencode-pilot init
```

Esto:

1. Instala el paquete npm en el directorio de plugins de OpenCode.
2. Registra el plugin en `opencode.json::plugin` y `tui.json::plugin`.
3. Invalida el cache si hay una versión anterior.
4. Imprime el checklist de próximos pasos.

### Después de instalar

1. Cerrá todas las instancias de OpenCode.
2. Reabrí OpenCode desde tu proyecto: `opencode`.
3. Tipeá `/remote` y se abre el dashboard.

### Desinstalar

```bash
bunx @lesquel/opencode-pilot uninstall          # borra todo
bunx @lesquel/opencode-pilot uninstall --keep-config   # preserva ~/.opencode-pilot/config.json
```

### Diagnóstico

```bash
bunx @lesquel/opencode-pilot doctor
```

Reporta: plugin instalado, config edits presentes, OpenCode corriendo, pilot responsivo, state file válido.

---

## 7. Casos de uso

### Desarrollador solo que quiere aprobar desde el celular

Tu agente está ejecutando un refactor largo. Te levantás a hacer café. En el celular, una notificación Web Push te avisa que el agente pide permiso para ejecutar `rm -rf node_modules`. Aprobás desde el celular con un toque.

### Equipo que colabora revisando sesiones

Activás el túnel (`PILOT_TUNNEL=cloudflared`). El dashboard queda accesible con un link público. Un colega sigue la sesión en tiempo real para hacer pair programming asincrónico.

### Quien trabaja en varios proyectos simultáneos

Tenés OpenCode corriendo en 3 terminales distintas, en 3 proyectos distintos. Abrís el dashboard y las 3 aparecen como pestañas. Cambiás entre proyectos sin perder estado.

### Debug de sesiones remotas

Necesitás ver qué hizo el agente hace 2 horas en el servidor de CI. Te conectás al túnel, abrís la sesión en el dashboard, leés el histórico completo, descargás el diff.

### Integración con notificaciones del equipo

Bot de Telegram conectado a un canal del equipo. Cada vez que un agente termina una tarea larga, el canal recibe el resumen. Todo el equipo ve el progreso sin cargar un dashboard.

---

## 8. Versión y roadmap

### Versión actual

`v1.14.1` — release audit-driven (ver `CHANGELOG.md`). 232 tests verdes, tipos estrictos, zero breaking changes desde `v1.13.x`.

### Lo que trajo 1.14.0 y 1.14.1

- Paths cross-platform (XDG + Windows)
- Strings centralizados
- Welcome card + Getting Started
- Recuperación de token pegando URL
- Validación inline en Settings
- Warnings al arrancar si falta config
- Fix crítico de `/remote` que no abría la carpeta activa
- WCAG AA en el light theme
- 22 mensajes de error rewrite para decir cómo arreglar

### Roadmap cercano

- Wirear los generation IDs a los call sites para eliminar completamente races de fetches en tab-switch
- AbortController en `loadMVMessages` para cancelar panels en multi-view
- Per-picker keydown cleanup unificado en command palette
- Más opciones de integración (Slack, Discord)

---

## 9. Créditos y comunidad

- **Autor:** lesquel (`https://github.com/lesquel`)
- **Sponsors:** `https://github.com/sponsors/lesquel`
- **Issues y feature requests:** `https://github.com/lesquel/open-remote-control/issues`
- **Licencia:** MIT

---

## 10. FAQ sugerido

**¿Corre en Windows?**
Sí. Path handling usa `APPDATA`/`LOCALAPPDATA`, el PATH separator está parametrizado, y `init.ts` detecta `win32` para los comandos de shell.

**¿Necesito abrir un puerto?**
No por defecto. El dashboard corre en `localhost:4097`. Para acceder desde otro dispositivo en tu LAN, poné `PILOT_HOST=0.0.0.0`. Para afuera de tu red, usá `PILOT_TUNNEL=cloudflared`.

**¿El token se rota?**
Sí. Cada vez que OpenCode reinicia, se genera uno nuevo. Hay endpoint `POST /auth/rotate` para rotarlo manualmente. La UI detecta tokens stale con `visibilitychange` y te deja pegar la URL fresca sin reiniciar.

**¿Qué pasa si tengo varias instancias de OpenCode abiertas?**
La primera queda como "primary". Las siguientes entran en "passive mode" — si la primary muere, la segunda promueve automáticamente en 500ms. Es transparente.

**¿Los datos salen de mi máquina?**
No, salvo que actives explícitamente el túnel (`PILOT_TUNNEL`) o conectes Telegram. La audit log queda local en `~/.opencode-pilot/`.

**¿Necesita base de datos?**
No. Todo es en memoria + JSON files atómicos para config y state.

**¿Cuánto ocupa?**
El paquete npm pesa pocos KB. El runtime del plugin es Bun puro.

---

## 11. Bloque de código destacado

Ponelo cerca del CTA principal para que se vea que es simple de verdad.

**.env completo (todo opcional):**

```bash
PILOT_PORT=4097
PILOT_HOST=127.0.0.1
PILOT_TUNNEL=off
PILOT_TELEGRAM_TOKEN=1234567:AAA...
PILOT_TELEGRAM_CHAT_ID=-1001234
PILOT_VAPID_PUBLIC_KEY=...
PILOT_VAPID_PRIVATE_KEY=...
```

**Curl al dashboard desde shell:**

```bash
TOKEN=$(cat ~/.opencode-pilot/pilot-state.json | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4097/status
```

**Stream de eventos SSE:**

```bash
curl -N "http://127.0.0.1:4097/events?token=$TOKEN"
```

---

## 12. Texto para meta tags / SEO

**Title:** *"OpenCode Pilot — Dashboard remoto para OpenCode"*
**Description:** *"Plugin oficial de control remoto para OpenCode. Dashboard web multi-proyecto, streaming SSE en vivo, PWA móvil, notificaciones Telegram y Web Push, túnel opcional con cloudflared o ngrok. Instalás con un comando."*
**Keywords:** `opencode, plugin, ai-agent, remote-control, dashboard, pwa, telegram-bot, web-push, cloudflared, ngrok, qr-code, developer-tools`

---

## 13. Bloques pequeños útiles

### Badge de estado

```markdown
![npm](https://img.shields.io/npm/v/@lesquel/opencode-pilot)
![license](https://img.shields.io/npm/l/@lesquel/opencode-pilot)
```

### Botón de sponsor

```html
<a href="https://github.com/sponsors/lesquel" target="_blank" rel="noopener">
  Sponsor
</a>
```

### Link a docs internas

- `docs/INSTALL.md` — guía de instalación detallada
- `docs/CONFIGURATION.md` — todas las variables explicadas
- `docs/TROUBLESHOOTING.md` — debugging de problemas comunes
- `docs/ARCHITECTURE.md` — decisiones de diseño
