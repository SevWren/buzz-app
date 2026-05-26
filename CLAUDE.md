# Buzz App — Agent Guide

Real-time family messaging app: a browser client on a phone sends buzzes, messages, location pings, status updates, and more to a Node.js server over Socket.IO. Dad replies from a localhost-only admin panel. All messages are permanently logged. Intended as a local-network tool.

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

`.env` is auto-created from `.env.example` by `scripts/preflight.js` (runs as `predev`/`prestart` hook). Do not edit `.env.example` — it is the authoritative template.

```
PORT=3000           # 1-65535
NODE_ENV=development | test | production
LOG_LEVEL=info      # fatal | error | warn | info | debug | trace | silent
CORS_ORIGIN=*       # restrict to e.g. http://192.168.1.50:3000 in production
```

Config is validated at startup via Zod (`src/config/index.js`). Bad env vars cause an immediate `process.exit(1)` with a clear field-level error — intentional.

## Architecture

```
src/
  config/index.js         -- Zod env validation; exports envSchema (testable) + config object
  lib/
    logger.js             -- Pino logger (pino-pretty in dev only)
    messageLog.js         -- appendMessage() + readRecentMessages(); writes data/messages.jsonl
    audioAlert.js         -- playAlert(type, subtype?); wraps play-sound; never throws
  middleware/
    errorHandler.js       -- Express 4-arg error handler (err, req, res, _next)
    adminGuard.js         -- Allows only localhost IPs; returns 403 otherwise
  routes/
    health.js             -- GET /api/health -- no-store cache header
    admin.js              -- GET /admin (serves admin.html) + GET /admin/history (last 100 msgs)
  handlers/
    socket.js             -- All Socket.IO event logic + per-socket rate limiters
  server.js               -- Bootstrap only: wires middleware, routes, socket handlers, graceful shutdown

public/
  index.html              -- Son's single-page UI (vanilla HTML/CSS, mobile-first)
  client.js               -- Son's Socket.IO browser client
  admin.html              -- Dad's admin panel HTML/CSS
  admin.js                -- Dad's admin panel browser client (ES module)
  matrix.js               -- Matrix rain animation (cosmetic only)

data/
  messages.jsonl          -- Append-only persistent message log (auto-created; not in git)

assets/
  buzz_chat_1.mp3         -- Audio alert files (6 total: buzz_chat_1 through buzz_chat_6)
  buzz_chat_2.mp3
  buzz_chat_3.mp3
  buzz_chat_4.mp3
  buzz_chat_5.mp3
  buzz_chat_6.mp3

tests/
  setup.js                -- Sets NODE_ENV=test, LOG_LEVEL=silent before each file
  unit/                   -- Pure unit tests (mock I/O)
    socket.handlers.test.js
    messageLog.test.js
    audioAlert.test.js
    adminGuard.test.js
    admin.route.test.js
    config.test.js
    errorHandler.test.js
    health.route.test.js
  integration/            -- Real TCP server on port :0; real socket.io-client
    http.test.js
    socket.test.js

scripts/
  preflight.js            -- Node built-ins only; safe to run before npm install
```

## Key Conventions

**ES Modules throughout** -- `"type": "module"` in package.json. Use `import/export`, not `require`. Use `fileURLToPath(import.meta.url)` for `__dirname` equivalents.

**Zod validation order matters** -- always `.trim().min(1).max(n)`, never `.min(1).max(n).trim()`. Trim is a transform that runs after validators; putting `.min(1)` before `.trim()` lets `'   '` (spaces-only) pass the length check.

**Express error handler signature** -- must be exactly `(err, req, res, _next)`. Swapping names (e.g. `_res, next`) causes `TypeError: res.status is not a function` at runtime.

**Logging** -- never log raw user-supplied data. Log `typeof data` or field names only. Prevents log injection and avoids writing large payloads to the log stream.

**audioAlert is fire-and-forget** -- `playAlert()` is synchronous from the caller's perspective; errors are caught internally and logged. Never await it or expect it to throw.

**messageLog is async but fire-and-forget in socket handlers** -- `appendMessage()` returns a Promise but socket handlers do not await it. Persistence failures are logged but never surface as errors to the client. This is intentional — a log failure must not crash the server or reject a client message.

**Per-socket rate limiting** -- `makeRateLimiter()` in `socket.js` creates Map-based sliding-window counters. Entries are removed on `disconnect` to prevent unbounded memory growth. Limits:

| Event | Window | Max |
|-------|--------|-----|
| buzz-dad | 10 s | 5 |
| send-message | 5 s | 20 |
| quick-need | 10 s | 10 |
| set-status | 10 s | 5 |
| location-ping | 30 s | 3 |
| battery-low | 60 s | 2 |
| countdown-start | 10 s | 5 |
| send-reply | 5 s | 20 |

**Graceful shutdown** -- `broadcastShutdown(io)` fires first, then a 300 ms delay, then `io.disconnectSockets(true)`, then `httpServer.close()`. Order is critical: emitting after sockets are closed means the packet never reaches clients.

**Admin auth -- two layers:**
1. HTTP: `adminGuard` middleware checks `req.ip` and returns 403 for non-localhost
2. Socket.IO: `io.use()` middleware sets `socket.data.isAdmin` based on `socket.handshake.address`. The `send-reply` and `admin-mark-read` handlers check this flag and emit `ack error` if false.

## Socket Events

### Client to server (son's phone)

| Event | Payload | Rate limit | Notes |
|-------|---------|------------|-------|
| `buzz-dad` | *(none)* | 5/10s | Plays buzz_chat_1.mp3 |
| `send-message` | `{ text: string }` 1-500 chars | 20/5s | Plays buzz_chat_1.mp3 |
| `quick-need` | `{ need: 'Pickup'|'Food'|'Money'|'Call Me'|'Help' }` | 10/10s | Per-need MP3 mapping |
| `set-status` | `{ emoji: string, label: string }` | 5/10s | Plays buzz_chat_6.mp3 |
| `location-ping` | `{ lat: number, lng: number, accuracy: number }` | 3/30s | Plays buzz_chat_3.mp3 |
| `battery-low` | `{ level: number|null }` 0-1 | 2/60s | Plays buzz_chat_5.mp3 |
| `countdown-start` | `{ minutes: 5|10|15|30 }` | 5/10s | Plays buzz_chat_6.mp3 |

### Client to server (admin panel -- localhost only)

| Event | Payload | Notes |
|-------|---------|-------|
| `send-reply` | `{ text: string }` 1-500 chars | Requires `socket.data.isAdmin`; no audio |
| `admin-mark-read` | *(none)* | Requires `socket.data.isAdmin`; broadcasts `messages-read` to all clients |

### Server to all clients

| Event | Payload | When |
|-------|---------|------|
| `incoming-message` | `{ id, ts, direction, type, payload }` | Any inbound event or reply |
| `messages-read` | `{ ts }` | Admin marks messages read |
| `server-shutdown` | `{ message }` | Before graceful shutdown |

### Server to sender only

| Event | Payload | When |
|-------|---------|------|
| `ack` | `{ type, message }` | After every handled event |

All socket events that accept data also accept an optional acknowledgement callback `(response: { ok: boolean, error?: string }) => void`.

## HTTP Endpoints

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/` | none | `public/index.html` |
| GET | `/api/health` | none | `{ status, uptime, timestamp }` |
| GET | `/admin` | localhost only | `public/admin.html` |
| GET | `/admin/history` | localhost only | `{ messages: object[] }` (last 100) |

All HTTP routes: 100 req/15 min rate limit, 10 KB JSON body limit.

## Message Log Format

Each record in `data/messages.jsonl` is a JSON object on one line:

```json
{
  "id": "uuid-v4",
  "ts": "ISO-8601",
  "direction": "in" | "out",
  "type": "buzz" | "message" | "quick-need" | "status" | "location" | "battery-low" | "countdown" | "reply",
  "socketId": "socket.io-socket-id",
  "payload": {}
}
```

`readRecentMessages(limit)` returns the last `limit` lines, oldest-first, skipping malformed lines. Returns `[]` on any error (including ENOENT).

## Testing Approach

- **Unit tests** use `vi.mock` + `vi.resetModules()` + dynamic imports for full isolation (especially config — avoids `process.exit` side effects).
- **Integration tests** bind to port `:0` (OS-assigned) to avoid port conflicts in CI. Each test gets a fresh server via `beforeEach`/`afterEach`.
- `vitest.config.js` sets `testTimeout: 10_000` — enough for real TCP socket setup without being slow.
- `src/server.js` is excluded from coverage thresholds (bootstrap; covered by integration tests but not isolatable).
- New modules (`messageLog`, `audioAlert`, `adminGuard`, `admin.route`) each have dedicated unit test files.
- **314 tests** across 10 files. Current coverage: ~96% statements, ~85% branches, ~92% functions.
- **Hardening notes:**
  - `errorHandler` status sanitization: only `Number.isInteger(raw) && raw >= 400 && raw <= 599` is valid — NaN/strings/out-of-range all fall back to 500.
  - `appendMessage` is fire-and-forget in socket handlers — rejections are caught internally, never surfaced to the client.
  - `readRecentMessages(0)` returns `[]` — guarded by `if (limit === 0) return []` (previously `slice(-0)` returned all records; fixed in audit BUG-03).
  - `adminGuard` uses exact string comparison after stripping `::ffff:` — whitespace in IP strings blocks access.
  - `AUDIO_MAP` has no top-level `'quick-need'` key — only `'quick-need:Subtype'` entries. `playAlert('quick-need', null)` is silent.
  - `CORS_ORIGIN` schema has no `.trim()` but whitespace-only values are still rejected by the `.refine()` regex (must be `'*'` or a valid `http/https` origin). The missing `.trim()` is intentional — trimming a URI value could mask a misconfiguration.

## Security Notes

- CSP is enabled with a scoped policy (`defaultSrc 'self'`, `scriptSrc 'self'`, `styleSrc 'self' 'unsafe-inline'`, `connectSrc 'self'`, `frameAncestors 'none'`). The old `contentSecurityPolicy: false` comment is no longer accurate.
- `app.set('trust proxy', 1)` is commented out — uncomment when behind nginx/Caddy so rate limiting uses the real client IP.
- `CORS_ORIGIN=*` is acceptable for local-network use only.
- `textContent` is used exclusively for rendering user data in both `client.js` and `admin.js` — no `innerHTML` on untrusted data.
- CSS class injection is prevented in `client.js` by validating `type` against a `VALID_LOG_TYPES` Set before applying as a class name.
- Admin access uses two independent checks (HTTP middleware + Socket.IO middleware) so neither can be bypassed independently.
- `data/messages.jsonl` is in `.gitignore` — never committed.

## Agent Skills Setup

All agent skills are mirrored in `.claude/skills/`. After cloning, install them so your AI agent can invoke them directly:

```bash
# Install all skills in one pass
npx skills add wshobson/agents@architecture-decision-records
npx skills add anthropics/knowledge-work-plugins@tech-debt
npx skills add aj-geddes/useful-ai-prompts@nodejs-express-server
npx skills add nickcrew/claude-ctx-plugin@doc-maintenance
npx skills add patricio0312rev/skills@eslint-prettier-config
npx skills add aj-geddes/useful-ai-prompts@real-time-features
npx skills add mcollina/skills@node
npx skills add mindrally/skills@zod-schema-validation
npx skills add aj-geddes/useful-ai-prompts@rate-limiting-implementation
npx skills add onewave-ai/claude-skills@dependency-auditor
npx skills add block/agent-skills@code-review
npx skills add https://github.com/mattpocock/skills --skill grill-me
npx skills add https://github.com/pbakaus/impeccable --skill impeccable
```

### Skill Reference

| Skill | Category | Purpose |
|-------|----------|---------|
| `architecture-decision-records` | Project health | Document architectural decisions (why Socket.IO, why JSONL, etc.) |
| `tech-debt` | Project health | Identify and prioritize technical debt |
| `doc-maintenance` | Project health | Keep docs fresh and in sync with code changes |
| `code-review` | Project health | Structured code review for security-sensitive PRs |
| `dependency-auditor` | Project health | Audit npm deps for vulnerabilities and staleness |
| `nodejs-express-server` | Runtime | Express 5 patterns and best practices |
| `node` | Runtime | Advanced Node.js patterns (by Matteo Collina, Node core contributor) |
| `real-time-features` | Runtime | Socket.IO and WebSocket implementation patterns |
| `zod-schema-validation` | Runtime | Advanced Zod validation patterns (used throughout `src/handlers/socket.js`) |
| `rate-limiting-implementation` | Runtime | Rate limiting patterns (used in both HTTP and Socket.IO layers) |
| `eslint-prettier-config` | Tooling | ESLint 9 flat config and Prettier setup |
| `grill-me` | Tooling | Stress-test your own assumptions and design decisions |
| `impeccable` | Tooling | Frontend UI review, critique, audit, and polish (`/impeccable clarify`, `/impeccable audit`, `/impeccable critique`) |

> **Note:** `impeccable` covers `clarify`, `audit`, and `critique` as sub-commands of a single skill — invoke them as `/impeccable clarify`, `/impeccable audit`, or `/impeccable critique`.
