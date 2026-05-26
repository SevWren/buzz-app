# Architecture

## Overview

Buzz App is a Node.js server that bridges a mobile browser client (son's phone) and a desktop admin panel (Dad's computer) over WebSockets, on a local network. There is no cloud backend, no accounts, and no external dependencies beyond npm packages.

```
Son's phone (browser)                Dad's computer (browser)
      |                                       |
      |  WebSocket (Socket.IO)                |  WebSocket (Socket.IO)
      |                                       |
      +------------ Node.js server -----------+
                    |         |
              Pino logger   data/messages.jsonl
                              (append-only)
```

---

## Request Flow

### Inbound (son sends a message)

1. Browser emits a Socket.IO event (e.g. `send-message`, `buzz-dad`, `quick-need`)
2. `socket.js` handler validates rate limit; drops with `ack error` if exceeded
3. Handler validates payload with Zod schema; drops with `ack error` if invalid
4. `playAlert(type)` fires — plays an MP3 on the server machine (fire-and-forget)
5. `appendMessage(record)` writes to `data/messages.jsonl` (async, fire-and-forget)
6. `io.emit('incoming-message', msg)` broadcasts to **all** connected clients
7. `socket.emit('ack', ...)` sends confirmation back to sender only

### Outbound (Dad sends a reply)

1. Admin browser emits `send-reply { text }`
2. Handler checks `socket.data.isAdmin` — returns `ack error` if false
3. Rate limit check
4. Zod validation
5. `appendMessage` logs the reply with `direction: 'out'`
6. `io.emit('incoming-message', msg)` broadcasts reply to all clients (son sees it)
7. `socket.emit('ack', ...)` confirms to Dad

### Read receipts

1. Son's `client.js` receives `incoming-message` with `direction: 'out'`
2. Renders it in the conversation thread with a pending read-receipt indicator
3. When son's tab becomes visible, `client.js` emits `admin-mark-read`
4. Server broadcasts `messages-read { ts }` to all clients
5. Admin `admin.js` receives `messages-read` and updates all pending receipt spans to "Seen"

---

## Module Responsibilities

### `src/server.js`

Bootstrap only. Creates the Express app, HTTP server, and Socket.IO instance. Wires:
- Helmet, CORS, rate limiter, JSON body parser
- Static file serving (`public/`)
- Route handlers (`/api/health`, `/admin`)
- Socket.IO admin-auth middleware
- Socket event handlers via `registerSocketHandlers(io)`
- SIGTERM / SIGINT graceful shutdown

Does not contain business logic. Tests cover it via integration tests, not unit tests.

### `src/handlers/socket.js`

All Socket.IO event logic. Contains:
- Zod validation schemas for every event type
- `makeRateLimiter()` — Map-based sliding-window counter factory
- Per-event rate limiter instances (one per event type)
- `registerSocketHandlers(io)` — registers all `socket.on(...)` listeners
- `broadcastShutdown(io)` — called by server.js during graceful shutdown

### `src/lib/messageLog.js`

Persistence layer for the message log.
- `appendMessage(record)` — writes one JSON line to `data/messages.jsonl`; creates `data/` if missing; swallows errors
- `readRecentMessages(limit)` — reads the last `limit` lines, parses each, skips malformed, returns oldest-first; returns `[]` on any error

### `src/lib/audioAlert.js`

Thin wrapper around the `play-sound` npm package.
- `playAlert(type, subtype?)` — looks up the event type in `AUDIO_MAP`, resolves the MP3 path under `assets/`, calls `player.play(path, callback)`
- Errors (no player installed, file not found) are caught and logged — never thrown
- `reply` type is intentionally absent from `AUDIO_MAP` — no alert when Dad types

### `src/middleware/adminGuard.js`

Express middleware that enforces localhost-only access to `/admin` routes.
- Reads `req.ip`, strips IPv4-mapped prefix `::ffff:`
- Allows `127.0.0.1`, `::1`, `localhost`
- Returns `403` JSON for all other IPs

### `src/middleware/errorHandler.js`

Standard Express 4-argument error handler `(err, req, res, _next)`. Catches anything passed to `next(err)` and returns a JSON error response. Parameter order is fixed — Express identifies error handlers by arity.

### `src/routes/health.js`

Single endpoint: `GET /api/health`. Returns `{ status: 'ok', uptime, timestamp }` with `Cache-Control: no-store`.

### `src/routes/admin.js`

Two endpoints, both protected by `adminGuard`:
- `GET /admin` — serves `public/admin.html` via `res.sendFile`
- `GET /admin/history` — calls `readRecentMessages(100)` and returns `{ messages }` as JSON

### `src/config/index.js`

Zod schema over `process.env`. Exports:
- `envSchema` — the raw Zod schema (testable in isolation)
- `config` — the parsed and validated config object

If validation fails at startup, logs a field-level error and calls `process.exit(1)`.

### `public/matrix.js`

Matrix shutdown animation engine. Triggered by the `server-shutdown` Socket.IO event in `client.js`. Exports:
- `class MatrixRain` — canvas rain engine with DPR-aware sizing, 60-frame pre-warm, and frame-rate-independent `dt`-based animation loop
- `class GlitchSequencer` — 6-phase shutdown orchestrator (see `docs/matrix-shutdown.md` for full sequence timing)
- `function randChar()` — weighted character selection (50% Katakana, 20% Latin, 20% digits, 10% symbols)

Two canvas elements in `index.html`: `#matrix-rain-canvas` (rain layer, z-index 1000) and `#matrix-msg-canvas` (message layer, z-index 1001). SR live region: `#matrix-a11y`. `prefers-reduced-motion` is respected.

The admin panel (`admin.js`) has its own shutdown handler — no matrix animation on Dad's panel.

Debug hook: `window.__matrixTest()` available on localhost only (guarded at `client.js` lines 45–48). See `docs/matrix-shutdown.md`.

Security implications of `server.js` middleware choices: see [`docs/security.md`](security.md).

---

## Data Flow Diagram

```
phone browser
  |
  |-- buzz-dad -------->|
  |-- send-message ---->|  socket.js:
  |-- quick-need ------>|    1. rate limit check
  |-- set-status ------>|    2. Zod validation
  |-- location-ping --->|    3. playAlert()       --> OS audio player --> MP3 file
  |-- battery-low ----->|    4. appendMessage()   --> data/messages.jsonl
  |-- countdown-start ->|    5. io.emit()         --> all connected clients
  |                     |    6. socket.emit(ack)  --> sender only
  |<-- ack -------------|
  |<-- incoming-message-|
  |
  |-- admin-mark-read ->|    server broadcasts messages-read
  |<-- messages-read ---|
  |
admin browser
  |-- send-reply ------>|    admin-only; direction: 'out'
  |<-- ack -------------|
  |<-- incoming-message-|    broadcasts reply to all clients
```

---

## Concurrency Model

Node.js is single-threaded. All I/O is async (file writes, network). Key points:

- `appendMessage` is async but **not awaited** in socket handlers. A log write failure never blocks or errors a client response.
- `playAlert` is fire-and-forget — the callback from `player.play()` only logs errors.
- Rate limiter state is in-memory Maps — no shared state across worker processes. This app is not clustered; see [ADR-0003](adr/0003-map-based-sliding-window-rate-limiting.md) for the full rationale.

### Socket.IO configuration

Key non-default parameters set in `src/server.js`:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `transports` | `['websocket']` | Long-polling explicitly disabled. Reduces attack surface and eliminates polling overhead on LAN. Clients behind WebSocket-blocking proxies cannot connect — acceptable for home Wi-Fi. |
| `maxHttpBufferSize` | 4 KB | The largest valid payload (500-char message) is ~560 bytes. 4 KB gives generous headroom while preventing memory exhaustion from oversized payloads. Default is 1 MB. |
| `pingTimeout` | 5 s | Server waits 5 s for a ping response before declaring the connection dead. |
| `pingInterval` | 25 s | Keepalive ping sent every 25 s. |
| `upgradeTimeout` | 10 s | HTTP → WebSocket upgrade must complete within 10 s. |
| `cookie` | `false` | Session cookies disabled. Auth is IP-based, not session-based (see [ADR-0005](adr/0005-two-layer-admin-auth.md)). |

### Client reconnection

`public/client.js` configures Socket.IO client reconnection:
- `reconnectionAttempts: 10` — the client stops trying after 10 failed attempts. After this, the connection dot turns red and stays red. The user must refresh the page to reconnect.
- `reconnectionDelayMax: 10_000` ms — maximum 10 s between attempts (exponential backoff capped here).

Rate limit values for all socket events: see [`docs/security.md`](security.md#per-socket-rate-limiting) and [ADR-0003](adr/0003-map-based-sliding-window-rate-limiting.md).

---

## Memory Management

- Rate limiter Maps: entries are added on first event per socket, removed on `disconnect`. No unbounded growth.
- Admin panel `readReceiptMap`: cleared on `disconnect` and on `loadHistory()` (reconnect). No unbounded growth.
- Socket.IO `connectionStateRecovery.maxDisconnectionDuration` is capped at 30 s (default is 2 minutes) to limit event buffer size under connection churn.

---

## Startup Sequence

1. `scripts/preflight.js` runs (via `predev`/`prestart` npm hook) — creates `.env` from `.env.example` if missing
2. `src/config/index.js` validates environment — exits on failure
3. Express, HTTP server, Socket.IO instance created
4. Middleware stack wired
5. Routes registered
6. Socket.IO middleware and handlers registered
7. `httpServer.listen(port)` — server accepts connections
8. Pino logs: `Server started { port, env }`

---

## Shutdown Sequence

1. SIGTERM or SIGINT received
2. Guard against double-signal
3. `broadcastShutdown(io)` — emits `server-shutdown` to all connected clients
4. 300 ms delay — allows broadcast to reach LAN Wi-Fi clients
5. `io.disconnectSockets(true)` — closes all WebSocket connections
6. `httpServer.close(cb)` — stops accepting new connections; calls `cb` when drained
7. `process.exit(0)` — clean exit
8. Force-kill timeout at 10 s — `process.exit(1)` if `httpServer.close()` stalls (e.g. a keep-alive connection that does not drain). This ensures the process never hangs indefinitely.

The 300 ms delay in step 4 is intentional: it gives the `server-shutdown` broadcast time to reach LAN Wi-Fi clients before their sockets are forcibly closed. The phone client uses this event to trigger the matrix shutdown animation (see `docs/matrix-shutdown.md`) before the WebSocket drops.
