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

### `messageLog.test.js`

Tests `appendMessage` and `readRecentMessages` using a temp directory.
- `appendMessage`: creates `data/` dir if missing, writes valid JSON lines, swallows errors gracefully
- `readRecentMessages`: returns `[]` when file doesn't exist (ENOENT), parses lines correctly, skips malformed lines, respects the `limit` parameter

### `audioAlert.test.js`

Mocks `play-sound` to verify:
- Correct MP3 file selected for each event type and subtype
- `player.play()` called with the right path
- Errors from `player.play()` are caught and logged, never thrown
- `reply` type is silent (no `player.play()` call)
- Unknown types are silent

### `adminGuard.test.js`

Tests the middleware with various `req.ip` values:
- `127.0.0.1` — allowed
- `::1` — allowed
- `::ffff:127.0.0.1` — allowed (IPv4-mapped prefix stripped)
- `192.168.1.50` — 403
- `10.0.0.1` — 403

### `admin.route.test.js`

Tests both admin endpoints:
- `GET /admin` from localhost — sends `admin.html`
- `GET /admin` from non-localhost — 403
- `GET /admin/history` from localhost — returns `{ messages: [] }` or actual records
- `GET /admin/history` from non-localhost — 403

### `config.test.js`

Tests `envSchema` directly (not the exported `config` object, which triggers `process.exit` on failure). Covers:
- Valid env vars
- Missing required vars
- Out-of-range port numbers
- Invalid `NODE_ENV` values
- `LOG_LEVEL` validation

### `errorHandler.test.js`

Tests the Express error handler:
- Returns 500 JSON with error message
- Does not leak stack traces in production mode
- Handles errors without `message` property

### `health.route.test.js`

Tests `GET /api/health`:
- Returns 200 with correct shape
- `Cache-Control: no-store` header present

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

- `GET /` returns 200 (static HTML)
- `GET /api/health` returns 200 with correct shape
- `GET /admin` from non-localhost returns 403
- JSON body size limit: payloads over 10 KB return 413
- Non-existent routes return 404

### `socket.test.js`

- `buzz-dad`: connects, emits, receives `ack` and `incoming-message`
- `send-message`: valid and invalid payloads; callback acknowledgement
- `quick-need`: valid enums pass; invalid enum rejected
- `set-status`: valid emoji/label pairs pass; mismatched pairs rejected
- `location-ping`: coordinate bounds enforced
- `battery-low`: level 0–1 passes; out-of-range rejected; null passes
- `countdown-start`: valid minutes pass; invalid minutes rejected
- `send-reply`: non-localhost socket receives `Unauthorized` error
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
