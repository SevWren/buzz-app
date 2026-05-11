# Buzz App

A real-time notification tool for your local network. Open the page on your phone, hit **Buzz Dad** or type a message — it pops up instantly on Dad's computer.

---

## Quick Start (the short version)

**Windows** — just double-click `start.bat`. Done. It handles everything.

**Mac / Linux:**

```bash
node -v          # must be v20.6 or higher — https://nodejs.org if not
npm install      # first time only
npm run dev      # starts the server
```

Then open **http://localhost:3000** in your browser.

To use it from your phone or another device on the same Wi-Fi, use the **Network** address printed in the terminal when the server starts — it looks like `http://192.168.x.x:3000`.

---

## First-Time Setup (step by step)

### 1. Install Node.js (if you haven't already)

Go to **https://nodejs.org** and download the **LTS** version. Run the installer and click through — defaults are fine.

To check it worked, open a terminal and run:

```
node -v
```

You should see something like `v22.x.x`. You need **v20.6 or higher**.

### 2. Get the app running

**Windows** — double-click `start.bat` in the project folder. It will:
- Check your Node.js version
- Install dependencies automatically on first run
- Start the server

**Mac** — open Terminal, navigate to the project folder, then:

```bash
npm install     # only needed once
npm run dev
```

**Linux** — same as Mac.

### 3. Open the app

Once the server is running, your terminal will show something like:

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

- Open the **Local** address on the computer running the server.
- Open the **Network** address on your phone or any other device on the same Wi-Fi.

### 4. Using the app

| What you want to do | How |
|---------------------|-----|
| Get Dad's attention | Click **Buzz Dad** |
| Send a message | Type in the box, then click **Send Message** or press **Enter** |
| See what happened | Check the **Event Log** at the bottom of the page |
| Clear the log | Click **Clear** |

The colored dot in the top-right corner shows your connection status:
- **Green** — connected and ready
- **Yellow (pulsing)** — reconnecting
- **Red** — disconnected (is the server still running?)

### 5. Stopping the server

Press **Ctrl+C** in the terminal window. The server will shut down cleanly.

---

## Troubleshooting

**"node is not recognized" / "command not found"**
Node.js is not installed or not on your PATH. Download it from https://nodejs.org and re-open your terminal after installing.

**Phone can't reach the Network address**
Both devices must be on the same Wi-Fi network. Check that your firewall isn't blocking port 3000.

**Port 3000 is already in use**
Edit `.env` (created automatically on first run) and change `PORT=3000` to any free port, e.g. `PORT=3001`.

**The server stopped unexpectedly**
Read the error output in the terminal — it will tell you what went wrong. Common cause: invalid `.env` values. Delete `.env` to regenerate it from defaults.

---

## Configuration

On first run, a `.env` file is created automatically from `.env.example`. You can edit it any time:

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `3000` | Port the server listens on |
| `NODE_ENV` | `development` | Runtime environment |
| `LOG_LEVEL` | `info` | Log verbosity (`debug` for more detail) |
| `CORS_ORIGIN` | `*` | Restrict to a specific origin for production use |

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
