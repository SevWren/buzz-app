# Buzz App

A real-time family messaging tool for your local network. Your son opens the page on his phone and can buzz you, send messages, share his location, set a status, and more — everything pops up instantly on your computer with an audio alert. You reply from the admin panel.

---

## Quick Start

**Windows** — double-click `start.bat`. Done. It handles everything.

**Mac / Linux:**

```bash
node -v          # must be v20.6 or higher — https://nodejs.org if not
npm install      # first time only
npm run dev      # starts the server
```

- **Son's phone** — open the Network address (`http://192.168.x.x:3000`)
- **Dad's admin panel** — open `http://localhost:3000/admin` on the server computer

---

## First-Time Setup

### 1. Install Node.js

Go to **https://nodejs.org** and download the **LTS** version. Run the installer — defaults are fine.

Verify:

```
node -v
```

You need **v20.6 or higher**.

### 2. Start the server

**Windows** — double-click `start.bat` in the project folder. It will:
- Check your Node.js version
- Install dependencies automatically on first run
- Start the server

**Mac / Linux:**

```bash
npm install     # only needed once
npm run dev
```

### 3. Open the app

Once running, the terminal shows:

```
  ──────────────────────────────────────────────
   Buzz App
  ──────────────────────────────────────────────
   Local    →  http://localhost:3000
   Network  →  http://192.168.1.42:3000   <- phone / other devices
  ──────────────────────────────────────────────
   Press Ctrl+C to stop
  ──────────────────────────────────────────────
```

- **Son's phone** — open the **Network** address on any device on the same Wi-Fi
- **Dad's admin panel** — open `http://localhost:3000/admin` in the browser on the server computer (localhost-only)

The colored dot in the top-right shows connection status:
- **Green** — connected and ready
- **Yellow (pulsing)** — reconnecting
- **Red** — disconnected

### 4. Stop the server

Press **Ctrl+C** in the terminal.

---

## What Son Can Do (phone interface)

| Action | How |
|--------|-----|
| Get Dad's attention | Tap **Buzz Dad** |
| Send a message | Type in the box, tap **Send** or press Enter |
| Quick needs | Tap one button: **Pickup**, **Food**, **Money**, **Call Me**, or **Help** |
| Set a status | Tap an emoji: Tired, Hungry, At School, Heading Home, All Good, Upset |
| Share location | Tap **Share My Location** (browser asks for permission first) |
| Battery warning | Tap **My Phone is Dying** |
| ETA countdown | Tap **5 min**, **10 min**, **15 min**, or **30 min** |
| See Dad's reply | Replies appear in the conversation thread at the bottom |

## What Dad Can Do (admin panel at `/admin`)

| Action | How |
|--------|-----|
| Read all messages | Full conversation thread loads on the page |
| Reply | Type in the reply box, press Enter or click **Send Reply** |
| Know when new messages arrive | Unread badge + tab title shows `(N) Buzz App — Admin` |
| Mark messages read | Happens automatically when the tab is visible / focused |
| See read receipts | Outbound replies show "Seen" when son views them |
| Load past history | Last 100 messages load automatically on page open |

---

## Server Shutdown Animation

When you shut down the server (Ctrl+C or service stop), the son's phone displays a cinematic Matrix-style shutdown animation — the app interface fades and is consumed by falling green characters, followed by three escalating messages. The final message persists permanently on screen until the page is refreshed. See `docs/matrix-shutdown.md` for full details.

---

## Persistent Message Log

Every event is permanently saved to `data/messages.jsonl`. Each line is a JSON record:

```json
{"id":"...","ts":"2025-01-01T12:00:00.000Z","direction":"in","type":"message","socketId":"...","payload":{"text":"Can I get a ride?"}}
```

The log is append-only and never deleted automatically.

---

## Audio Alerts

When a message or event arrives on the server, a distinct MP3 chime plays automatically. Different events play different chimes. No alert plays when Dad sends a reply (he is already at the keyboard).

The server needs a system audio player:
- **macOS** — `afplay` is built in, works automatically
- **Linux** — install `mpg123`: `sudo apt install mpg123`
- **Windows** — install `mplayer` and add it to your PATH

---

## Configuration

On first run, `.env` is created automatically from `.env.example`. Edit it any time:

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `3000` | Port the server listens on |
| `NODE_ENV` | `development` | Runtime environment |
| `LOG_LEVEL` | `info` | Log verbosity (`debug` for more detail) |
| `CORS_ORIGIN` | `*` | Restrict to a specific origin for production use |

---

## Troubleshooting

**"node is not recognized" / "command not found"**
Node.js is not installed or not on your PATH. Download from https://nodejs.org and re-open your terminal.

**Phone can't reach the Network address**
Both devices must be on the same Wi-Fi. Check that your firewall isn't blocking port 3000.

**Port 3000 already in use**
Edit `.env` and change `PORT=3000` to a free port, e.g. `PORT=3001`.

**No audio alerts**
See Audio Alerts section above — a system player must be installed.

**Admin panel shows 403**
The admin panel is only accessible from `localhost` (the machine running the server). It will refuse connections from any other IP by design.

**Server stopped unexpectedly**
Read the error in the terminal. Common cause: invalid `.env` value. Delete `.env` to regenerate from defaults.

---

## For Developers

```bash
npm test              # run the full test suite
npm run test:watch    # re-run tests on file changes
npm run test:coverage # coverage report (80% thresholds)
npm run lint          # ESLint
npm run format        # Prettier
```

**Stack:** Node.js 20+, Express 5, Socket.IO 4, Zod, Pino, Vitest.

See `CLAUDE.md` for architecture details, coding conventions, and agent guidance.
See `docs/` for full technical documentation.
See `docs/index.md` for the full documentation index.
See `CONTRIBUTING.md` for contribution guidelines and coding conventions.
