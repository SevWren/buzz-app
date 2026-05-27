# Testing

## Test Stack

- **Vitest** — test runner, assertion library, and mocking framework
- **@vitest/coverage-v8** — code coverage via V8
- **socket.io-client** — real WebSocket client for integration tests

---

## Running Tests

```bash
npm test              # run all tests once
npm run test:watch    # re-run on file changes
npm run test:coverage # run with coverage report
```

Coverage thresholds (enforced — CI will fail if below):
- Lines: 80%
- Functions: 80%
- Statements: 80%
- Branches: 75%

`src/server.js` is excluded from coverage thresholds — it is a bootstrap entry point that wires everything together. It is covered by integration tests but cannot be isolated for unit testing without significant complexity.

---

## Test Structure

```
tests/
  setup.js                       -- Global setup: sets NODE_ENV=test, LOG_LEVEL=silent
  unit/
    socket.handlers.test.js      -- Socket.IO event handlers (all 9 events)
    messageLog.test.js           -- appendMessage and readRecentMessages
    audioAlert.test.js           -- playAlert
    adminGuard.test.js           -- adminGuard middleware
    admin.route.test.js          -- GET /admin and GET /admin/history
    config.test.js               -- Zod env schema validation
    errorHandler.test.js         -- Express error handler
    health.route.test.js         -- GET /api/health
  integration/
    http.test.js                 -- Real HTTP server: health, static files, rate limiting
    socket.test.js               -- Real WebSocket connections: events, auth, broadcasts
```

---

## Unit Tests

Unit tests isolate each module completely. No real files are written, no real audio plays, and no real network sockets are opened.

### Mocking strategy

**`vi.mock` + `vi.resetModules()` + dynamic import** is the pattern used for modules that have side effects at import time (particularly `src/config/index.js`, which calls `process.exit(1)` on bad env vars).

Example pattern:
```js
beforeEach(async () => {
  vi.resetModules();
  vi.mock('../../../src/lib/messageLog.js', () => ({
    appendMessage: vi.fn().mockResolvedValue(undefined),
  }));
  vi.mock('../../../src/lib/audioAlert.js', () => ({
    playAlert: vi.fn(),
  }));
  // Dynamic import AFTER mocks are set up
  const mod = await import('../../../src/handlers/socket.js');
  registerSocketHandlers = mod.registerSocketHandlers;
});
```

This pattern ensures:
- Each test file gets a fresh module registry (no cross-test contamination)
- Mocked modules are in place before the module under test is evaluated
- `process.exit` side effects from config validation never fire in unit tests

### `socket.handlers.test.js`

Tests every Socket.IO event handler in isolation using a mock `io` and mock `socket` object. Covers:
- Happy path: valid payload, correct `io.emit` and `socket.emit` calls, log and audio called
- Rate limit: second call within window is rejected with `ack error`
- Validation: invalid payload shapes are rejected with descriptive error
- Auth: `send-reply` and `admin-mark-read` check `socket.data.isAdmin`
- Disconnect cleanup: all rate limiter entries removed
- Exact coordinate boundaries: `lat=±90`, `lng=±180`, `accuracy=0` accepted; values just over rejected
- Battery level boundaries: `level=0` and `level=1` accepted; out-of-range rejected
- Falsy `isAdmin` variants: `undefined`, `null`, and `0` all correctly trigger Unauthorized
- `appendMessage` fire-and-forget: rejection does not surface as an error to the client
- Broadcast payload shape: `incoming-message` events include exact `id`, `direction`, `type`, `payload` fields
- Schema independence: `set-status` validates emoji and label as separate enums (cross-pairing documented)

### `messageLog.test.js`

Tests `appendMessage` and `readRecentMessages` using mocked `fs/promises`.
- `appendMessage`: creates `data/` dir if missing, writes valid JSON lines, swallows all errors gracefully (including `mkdir` failures), preserves unicode, writes `utf8` encoding
- `readRecentMessages`: returns `[]` for ENOENT and all other read errors (non-ENOENT logged with `warn`), parses lines correctly, skips malformed lines, respects the `limit` parameter
- Edge cases: `limit=0` returns `[]` — guarded by `if (limit === 0) return []` (BUG-03 fix; the pre-fix `slice(-0) === slice(0)` behaviour is no longer present), `limit > total` returns all lines
- **Malformed lines are silently skipped.** `readRecentMessages` catches `JSON.parse` exceptions per-line. A corrupted or manually edited `data/messages.jsonl` will omit the bad lines without raising an error. Only lines with all required fields (`id`, `ts`, `direction`, `type`, `socketId`, `payload`) are returned.

### `audioAlert.test.js`

Mocks `play-sound` to verify:
- Correct MP3 file selected for each event type and subtype, including the `assets/` directory segment in the path
- `player.play()` called with the right path
- Errors from `player.play()` are caught and logged, never thrown
- `reply` type is silent (no `player.play()` call)
- Unknown types, `null`, `undefined`, and empty-string types are silent
- Wrong-case types (e.g. `'Buzz'`) are silent — AUDIO_MAP keys are lowercase
- `quick-need` with invalid or missing subtype is silent — no top-level `quick-need` key exists in AUDIO_MAP

### `adminGuard.test.js`

Tests the middleware with various `req.ip` values:
- `127.0.0.1`, `::1`, `::ffff:127.0.0.1` — allowed
- `192.168.1.50`, `10.0.0.1`, `::ffff:10.0.0.1` — 403
- Both `req.ip` and `req.socket` undefined — 403 (falls back to `''`)
- Leading/trailing whitespace in IP string — 403 (exact string comparison)
- Logger message and error body asserted to exact values from source

### `admin.route.test.js`

Tests both admin endpoints:
- `GET /admin` from localhost — sends `admin.html`
- `GET /admin/history` from localhost — returns `{ messages: [] }` or full message objects
- Response message objects validated against complete schema (all fields, not just `id`)
- `readRecentMessages` called exactly once with argument `100`
- Error propagation: `readRecentMessages` rejection → 500

### `config.test.js`

Tests `envSchema` directly (not the exported `config` object, which triggers `process.exit` on failure). Covers:
- Valid env vars and defaults
- Out-of-range and non-integer PORT values (including floats like `'1.5'`)
- Invalid `NODE_ENV` and `LOG_LEVEL` enum values
- `CORS_ORIGIN` empty string rejected; whitespace-only accepted (no `.trim()` in schema — intentional)
- Config object shape: exact top-level keys, `cors`, and `rateLimit` sub-keys verified

### `errorHandler.test.js`

Tests the Express error handler:
- Returns 500 for bogus `err.status` values: `NaN`, `999`, `-1`, `"404"` (string), `0`, `3.14` (float)
- `null` error crashes the handler (no null guard — behavior documented)
- String error handled without throwing
- Does not leak 5xx error messages in production (`NODE_ENV=production`)
- 4xx messages are revealed in production (client error, not masked)
- Call order: `res.status` always before `res.json`

### `health.route.test.js`

Tests `GET /api/health`:
- Returns 200 with exact shape `{ status, uptime, timestamp }`
- `Cache-Control: no-store` header verified to exact value
- `Content-Type` includes `charset=utf-8`
- `uptime` is finite and non-negative (`Number.isFinite` check)

---

## Integration Tests

Integration tests spin up a **real** HTTP server bound to port `:0` (OS picks a free port) and connect with a **real** `socket.io-client`. No mocks are used in integration tests.

### Setup pattern

```js
let server, io, port;

beforeEach(async () => {
  ({ server, io, port } = await createTestServer());
});

afterEach(async () => {
  await new Promise(resolve => {
    io.disconnectSockets(true);
    server.close(resolve);
  });
});
```

Using port `:0` is critical — it eliminates port conflicts in CI where multiple test workers may run in parallel.

### `http.test.js`

- `GET /api/health` returns 200 with correct shape
- Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, no `X-Powered-By`
- CORS: `Access-Control-Allow-Origin: *` for wildcard config; preflight returns 200/204
- JSON body size limit: payloads over 10 KB return 413; under 10 KB accepted
- Rate limiting: `RateLimit-Limit: 100`; `RateLimit-Remaining` decrements per request; 429 after limit exceeded
- Error handler wired: route that throws synchronously returns 500 `{ error: { message } }`
- Non-existent routes return 404

### `socket.test.js`

- `buzz-dad`: connects, emits, receives `ack` and `incoming-message`
- `send-message`: valid and invalid payloads; callback acknowledgement
- `quick-need`: valid enums pass; invalid enum rejected
- `set-status`: valid emoji/label pairs pass; mismatched pairs rejected
- `location-ping`: coordinate bounds enforced
- `battery-low`: level 0–1 passes; out-of-range rejected; null passes
- `countdown-start`: valid minutes pass; invalid minutes rejected
- `send-reply` and `admin-mark-read`: non-admin sockets receive `{ ok: false, error: "Unauthorized" }` (verified against a second server that always sets `isAdmin = false`)
- Rate-limit isolation: fresh socket connection starts with clean counters even after previous socket exhausted its limit
- Multiple clients: `incoming-message` broadcast received by all connected clients
- Disconnect: server handles client disconnect cleanly

---

## Writing New Tests

### Adding a new socket event handler

1. Add the Zod schema and handler in `src/handlers/socket.js`
2. Add a rate limiter instance and limit config constant
3. Add cleanup in the `disconnect` handler
4. In `tests/unit/socket.handlers.test.js`:
   - Add a test group (`describe`) for the new event
   - Test: happy path, rate limited, validation failure, callback (if applicable)
5. In `tests/integration/socket.test.js`:
   - Add an integration test for the happy path with a real socket

### Adding a new HTTP route

1. Create the route in `src/routes/`
2. Mount it in `src/server.js`
3. Add unit tests in `tests/unit/[name].route.test.js`
4. Add an integration test in `tests/integration/http.test.js`

### Adding a new lib module

1. Create the module in `src/lib/`
2. Create `tests/unit/[name].test.js`
3. Use `vi.mock` for any I/O dependencies
4. Aim for full branch coverage of error paths

---

## CI Considerations

- Tests run with `NODE_ENV=test` and `LOG_LEVEL=silent` (set in `tests/setup.js`)
- Integration tests use port `:0` — no port configuration needed
- Coverage report written to `coverage/` — not committed to git
- `vitest.config.js` sets `testTimeout: 10_000` ms — adjust if your CI environment is slow

Run `npm test` to see the current test count. The count in this document may lag behind actual test additions.
