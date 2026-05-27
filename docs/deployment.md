# Deployment

## Local Network (Home Use)

This is the intended deployment target. The server runs on a desktop or laptop; the phone connects over Wi-Fi.

### Prerequisites

- Node.js v20.6 or higher (`node -v` to check)
- npm (comes with Node.js)
- A system audio player (see Audio Alerts section below)

### Steps

1. Clone or download the project to a folder on your desktop/laptop.

2. **Windows** — double-click `start.bat`. Done.

   **Mac / Linux:**
   ```bash
   npm install   # first time only
   npm run dev
   ```

3. The terminal prints a Network address like `http://192.168.1.42:3000`. Open that on the phone's browser.

4. Open `http://localhost:3000/admin` in a browser on the server machine.

### Keeping it running

`npm run dev` uses `--watch` mode and restarts on file changes. For always-on use, use `npm start` instead (no watch, no restart on changes).

To keep the server running in the background on Windows, use [NSSM](https://nssm.cc/) or a Scheduled Task. On Mac/Linux, use a systemd service or PM2.

---

## Environment Variables

`.env` is created automatically on first run from `.env.example`. Edit it to change defaults:

```env
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=*
```

| Variable | Valid values | Notes |
|----------|-------------|-------|
| `PORT` | 1–65535 | Default 3000. Change if port is in use |
| `NODE_ENV` | `development`, `test`, `production` | Use `production` for always-on installs |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | `info` is recommended; `debug` adds verbose output |
| `CORS_ORIGIN` | URL string or `*` | `*` is fine for home use; restrict for internet-facing. Must match `^https?://[^/]+$` (scheme + host, no trailing slash). |
| `MAX_SOCKET_CONNECTIONS` | 1–1000 | Default 50. Maximum simultaneous Socket.IO connections. Prevents per-socket rate limits from being bypassed by opening many sockets simultaneously. |

If any variable fails Zod validation, the server logs an error and exits immediately with code 1.

---

## Audio Alerts

The server plays MP3 files via the `play-sound` npm package, which delegates to a system audio player. Install the appropriate one for your OS:

**macOS**
`afplay` is built in. No installation needed.

**Linux**
```bash
sudo apt install mpg123      # Debian / Ubuntu
sudo yum install mpg123      # Fedora / RHEL
```
Alternatives: `aplay`, `mplayer`, `vlc`.

**Windows**
Install [mplayer for Windows](http://www.mplayerhq.hu/design7/dload.html) and add it to your system PATH, or install via a package manager like Chocolatey:
```
choco install mplayer
```

If no player is found, the server logs a warning but continues running — all messaging features work; only audio alerts are silent.

---

## Data Directory

The persistent message log is stored at `data/messages.jsonl` inside the project folder. This directory is created automatically on first message received.

- The file is **not** committed to git (it is in `.gitignore`)
- It is never deleted or rotated automatically
- Back it up manually or set up a cron job to archive it periodically

To clear the log, delete `data/messages.jsonl`. The server creates a new empty file on the next message.

### Data retention

The server auto-rotates `messages.jsonl` at 10 MB — it is renamed to `messages.jsonl.1` and a fresh log is started automatically (`maybeRotate()` in `src/lib/messageLog.js`). One archive is kept. For longer retention or multi-archive policies, configure external rotation:

**Linux (logrotate):**
```
/path/to/buzz-app/data/messages.jsonl {
    weekly
    rotate 4
    copytruncate
    compress
    missingok
}
```

**Any OS (cron/scheduled task):**
```bash
# Archive monthly (run via cron or Task Scheduler)
cp data/messages.jsonl "data/messages-$(date +%Y-%m).jsonl"
truncate -s 0 data/messages.jsonl
```

See [docs/security.md](security.md) for privacy considerations around the log contents.

---

## Running as a Production Service

### Using PM2 (Mac / Linux / Windows)

```bash
npm install -g pm2
pm2 start "npm start" --name buzz-app
pm2 save
pm2 startup   # follow the printed command to enable auto-start on boot
```

Useful PM2 commands:
```bash
pm2 status           # show running processes
pm2 logs buzz-app    # tail logs
pm2 restart buzz-app # restart after config change
pm2 stop buzz-app    # stop
```

### Using systemd (Linux)

Create `/etc/systemd/system/buzz-app.service`:

```ini
[Unit]
Description=Buzz App
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/buzz-app
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=LOG_LEVEL=info
Environment=CORS_ORIGIN=*

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable buzz-app
sudo systemctl start buzz-app
sudo systemctl status buzz-app
```

### Using NSSM (Windows)

```
nssm install buzz-app "C:\Program Files\nodejs\node.exe" "src/server.js"
nssm set buzz-app AppDirectory "C:\path\to\buzz-app"
nssm set buzz-app AppEnvironmentExtra NODE_ENV=production PORT=3000
nssm start buzz-app
```

---

## Changing the Port

Edit `.env`:
```
PORT=8080
```

Restart the server. The phone must connect to the new port: `http://192.168.1.42:8080`.

---

## Running Behind a Reverse Proxy

If you put nginx or Caddy in front of the app (e.g. for HTTPS termination):

1. In `src/server.js`, find the commented `trust proxy` line (line 72) and uncomment it:
   ```js
   app.set('trust proxy', 1);
   ```
   This makes `express-rate-limit` use the real client IP from `X-Forwarded-For`.

2. Configure WebSocket proxying. Example nginx snippet:
   ```nginx
   location / {
     proxy_pass http://localhost:3000;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
     proxy_set_header X-Real-IP $remote_addr;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

3. Set `CORS_ORIGIN` to your domain or IP in `.env`.

For additional production hardening steps, see [docs/security.md](security.md#production-hardening).

---

## Health Monitoring

The `/api/health` endpoint is suitable for uptime monitors and load balancer health checks:

```
GET http://localhost:3000/api/health
→ { "status": "ok", "uptime": 42, "timestamp": "2025-01-01T12:00:00.000Z" }
```

Response is always `200 OK` with `Cache-Control: no-store` if the server is up. Use this endpoint for PM2 health checks or external monitoring services.

---

## Upgrading

1. Pull the latest changes:
   ```bash
   git pull origin main
   ```

2. Install any new dependencies:
   ```bash
   npm install
   ```

3. Restart the server.

`data/messages.jsonl` is preserved across upgrades — it is never touched by the update process.

---

## Troubleshooting Deployment

**Server exits immediately with "Config validation error"**
Check your `.env` file. Delete it to regenerate from defaults: `rm .env` then restart.

**Port already in use**
```bash
# Find what is using port 3000
lsof -i :3000       # Mac / Linux
netstat -ano | findstr :3000   # Windows
```
Change `PORT` in `.env` or stop the conflicting process.

**Phone cannot connect**
- Verify both devices are on the same Wi-Fi network
- Check the server machine's firewall allows port 3000 inbound
- Use the exact IP printed in the terminal — do not use `localhost` from the phone

**Admin panel returns 403 from the server machine**
- Ensure you are accessing `http://localhost:3000/admin` — not the LAN IP
- If behind a reverse proxy, `req.ip` may show the proxy IP; see "Running Behind a Reverse Proxy"

**No audio**
- Test the audio player manually: `afplay /path/to/buzz_chat_1.mp3` (macOS) or `mpg123 /path/to/buzz_chat_1.mp3` (Linux)
- The `assets/` folder must contain the MP3 files — verify with `ls assets/`
