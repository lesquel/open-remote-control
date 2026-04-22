# OpenCode Pilot — Pitch corto (7 slides)

Deck de 7 slides para una presentación rápida de 3–5 minutos. Cada slide tiene el texto central, una nota para el orador, y una sugerencia visual. Datos reales al día de v1.14.1.

---

## Slide 1 — Portada

**Título:** OpenCode Pilot

**Subtítulo:** Control remoto para OpenCode. Dashboard web, móvil, notificaciones push.

**Visual:** logo o mockup del dashboard mostrando la vista de sesión en un laptop + un teléfono.

**Nota para el orador:**
> *OpenCode Pilot es un plugin oficial que le da a OpenCode un dashboard web accesible desde cualquier dispositivo. Tres minutos de presentación y tienen todo el contexto.*

---

## Slide 2 — El problema

**Título:** Una terminal es una prisión

**Bullets:**

- OpenCode corre en tu terminal. Te levantás y todo se frena.
- El agente pide aprobar un comando peligroso — no hay nadie.
- Querés seguir una sesión larga desde el sofá — no podés.
- Tenés tres proyectos abiertos — perdés el hilo de cada uno.

**Visual:** foto o ilustración de alguien sentado frente a una terminal, con una notificación en el celular que nunca llega.

**Nota para el orador:**
> *El agente es potente pero está anclado a la silla. Ese es el dolor que resolvemos.*

---

## Slide 3 — La solución

**Título:** Un dashboard y listo

**Texto central (grande):**

```bash
bunx @lesquel/opencode-pilot init
```

**Subtexto:**
Un comando instala todo. Reabrís OpenCode, tipeás `/remote`, se abre el dashboard en el navegador.

**Visual:** captura del dashboard con la pestaña del proyecto activa.

**Nota para el orador:**
> *Un comando. No hay paso dos. El plugin se auto-configura, edita `opencode.json`, y levanta un servidor HTTP en `localhost:4097`.*

---

## Slide 4 — Cómo funciona

**Título:** Tres piezas, un protocolo

**Texto + diagrama simple:**

```
 OpenCode TUI  ←─┐
                 │  hooks del SDK
 Plugin server  ─┤
                 │  HTTP + SSE
 Dashboard web  ←┘
```

**Bullets de apoyo:**

- El plugin es server + TUI — se auto-registra en OpenCode.
- Usa Server-Sent Events para streaming en vivo.
- Persiste estado mínimo en `~/.opencode-pilot/` (JSON atómico).

**Nota para el orador:**
> *Bun.serve en el backend, vanilla JavaScript en el frontend, cero frameworks. Todo abre en <1 segundo.*

---

## Slide 5 — Las 5 cosas que te convencen

**Título:** Lo que te vas a llevar

**Cards (una por línea):**

1. **Aprobación remota.** Permisos pedidos por el agente llegan a tu dashboard, incluso al celular vía Web Push.
2. **Multi-proyecto.** Pestañas para cada carpeta que abriste. Cambiás de contexto sin perder sesiones.
3. **Streaming real.** Cada token aparece a medida que se genera. Efecto typewriter, no polling.
4. **Telegram integrado.** Token del bot + chat ID y te llegan las alertas donde ya chateás.
5. **Túnel con un flag.** `PILOT_TUNNEL=cloudflared` y el dashboard queda accesible desde afuera.

**Visual:** grid de 5 íconos o capturas chicas del dashboard en distintos estados.

**Nota para el orador:**
> *No tengo que mostrar los 27 endpoints. Con estas 5 cosas el pitch está hecho.*

---

## Slide 6 — Arranque

**Título:** Primeros 2 minutos

**Pasos numerados:**

1. `bunx @lesquel/opencode-pilot init`
2. Reabrir OpenCode
3. Tipear `/remote` en el TUI
4. El navegador se abre solo con tu proyecto activo
5. *(Opcional)* abrir Settings y configurar Telegram / VAPID / túnel

**Visual:** screencast o gif corto de los 4 pasos.

**Nota para el orador:**
> *Dos minutos, literal. El paso 5 es opcional y se hace desde la UI con hints inline.*

---

## Slide 7 — Cierre

**Título:** Probalo ahora

**CTA principal:**

```
bunx @lesquel/opencode-pilot init
```

**Links:**

- GitHub: `github.com/lesquel/open-remote-control`
- npm: `@lesquel/opencode-pilot`
- Issues: `github.com/lesquel/open-remote-control/issues`

**Cierre:**

> MIT. 232 tests verdes. Funciona en Linux, macOS y Windows.

**Nota para el orador:**
> *Es open source, bien testeado, y el autor responde issues rápido. El que quiera probar lo instala en 5 segundos.*
