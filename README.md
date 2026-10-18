# Buzz App

A real-time notification tool for your local network. Open the page on your phone, hit **Buzz Dad** or type a message — it pops up instantly on Dad’s computer.

When the server is stopped (Ctrl+C, process manager, or any graceful shutdown), every connected browser client plays a full-screen Matrix-style disconnect sequence: cascading green characters, glitching status messages, and a permanent final screen.

---

## Quick Start

**Windows** — double-click `start.bat`. It checks Node.js, installs dependencies on first run, and starts the server.

**Mac / Linux:**

```bash
node -v          # must be v20.6 or higher
npm install      # first time only
npm run dev
```

Open **http://localhost:3000** on the machine running the server.  
On any other device on the same Wi-Fi, use the **Network** address printed in the terminal (e.g. `http://192.168.1.42:3000`).

---

## First-Time Setup

1. Install Node.js LTS from https://nodejs.org (v20.6 or higher required).
2. On Windows double-click `start.bat`. On Mac/Linux run `npm install` then `npm run dev`.
3. Open the Local address on the host machine and the Network address on phones or other devices.
4. Use the app:
   - **Buzz Dad** — immediate attention signal
   - Type a message and press Enter or click **Send Message**
   - Event Log shows every action and server acknowledgement
5. Stop the server with **Ctrl+C**. The Matrix disconnect sequence will play on every connected client.

Connection status indicator (top-right):
- Green — connected
- Yellow (pulsing) — reconnecting
- Red — disconnected

---

## Matrix Disconnect Experience

The Matrix sequence is a deliberate, multi-stage visual takeover that occurs when the server leaves the network. It is implemented entirely in the browser; the server only emits a single event.

### Server-side sequence

1. A shutdown signal is received (`SIGINT` from Ctrl+C or `SIGTERM`).
2. `broadcastShutdown(io)` is called. It emits one Socket.IO event to every connected client:

   ```js
   io.emit('server-shutdown', {
     message: 'Server is shutting down. Connection will be lost.'
   });
   ```

3. The server waits **exactly 300 ms**. This window exists so the event can reach clients over a typical LAN (including Wi-Fi) before the transport is destroyed.
4. `io.disconnectSockets(true)` is called, forcibly closing every WebSocket.
5. The HTTP server is closed and the process exits.
6. A 10-second safety timer force-kills the process if graceful shutdown stalls.

**Ordering is critical.** The `server-shutdown` emit must occur before `io.disconnectSockets()`. Once sockets are closed the packet can never be delivered.

### Client-side sequence

Two independent paths exist in `public/client.js`.

#### Explicit server shutdown (`server-shutdown` event)

1. The client receives the event.
2. The full-viewport overlay `#matrix-scene` is activated.
3. `GlitchSequencer.trigger()` is called with `forceAnimation: true`.  
   This flag **overrides** the user’s `prefers-reduced-motion` setting. A deliberate server shutdown is treated as a critical state that must be shown in full.
4. A 2500 ms watchdog runs. If neither canvas has become visible by that time, a static fallback is drawn so the user still sees the three status messages.

#### Unexpected disconnection (`disconnect` event)

1. The client receives a Socket.IO `disconnect` event.
2. If the reason is `'io client disconnect'` (the client closed itself), the Matrix sequence is skipped.
3. For every other reason a 1200 ms timer is started.
4. After 1200 ms the client checks whether the socket is still disconnected. Only a sustained disconnection triggers the Matrix sequence, and it does so with `forceAnimation: false` (respecting reduced-motion preferences).

The 1200 ms delay prevents the animation from appearing during brief, recoverable reconnection attempts.

### Visual architecture (`public/matrix.js` + `public/index.html`)

The takeover uses two stacked full-viewport canvases inside `#matrix-scene`:

- `#matrix-rain-canvas` — opaque black, z-index 1000, draws the continuous falling character rain.
- `#matrix-msg-canvas` — transparent, z-index 1001, draws the three glitching status messages.

An ARIA live region (`#matrix-a11y`, `aria-live="assertive"`) receives the plain-text content of each message for screen readers.

The rain engine (`MatrixRain`) produces columns of characters with the exact distribution:

- 50 % half-width Katakana
- 20 % Latin uppercase
- 20 % digits
- 10 % symbols

Streams are full-viewport height plus a small random extra so the screen never shows empty columns. Heads glow; trails decay with a frame-rate-independent alpha. Random glow spikes occur approximately every 40–60 frames. When a message is on screen the rain heads brighten as they pass through the message zone, creating a visible interaction between the two layers.

The sequencer (`GlitchSequencer`) runs six phases:

1. Pre-warm — 60 simulated frames of rain so trails already exist when the canvases fade in.
2. Fade-in of both canvases and application of the `matrix-corrupting` class to the normal UI.
3. First message **CONNECTION LOST** — characters assemble from the centre outward with a white flash, hold, then fall from the edges inward.
4. Second message **SERVER SHUTTING DOWN....** — same treatment.
5. Final message **THE SERVER HAS GONE OFFLINE.** — assembles, holds permanently, and continues micro-glitching indefinitely.
6. The rain continues to run behind the final message for the remainder of the session.

All font, sizing, glow, timing, and reduced-motion logic lives inside `matrix.js`. The client only decides *when* to call `trigger()` and whether to force the animation.

A local copy of Share Tech Mono (`public/fonts/ShareTechMono-Regular.woff2`) is loaded via `@font-face` so the effect works completely offline on a LAN with no external CDN.

### Debug helper

```js
window.__matrixTest()                  // full forced sequence
window.__matrixTest('Custom message')  // same with a custom final line
```

Available on any origin (localhost or LAN IP). Always forces the full animation.

### Accessibility

- Screen-reader live region announces every message phase.
- When `prefers-reduced-motion: reduce` is active *and* `forceAnimation` is false, a static three-line text fallback is drawn.
- Explicit server shutdowns intentionally override the reduced-motion preference.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `node` not found | Install Node.js LTS from https://nodejs.org and reopen the terminal |
| Phone cannot reach Network address | Both devices must be on the same Wi-Fi; check firewall for port 3000 |
| Port already in use | Edit `.env` and change `PORT` |
| Server exits immediately | Delete `.env` so it regenerates from `.env.example` |
| Matrix sequence never appears | Confirm the browser receives the `server-shutdown` event. External force-kills that skip the 300 ms broadcast window will prevent the packet from arriving |

---

## Configuration

On first run a `.env` file is created from `.env.example`. Editable values:

| Variable     | Default       | Purpose                                      |
|--------------|---------------|----------------------------------------------|
| `PORT`       | `3000`        | TCP port the server listens on               |
| `NODE_ENV`   | `development` | Runtime environment                          |
| `LOG_LEVEL`  | `info`        | Pino log level                               |
| `CORS_ORIGIN`| `*`           | Restrict cross-origin access in production   |

---

## Developer Commands

```bash
npm test              # full Vitest suite
npm run test:watch    # re-run on change
npm run test:coverage # coverage (80 % lines/functions/statements, 75 % branches)
npm run lint          # ESLint 9
npm run format        # Prettier
```

**Stack:** Node.js 20+, Express 5, Socket.IO 4, Zod, Pino, Vitest.

Architecture notes, coding conventions, and agent guidance are in `CLAUDE.md`.

The Matrix implementation is entirely client-side (`public/matrix.js` + the two canvases and live region in `public/index.html`). The server’s only responsibility is to emit the `server-shutdown` event before tearing down sockets.
