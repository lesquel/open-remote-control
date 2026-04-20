# Tunnel testing — verifying public access works end-to-end

This guide walks through testing the tunnel feature so you know it works
before recommending it to users.

## Why tunnels matter

Without a tunnel, the dashboard is only reachable on localhost or your local
network (`192.168.x.x`). With a tunnel, you get a public HTTPS URL like
`https://abc-xyz.trycloudflare.com` that works from anywhere — your phone on
4G, a friend's computer, your tablet on a hotel WiFi.

opencode-pilot supports two tunnel providers:
- **`cloudflared`** — free, no account, ephemeral URL on each restart
- **`ngrok`** — free tier requires account; paid tier has stable URLs

## Provider 1: cloudflared (recommended for getting started)

### Install cloudflared

```bash
# macOS
brew install cloudflared

# Linux (Debian/Ubuntu)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Linux (other / Linuxbrew)
brew install cloudflared

# Windows
winget install --id Cloudflare.cloudflared
```

Verify install:

```bash
cloudflared --version
# Expected: cloudflared version 2024.x.x ...
```

### Configure opencode-pilot

Edit your `.env`:

```bash
PILOT_HOST=127.0.0.1     # tunnel handles public access; bind locally is fine
PILOT_PORT=4097
PILOT_TUNNEL=cloudflared
```

### Start OpenCode

The plugin starts the tunnel automatically. Watch the terminal:

```
[opencode-pilot] Server listening on http://127.0.0.1:4097
[opencode-pilot] Starting cloudflared tunnel...
[opencode-pilot] Tunnel URL: https://abc-xyz-123.trycloudflare.com
[opencode-pilot] Banner written to /tmp/opencode-pilot-banner.txt
```

If you see `Tunnel URL:` with a `trycloudflare.com` URL — tunnel is up.

### Test it

**Step 1: open the tunnel URL in YOUR browser** (same machine, just to confirm).
You should land on the same dashboard you'd see at localhost. Token
authentication should still work (the URL includes `?token=…`).

**Step 2: open the tunnel URL on your PHONE on cellular data** (turn off WiFi
to make sure it's really going through the public internet, not your LAN).
Same dashboard, same flow.

**Step 3: send a prompt from the phone**. Watch your local terminal — you
should see logs of the request hitting your local server through the tunnel.

**Step 4: open the dashboard on the phone, then check `/connect-info`**:

```bash
# On your local machine, with the token from your banner:
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:4097/connect-info
```

You should see something like:

```json
{
  "lan": { "available": true, "url": "...", "ip": "192.168.1.42", "exposed": false },
  "tunnel": {
    "available": true,
    "provider": "cloudflared",
    "url": "https://abc-xyz-123.trycloudflare.com/?token=...",
    "status": "connected"
  },
  "local": { "url": "http://127.0.0.1:4097/?token=..." },
  "tokenPreview": "abcd...wxyz"
}
```

If `tunnel.status === "connected"` and there's a URL — green light.

### Verify in the dashboard

1. Open the dashboard (`http://127.0.0.1:4097`).
2. Click the phone icon in the header.
3. Switch to the "Public tunnel" tab.
4. You should see a QR code and the public URL.
5. Scan the QR with your phone — opens the tunnel URL with your token. Loads
   the same dashboard via the public internet.

### Common cloudflared problems

| Problem | Cause | Fix |
|---------|-------|-----|
| `cloudflared: command not found` | Not installed or not in PATH | Install per OS instructions above |
| Tunnel URL prints but page won't load | Local port not actually listening | Check `lsof -i :4097` shows your bun process |
| Tunnel works once, then breaks after a few minutes | cloudflared free tier rotates URLs | Restart OpenCode for a fresh URL, OR use `cloudflared tunnel` (named tunnels with `cloudflared login`) for stable URLs |
| 525/526 SSL error from Cloudflare | Your local server isn't doing HTTPS but tunnel expects it | Default config doesn't need this — if you customized, set tunnel to use HTTP origin |
| Page loads but immediately disconnects | SSE connection drops because of cloudflared idle timeout | Currently no fix in v1.11. Plugin auto-reconnects; user sees a brief "reconnecting…" indicator |

## Provider 2: ngrok

### Install ngrok

```bash
# macOS
brew install ngrok/ngrok/ngrok

# Linux
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && \
  echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list && \
  sudo apt update && sudo apt install ngrok

# Windows
winget install ngrok.ngrok
```

### Set up account

1. Sign up at https://ngrok.com (free)
2. Get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
3. Run once: `ngrok config add-authtoken YOUR_TOKEN`

### Configure opencode-pilot

```bash
PILOT_HOST=127.0.0.1
PILOT_PORT=4097
PILOT_TUNNEL=ngrok
```

### Start and test

Same flow as cloudflared. Banner shows `Tunnel URL: https://xxx.ngrok-free.app`.
Test from phone, verify `/connect-info`, scan QR.

### Common ngrok problems

| Problem | Cause | Fix |
|---------|-------|-----|
| Tunnel command authentication failed | Authtoken not set | `ngrok config add-authtoken YOUR_TOKEN` |
| Browser warning page on first visit | Free ngrok shows an interstitial | Click "Visit Site" — only on first request, doesn't affect subsequent |
| Rate limited (free tier) | 40 req/min on free | Upgrade to paid, or use cloudflared |
| URL changes on restart | Free tier doesn't have stable URLs | Upgrade to paid for `--subdomain` flag |

## Test checklist (run before recommending tunnels to users)

For EACH provider you want to support:

- [ ] Install completes without errors on a clean machine
- [ ] `cloudflared --version` / `ngrok --version` returns
- [ ] OpenCode starts with `PILOT_TUNNEL=…` set
- [ ] Banner shows tunnel URL
- [ ] `/connect-info` returns `tunnel.status === "connected"`
- [ ] Tunnel URL loads the dashboard in a browser on YOUR machine
- [ ] Tunnel URL loads the dashboard on your phone via cellular (NOT WiFi)
- [ ] Send a prompt from the phone — response streams live
- [ ] Permission requests on local actions trigger the prompt remotely
- [ ] SSE stays connected for >5 minutes during streaming
- [ ] Hard refresh on the phone reconnects without errors
- [ ] Restart OpenCode — phone reconnects to the new URL after rescan

## Security checklist (READ BEFORE using tunnels in production)

- [ ] Token is generated fresh on each plugin start. **Don't share screenshots
      that include the URL.** The URL contains the token.
- [ ] Default token rotation: generated once on plugin start. Rotate manually
      via `POST /auth/rotate` if you suspect the URL leaked.
- [ ] **Public tunnel = anyone with the URL can control your local OpenCode.**
      Treat the token as a password. Never paste in chat, screenshots, etc.
- [ ] No rate limiting yet (v1.11). Don't expose to untrusted networks for
      long durations. Stop the tunnel when you're done with a session.
- [ ] Permission requests: ALL tool executions still require approval through
      the dashboard. Even a malicious actor with the token can't auto-approve
      destructive ops without you tapping "Allow".

## Troubleshooting summary

If tunnels aren't working, check in this order:

1. **Is the local server up?** `curl http://127.0.0.1:4097/health` should return JSON.
2. **Is the tunnel binary installed?** `which cloudflared` or `which ngrok`.
3. **Is `PILOT_TUNNEL` set in `.env`?** And `.env` actually loaded? (Check
   plugin startup log for "Loaded .env from …".)
4. **Did the tunnel start?** Banner should print URL. If not, check the
   plugin log for tunnel-spawn errors.
5. **Can you reach the tunnel URL?** Try in browser, then phone WiFi, then
   phone cellular.
6. **Does `/connect-info` agree?** If `tunnel.status === "failed"`, the
   provider rejected the connection — check the provider's status page.

## When tunnels aren't appropriate

- You don't trust the tunnel provider (Cloudflare or ngrok) with metadata of
  your traffic
- You're on corporate network that blocks outbound 443
- You need stable URLs and don't want to pay (use a self-hosted
  reverse-proxy with Tailscale or similar instead)
- You're going to leave it on long-term — set up proper auth (passkeys are
  on the v1.7 roadmap; until then, rotate the token frequently)
