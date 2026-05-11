# Buzz App — Agent Guide

Real-time notification app: a browser client sends buzzes/messages to a Node.js server over Socket.IO. Intended as a local-network tool (phone pinging a desktop).

## Commands

```bash
npm run dev          # Start with --watch and auto-.env creation (recommended for development)
npm start            # Production start
npm test             # Run full test suite (vitest run)
npm run test:watch   # Watch mode
npm run test:coverage  # Coverage report (thresholds: 80% lines/functions/statements, 75% branches)
npm run lint         # ESLint 9 flat config
npm run format       # Prettier
```

**Windows**: double-click `start.bat` — checks Node version, installs deps on first run, then calls `npm run dev`.

## Environment Setup

`.env` is auto-created from `.env.example` by `scripts/preflight.js` (runs as `predev`/`prestart` hook). Do not edit `.env.example` as the authoritative template.

```
PORT=3000           # 1–65535
NODE_ENV=development | test | production
LOG_LEVEL=info      # fatal | error | warn | info | debug | trace | silent
CORS_ORIGIN=*       # restrict to e.g. http://192.168.1.50:3000 in production
```

Config is validated at startup via Zod (`src/config/index.js`). Bad env vars cause an immediate `process.exit(1)` with a clear field-level error message — this is intentional.

## Architecture

```
src/
  config/index.js       — Zod env validation; exports envSchema (testable) + config object
  lib/logger.js         — Pino logger (pino-pretty in dev only)
  middleware/
    errorHandler.js     — Express 4-arg error handler (err, req, res, _next)
  routes/
    health.js           — GET /api/health — no-store cache header
  handlers/
    socket.js           — All Socket.IO event logic + per-socket rate limiters
  server.js             — Bootstrap only: wires middleware, routes, socket handlers, graceful shutdown

public/
  index.html            — Single-page UI (vanilla HTML/CSS)
  client.js             — Browser Socket.IO client

tests/
  setup.js              — Sets NODE_ENV=test, LOG_LEVEL=silent before each file
  unit/                 — Pure unit tests (mock I/O)
  integration/          — Real TCP server on port :0; real socket.io-client

scripts/
  preflight.js          — Node built-ins only; safe to run before npm install
```

## Key Conventions

**ES Modules throughout** — `"type": "module"` in package.json. Use `import/export`, not `require`. Use `fileURLToPath(import.meta.url)` for `__dirname` equivalents.

**Zod validation order matters** — always `.trim().min(1).max(n)`, never `.min(1).max(n).trim()`. Trim is a transform; it runs after validators, so `.min(1)` before `.trim()` lets `'   '` (spaces) pass.

**Express error handler signature** — must be exactly `(err, req, res, _next)`. Swapping parameter names (e.g. `_res, next`) causes `TypeError: res.status is not a function` at runtime because `next` is not the response object.

**Logging** — never log raw user-supplied data. Log `typeof data` or field names only. Prevents log injection and avoids writing large payloads to the log stream.

**Per-socket rate limiting** — `makeRateLimiter()` in `socket.js` creates Map-based sliding-window limiters. Entries are removed on `disconnect` to prevent unbounded memory growth with connection churn. Current limits: 5 buzzes/10 s, 20 messages/5 s.

**Graceful shutdown** — `io.disconnectSockets(true)` must be called *before* `httpServer.close()`. Without it, active WebSocket connections keep the server alive indefinitely on SIGTERM.

## Socket Events

| Direction       | Event          | Payload                              |
|-----------------|----------------|--------------------------------------|
| client → server | `buzz-dad`     | *(none)*                             |
| client → server | `send-message`    | `{ text: string }` (1–500 chars, trimmed) |
| server → client | `ack`             | `{ type: 'buzz' | 'message' | 'error', message: string }` |
| server → client | `server-shutdown` | `{ message: string }` — emitted before `io.disconnectSockets()` during graceful shutdown |

`send-message` also accepts an optional acknowledgement callback `(response: { ok: boolean, error?: string }) => void`.

## HTTP Endpoints

- `GET /api/health` — `{ status, uptime, timestamp }` — `Cache-Control: no-store`
- `GET /` — serves `public/index.html`
- All HTTP routes: 100 req/15 min rate limit, 10 KB JSON body limit

## Testing Approach

- **Unit tests** use `vi.mock` + `vi.resetModules()` + dynamic imports for full isolation (especially config — avoids `process.exit` side effects).
- **Integration tests** bind to port `:0` (OS-assigned) to avoid port conflicts in CI. Each test gets a fresh server instance via `beforeEach`/`afterEach`.
- `vitest.config.js` sets `testTimeout: 10_000` — sufficient for real TCP socket setup without being slow in CI.
- `src/server.js` is excluded from coverage thresholds (bootstrap entry point; covered by integration tests but not isolatable).

## Security Notes

- CSP is disabled via `helmet({ contentSecurityPolicy: false })` — tighten for production deployments.
- `app.set('trust proxy', 1)` is commented out in `server.js` — uncomment when running behind nginx/Caddy so rate limiting uses the real client IP.
- `CORS_ORIGIN=*` is acceptable for local-network use only. Set a specific origin for any internet-facing deployment.
- CSS class injection in `client.js` is prevented by validating `type` against a `VALID_LOG_TYPES` Set before applying it as a class name.
