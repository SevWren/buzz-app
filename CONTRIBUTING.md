# Contributing to Buzz App

Buzz App is a real-time local-network family messaging tool. This guide covers development setup, coding conventions, and how to add new features.

---

## Development Setup

**Prerequisites:** Node.js v20.6 or higher (`node -v` to check), npm.

```bash
git clone https://github.com/SevWren/buzz-app.git
cd buzz-app
npm install
npm run dev        # starts the server with --watch (auto-restarts on file changes)
```

Open `http://localhost:3000` for the son's UI and `http://localhost:3000/admin` for the admin panel.

`.env` is created automatically from `.env.example` on first run. Do not edit `.env.example` — it is the authoritative template.

---

## Running Tests

```bash
npm test                  # run all tests once
npm run test:watch        # re-run on file changes
npm run test:coverage     # coverage report (thresholds: 80% lines/functions/statements, 75% branches — see vitest.config.js)
```

See [`docs/testing.md`](docs/testing.md) for the full test structure, mocking strategy, and how to write tests for new features.

---

## Code Style

```bash
npm run lint      # ESLint 9 flat config
npm run format    # Prettier
```

Both are checked in CI. Run them before committing to avoid failed checks.

---

## Architecture Overview

Buzz App is a Node.js/Express server with Socket.IO for real-time messaging. The son's phone connects over WebSocket; the admin panel (localhost-only) is served from the same server. All events are validated with Zod and logged to an append-only JSONL file.

For the full architecture, module responsibilities, and data flow, see [`CLAUDE.md`](CLAUDE.md) (developer and agent reference) and [`docs/architecture.md`](docs/architecture.md).

---

## Key Conventions

These conventions are non-negotiable — they exist for correctness and security reasons.

**ES modules throughout.** The project uses `"type": "module"` in `package.json`. Use `import`/`export`. Never use `require()`.

**Zod validation order: `.trim()` before `.min()`.** Always write `.trim().min(1).max(n)`, never `.min(1).max(n).trim()`. `trim()` is a transform that runs after other validators — putting `.min(1)` first allows whitespace-only strings like `'   '` to pass the length check.

**Express error handler arity: exactly `(err, req, res, _next)`.** Express identifies error handlers by their four-argument signature. If you rename `_next` to `next` but don't use it, or swap the argument order, you will get `TypeError: res.status is not a function` at runtime. The underscore prefix on `_next` is intentional.

**Never log raw user data.** Log `typeof data` or field names only — never values. This prevents log injection (newline injection, ANSI escape sequences) and stops sensitive message content from being written to disk.

**`audioAlert` is fire-and-forget — never `await` it.** `playAlert()` spawns a child process internally. It catches and logs its own errors. Awaiting it would block the socket response path.

**`appendMessage` is fire-and-forget in socket handlers.** Persistence failures must never surface as socket errors to the client. A log write failure is a server-internal concern. The message was received and broadcast; the client must not see an error.

**Adding a new socket event:** follow the instructions in [`docs/testing.md`](docs/testing.md) — "Adding a new socket event handler". Rate limiter entries must be cleaned up in the `disconnect` handler or the Map grows unbounded.

**Rate limits** are documented in [`CLAUDE.md`](CLAUDE.md) under "Key Conventions — Per-socket rate limiting".

---

## Commit Message Style

Use imperative mood, present tense, no trailing period.

```
fix: prevent rate limiter Map from leaking on disconnect
feat: add countdown-start socket event
docs: document matrix shutdown animation in features.md
test: add integration test for battery-low event
```

---

## Security

Before submitting changes that touch authentication, rate limiting, or user input handling, review [`docs/security.md`](docs/security.md) to ensure your change does not introduce regressions. Pay particular attention to:

- The two-layer admin auth (HTTP middleware + Socket.IO middleware must both be updated if adding a new admin capability)
- Zod validation must be the first operation in any new socket handler
- `textContent` exclusively for DOM rendering — never `innerHTML` on untrusted data
