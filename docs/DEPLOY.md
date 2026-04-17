# Deploying opencode-pilot

opencode-pilot is **not a cloud-hosted service**. It is an OpenCode plugin that runs on your machine, alongside OpenCode. The dashboard is a Progressive Web App (PWA) that connects back to your plugin — either over your LAN, through a tunnel, or over a VPN like Tailscale.

This guide covers the three deployment modes: LAN, Public Tunnel, and Tailscale.

## The Mental Model

```
           ┌─────────────────────────┐
           │  Your phone (browser    │
           │  or installed PWA)      │
           └────────────┬────────────┘
                        │
                        │  one of three bridges
                        │
        ┌───────────────┼────────────────┐
        │               │                │
    ┌───┴───┐       ┌───┴────┐      ┌────┴─────┐
    │  LAN  │       │ Tunnel │      │ Tailscale│
    │ Wi-Fi │       │ (cf /  │      │   mesh   │
    │       │       │  ngrok)│      │          │
    └───┬───┘       └───┬────┘      └────┬─────┘
        │               │                │
        └───────────────┼────────────────┘
                        │
           ┌────────────┴────────────┐
           │  Your machine            │
           │  ┌───────────────────┐   │
           │  │ OpenCode process  │   │
           │  │  └─ opencode-pilot│   │
           │  │     (HTTP + SSE)  │   │
           │  │     :4097         │   │
           │  └───────────────────┘   │
           └─────────────────────────┘
```

- **Plugin** runs in-process with OpenCode on your development machine. It binds to a local port (default `4097`) and speaks HTTP + Server-Sent Events.
- **Dashboard PWA** is installable on your phone and is already hosted at `https://lesquel.github.io/open-remote-control/` (GitHub Pages). It is a static app — no backend, no database. The same HTML/JS is also served from your plugin at `GET /`, so both URLs work.
- **Bridge** is LAN, tunnel, or Tailscale — whatever you choose to let your phone reach your plugin.

You do **not** deploy opencode-pilot to Render, Fly, Vercel, Railway, or any other platform. The plugin has to live where OpenCode lives.

---

## Mode 1 — LAN (same Wi-Fi)

**When to use:** your phone and your computer are on the same network and you don't need remote access from outside.

**What you get:** zero external dependencies, no tunnel process, no public exposure. Just the plugin and your local network.

### Setup

1. Find the local IP of the host machine:

   ```bash
   # macOS
   ipconfig getifaddr en0

   # Linux
   ip -4 addr show | awk '/inet / && $2 !~ /^127/ {print $2}'

   # Windows (PowerShell)
   (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notmatch 'Loopback'}).IPAddress
   ```

   Note the address — something like `192.168.1.42`.

2. Start OpenCode with the plugin bound to all interfaces:

   ```bash
   PILOT_HOST=0.0.0.0 opencode
   ```

   The banner prints `Local: http://0.0.0.0:4097`, but you will use the actual LAN IP from step 1.

3. On your phone, open:

   ```
   http://192.168.1.42:4097/?token=<TOKEN_FROM_BANNER>
   ```

   Or scan the QR code in the banner. Note: when the plugin is bound to `0.0.0.0`, the QR target may need to be opened manually because `0.0.0.0` is not a valid destination for a phone. Use the LAN IP.

4. Approve any OS-level firewall prompts on the host so incoming connections on port `4097` are allowed.

### Security implications

- Anyone on the same Wi-Fi can reach the port. The auth token is the only barrier.
- Guest networks, coffee-shop Wi-Fi, or any shared network are risky — consider a tunnel or Tailscale instead.
- The token is regenerated on every plugin restart, so stale screenshots become useless quickly.

---

## Mode 2 — Public Tunnel (recommended for mobile data)

**When to use:** you want to access the dashboard from anywhere — on 4G/5G, from another network, from a coffee shop — without VPN setup.

**What you get:** an `https://` URL that hits your plugin from the public internet. The token is still the access control.

### Option A — Cloudflare Tunnel (recommended, no account)

Cloudflare's `cloudflared` can create an ephemeral tunnel without any Cloudflare account. Easiest option for solo use.

1. Install `cloudflared`:

   ```bash
   # macOS
   brew install cloudflared

   # Debian/Ubuntu
   curl -L https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb -o cloudflared.deb
   sudo dpkg -i cloudflared.deb

   # Windows (Scoop)
   scoop install cloudflared
   ```

2. Start OpenCode with the tunnel enabled:

   ```bash
   PILOT_TUNNEL=cloudflared opencode
   ```

3. The plugin spawns `cloudflared tunnel --url http://127.0.0.1:4097` and waits for the public URL. The banner updates with something like:

   ```
   Public:  https://random-words-here.trycloudflare.com
   ```

4. Open the PWA link in the banner from your phone. It embeds the tunnel URL plus the token in the `#connect=` fragment, so the PWA pairs automatically.

### Option B — ngrok (free account required)

1. Install ngrok and register a free authtoken at [ngrok.com](https://ngrok.com):

   ```bash
   brew install ngrok
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```

2. Start OpenCode with ngrok as the tunnel:

   ```bash
   PILOT_TUNNEL=ngrok opencode
   ```

3. The banner updates with an `https://<subdomain>.ngrok-free.app` URL. Open it from your phone the same way.

### Security implications

- The tunnel is public — anyone with the URL can hit your plugin.
- The auth token is the only barrier. Never paste the token in screenshots, videos, or shared screens.
- Every plugin restart rotates the token, which invalidates old banner links automatically.
- For higher-risk environments, consider adding Cloudflare Access (SSO gating) on a named tunnel — see below.

### Persisting a named Cloudflare Tunnel (advanced)

The ephemeral `trycloudflare.com` URL changes on every startup. If you want a stable URL (e.g. `pilot.yourdomain.com`) you can create a **named tunnel**:

1. Authenticate with Cloudflare: `cloudflared tunnel login`
2. Create a named tunnel: `cloudflared tunnel create opencode-pilot`
3. Write a `config.yml` that points the hostname at `http://localhost:4097`
4. Run your own `cloudflared tunnel run opencode-pilot` alongside OpenCode (instead of using `PILOT_TUNNEL=cloudflared`)

Full instructions live in the [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). When you manage the tunnel yourself, leave `PILOT_TUNNEL=off` and just bind to `127.0.0.1` — `cloudflared` handles the public side.

---

## Mode 3 — Tailscale (private VPN mesh)

**When to use:** you already use Tailscale, or you want a zero-config private network across all your devices without any public exposure.

**What you get:** your plugin is reachable from any device in your tailnet, over a WireGuard-based mesh, on any network, without opening ports or sharing public URLs.

### Setup

1. Install Tailscale on both the host machine and the phone, sign in with the same account:
   - Host: [tailscale.com/download](https://tailscale.com/download)
   - Phone: App Store / Play Store

2. Start OpenCode bound to all interfaces so it also listens on the Tailscale interface:

   ```bash
   PILOT_HOST=0.0.0.0 opencode
   ```

   (You can be stricter and bind to the Tailscale IP only, but `0.0.0.0` is the simplest path.)

3. Find the Tailscale hostname of the host:

   ```bash
   tailscale status
   ```

   Your host will appear as something like `my-laptop` with a tailnet address such as `100.x.y.z`.

4. On the phone, open:

   ```
   http://my-laptop:4097/?token=<TOKEN>
   ```

   Or use the tailnet IP directly. Everything works the same on Wi-Fi and on mobile data — Tailscale routes the traffic.

### Using MagicDNS

If MagicDNS is enabled in your Tailscale admin console, you can use the short hostname (`my-laptop`) or the full MagicDNS name (`my-laptop.tail-scale-name.ts.net`) without manually looking up IPs. The PWA can be pointed at either form; both resolve correctly on any tailnet device.

---

## Environment Variables Reference

See the [main README](../README.md#configuration) for the full config table. The variables most relevant to deployment are:

| Variable | Default | Why it matters for deployment |
|---|---|---|
| `PILOT_PORT` | `4097` | Change if the default collides with something else. Firewall rules need to match. |
| `PILOT_HOST` | `127.0.0.1` | **Must be changed for any mode except pure localhost.** Use `0.0.0.0` for LAN or Tailscale; the tunnel mode still binds to localhost and lets the tunnel process forward traffic. |
| `PILOT_TUNNEL` | `off` | Set to `cloudflared` or `ngrok` to expose publicly. |
| `PILOT_TELEGRAM_TOKEN` | _(unset)_ | Optional — enables Telegram notifications with approve/deny buttons, useful when you can't open the PWA. |
| `PILOT_TELEGRAM_CHAT_ID` | _(unset)_ | Required together with `PILOT_TELEGRAM_TOKEN`. |
| `PILOT_PWA_URL` | `https://lesquel.github.io/open-remote-control/` | Override if you forked and self-host the dashboard. QR codes and banner links point here when a tunnel is active. |

Key defaults to internalize:

- **Bind default is `127.0.0.1`** — nothing on your network can reach the plugin until you change this.
- **Tunnel default is `off`** — no network calls to Cloudflare or ngrok unless you opt in.
- **`PILOT_PWA_URL` default** is the GitHub Pages deployment. Unless you fork the dashboard, leave it alone.

---

## PWA Installation

The dashboard is installable as a Progressive Web App, which gets you a real app icon on the home screen and keeps the pairing credentials between launches.

**iOS (Safari):**
1. Open the dashboard URL in Safari.
2. Tap the **Share** button.
3. Tap **Add to Home Screen**.

**Android (Chrome):**
1. Open the dashboard URL in Chrome.
2. Tap the three-dot menu.
3. Tap **Add to Home Screen** (or **Install app** if the prompt appears).

Once installed, launching the icon reuses the last successful pairing (server URL + token, stored in `localStorage`). If the token rotated since then (new plugin restart), the PWA will prompt for a fresh pairing link.

**Tip — where to install from:** the PWA is served both from GitHub Pages (`https://lesquel.github.io/open-remote-control/`) and from your own server (`GET /`). Install from whichever URL you plan to use long-term. Installing from GitHub Pages is recommended because its URL doesn't change when your tunnel URL changes — the PWA is a pure client and points itself at your plugin using the encoded `#connect=` fragment.

---

## Testing from Your Phone — End-to-End

A quick smoke test to verify a full round trip:

1. Start OpenCode with a tunnel enabled:

   ```bash
   PILOT_TUNNEL=cloudflared opencode
   ```

2. When the banner prints, scan the QR code with the phone camera.
3. The phone browser opens the PWA link. Approve the **Install** prompt.
4. Open the installed PWA — you should see a list of active OpenCode sessions.
5. Trigger a permission request in an OpenCode session (any tool call that requires approval).
6. Verify the permission request appears on the phone within a second or two.
7. Tap **Allow** on the phone.
8. Verify OpenCode on the host continues with the operation.

If any step fails, check the troubleshooting section next.

---

## Troubleshooting

### Phone can't open the link

- **Same Wi-Fi?** Confirm both devices are on the same network and the host firewall allows `PILOT_PORT`.
- **Tunnel up?** Check the banner — if `Public:` is missing, the tunnel failed to start. Confirm `cloudflared` or `ngrok` is installed and on `PATH`.
- **Typo?** The token is long. Use the QR code or copy-paste the full URL instead of retyping.

### Token rejected

Each plugin restart generates a fresh token. If the banner in your terminal and the link on your phone are from different sessions, the token won't match. Re-scan the current QR or copy the current link.

### PWA install prompt doesn't appear

- The PWA install prompt requires Chrome (Android) or Safari (iOS).
- The page must be served over HTTPS (tunnel) or over localhost. Plain `http://` on a LAN IP will load the dashboard but may not offer **Add to Home Screen** on all browsers.
- Use the GitHub Pages URL for installation and let it pair with your plugin via the `#connect=` fragment — that path is always HTTPS.

### SSE connection drops every 10 seconds

This was a historical bug tied to `Bun.serve`'s default `idleTimeout: 10`. It is fixed in current versions (`idleTimeout: 255` plus a keepalive ping every 25s). If you still see it:

- Confirm you are on **Bun >= 1.1** — older versions may not honor `idleTimeout`.
- If you put a reverse proxy in front of the plugin (nginx, Caddy, Cloudflare named tunnel with custom rules), verify its idle timeout is **longer** than 30 seconds.

### Cloudflare tunnel fails to start

- `cloudflared` binary not found on `PATH` — install it (see Mode 2 Option A).
- Rate-limited by Cloudflare's ephemeral tunnel service — wait a minute, or use a named tunnel (advanced section above).
- Check the binary directly:

  ```bash
  cloudflared --version
  cloudflared tunnel --url http://127.0.0.1:4097
  ```

  If the second command never prints a `trycloudflare.com` URL, the issue is with `cloudflared`, not the plugin.

### Tailscale host unreachable

- Verify the tailnet state on both devices: `tailscale status` should list the peer as online.
- If the host is bound to `127.0.0.1`, it won't be reachable over Tailscale. Rebind with `PILOT_HOST=0.0.0.0` and restart OpenCode.

---

## What About Deploying the PWA Separately?

The PWA is a static app — no backend, no database, no server-side runtime. If you want to self-host it (for branding, a custom domain, or an internal-only mirror), you can:

- Fork the repo, tweak the dashboard code in `src/server/dashboard/`, and deploy the built output anywhere that serves static files: Netlify, Vercel, Cloudflare Pages, GitHub Pages, an nginx container — whatever you already use for static sites.
- Point the plugin at your fork:

  ```bash
  PILOT_PWA_URL=https://pilot.your-domain.com opencode
  ```

  The banner will generate QR codes and PWA pairing links using your URL.

The PWA remains a **pure client**: it reads the encoded server URL plus token from the `#connect=` fragment, saves it in `localStorage`, and speaks directly to your plugin's HTTP and SSE endpoints. It does not proxy traffic and it has no backend of its own.

This is the **only** part of opencode-pilot that benefits from a traditional deploy target. The plugin itself cannot live anywhere except where OpenCode runs.

---

## Summary

opencode-pilot is a **local plugin** plus a **static PWA** plus **one of three bridges**:

- **LAN** for dev on the same Wi-Fi.
- **Tunnel** (Cloudflare or ngrok) for access anywhere, including mobile data.
- **Tailscale** for a private mesh across your own devices.

Pick the bridge that matches your context, set `PILOT_HOST` (and optionally `PILOT_TUNNEL`) accordingly, open the banner link on your phone, and you are done. There is no server to provision, no platform to configure, no pipeline to maintain.
