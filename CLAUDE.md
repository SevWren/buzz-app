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
  matrix.js               -- Matrix shutdown animation engine; triggered by server-shutdown event; exports MatrixRain (canvas rain), GlitchSequencer (6-phase shutdown orchestrator), randChar(); see docs/matrix-shutdown.md

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

All agent skills are mirrored in `.claude/skills/` and `.agents/skills/`. After cloning, install them so your AI agent can invoke them directly:

```bash
# ── Third-party skills ──────────────────────────────────────────────────────
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
npx skills add https://github.com/pbakaus/impeccable --skill impeccable

# ── Matt Pocock skills (engineering) ────────────────────────────────────────
npx skills add https://github.com/mattpocock/skills --skill diagnose
npx skills add https://github.com/mattpocock/skills --skill grill-with-docs
npx skills add https://github.com/mattpocock/skills --skill improve-codebase-architecture
npx skills add https://github.com/mattpocock/skills --skill prototype
npx skills add https://github.com/mattpocock/skills --skill setup-matt-pocock-skills
npx skills add https://github.com/mattpocock/skills --skill tdd
npx skills add https://github.com/mattpocock/skills --skill to-issues
npx skills add https://github.com/mattpocock/skills --skill to-prd
npx skills add https://github.com/mattpocock/skills --skill triage
npx skills add https://github.com/mattpocock/skills --skill zoom-out

# ── Matt Pocock skills (productivity) ───────────────────────────────────────
npx skills add https://github.com/mattpocock/skills --skill caveman
npx skills add https://github.com/mattpocock/skills --skill grill-me
npx skills add https://github.com/mattpocock/skills --skill handoff
npx skills add https://github.com/mattpocock/skills --skill write-a-skill

# ── Matt Pocock skills (misc — copy manually; not in CLI manifest) ───────────
# These four are in skills/misc/ but not indexed by `npx skills`. Install by
# copying their SKILL.md files from .claude/skills/ into .claude/skills/ directly,
# or re-run the post-clone setup script if one is added in the future.
# Files are already committed under .claude/skills/git-guardrails-claude-code/,
# .claude/skills/migrate-to-shoehorn/, .claude/skills/scaffold-exercises/,
# and .claude/skills/setup-pre-commit/.
```

> **One-time setup:** After installing the CLI skills above, run `/setup-matt-pocock-skills`
> once per repo to configure the issue tracker, triage label vocabulary, and domain doc
> layout that the engineering skills (`to-issues`, `triage`, `diagnose`, etc.) depend on.

---

### Skill Reference

#### Third-Party Skills

| Skill | Invoke | When to use |
|-------|--------|-------------|
| `architecture-decision-records` | `/architecture-decision-records` | Document a significant technical decision — why Socket.IO over raw WebSocket, why JSONL, etc. Run whenever a major design choice is made or revisited. |
| `tech-debt` | `/tech-debt` | Identify, categorize, and prioritize technical debt. Run periodically (e.g. before a sprint) or after adding a workaround. |
| `doc-maintenance` | `/doc-maintenance` | Keep docs fresh and in sync with code. Run after features, refactors, or dependency upgrades. |
| `code-review` | `/code-review` | Structured security-aware PR review checklist. Run before merging any change that touches auth, crypto, or external inputs. |
| `dependency-auditor` | `/dependency-auditor` | Audit npm deps for CVEs, outdated packages, and unused deps. Run before releases or when `npm audit` flags issues. |
| `nodejs-express-server` | `/nodejs-express-server` | Express 5 patterns and best practices — middleware ordering, async error handling, routing. Reference when adding new routes or middleware. |
| `node` | `/node` | Advanced Node.js patterns by Matteo Collina (Node core contributor) — streams, async, error handling, performance. Reference for non-trivial Node code. |
| `real-time-features` | `/real-time-features` | Socket.IO and WebSocket implementation patterns. Reference when adding new socket events, rooms, or reconnection logic. |
| `zod-schema-validation` | `/zod-schema-validation` | Advanced Zod patterns. Reference when writing or debugging schemas in `src/handlers/socket.js`. |
| `rate-limiting-implementation` | `/rate-limiting-implementation` | Rate limiting patterns for HTTP and Socket.IO. Reference when tuning limits or adding new rate-limited events. |
| `eslint-prettier-config` | `/eslint-prettier-config` | ESLint 9 flat config and Prettier setup. Run when linting configuration needs updating. |
| `impeccable` | `/impeccable clarify` · `/impeccable audit` · `/impeccable critique` | Frontend UI review and polish. Use `clarify` to distil requirements, `audit` for accessibility/performance, `critique` for visual design feedback on `index.html` or `admin.html`. |

---

#### Matt Pocock — Engineering Skills

Run `/setup-matt-pocock-skills` **once** before using any skill in this group.

| Skill | Invoke | When to use |
|-------|--------|-------------|
| `setup-matt-pocock-skills` | `/setup-matt-pocock-skills` | **Run first.** Scaffolds `docs/agents/` config (issue tracker, triage labels, domain doc location) that all other engineering skills read. Run once per repo, then re-run if the issue tracker or label vocabulary changes. |
| `diagnose` | `/diagnose` | Disciplined 6-phase debugging loop: build feedback loop → reproduce → minimise → hypothesise → instrument → fix → regression-test. Invoke when something is broken, throwing, or slower than expected. Especially effective for non-deterministic or hard-to-reproduce bugs. |
| `grill-with-docs` | `/grill-with-docs` | Grilling session that stress-tests a plan against the existing domain model. Updates `CONTEXT.md` and ADRs inline as terminology is resolved. Use before starting any non-trivial feature or when domain language is ambiguous. Prefer over `/grill-me` when `CONTEXT.md` already exists. |
| `improve-codebase-architecture` | `/improve-codebase-architecture` | Finds shallow modules and proposes deepening opportunities — refactors that concentrate complexity behind simpler interfaces. Produces an HTML report with before/after diagrams. Run periodically (every few days on active codebases) to combat software entropy. |
| `prototype` | `/prototype` | Build throwaway code to answer a design question fast. Routes to two branches: a terminal app for state/logic questions, or multiple UI variations for visual design. Use before committing to an architecture when the answer isn't obvious on paper. |
| `tdd` | `/tdd` | Red-green-refactor TDD loop using vertical slices. Writes one failing test, makes it pass, repeats. Use when building a new feature or fixing a bug — prevents horizontal-slice anti-patterns and keeps tests behaviour-focused rather than implementation-coupled. |
| `to-issues` | `/to-issues` | Breaks a plan, spec, or PRD into independently-grabbable GitHub issues using tracer-bullet vertical slices. Each issue cuts through all layers end-to-end. Use after `/to-prd` or when a plan needs turning into actionable tickets. |
| `to-prd` | `/to-prd` | Synthesises the current conversation context into a PRD and publishes it to the issue tracker. Does NOT interview — just captures what's been discussed. Use at the end of a planning/grilling session. |
| `triage` | `/triage` | Moves issues through a state machine: `needs-triage` → `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`. Attempts reproduction, grills for missing info, posts agent briefs. Use to process incoming bugs and feature requests before handing to an AFK agent. |
| `zoom-out` | `/zoom-out` | Tells the agent to zoom out and map all relevant modules and callers for an unfamiliar section of code, using the project's domain vocabulary. Use when you're lost in an area of the codebase and need a higher-level mental model before making changes. |

---

#### Matt Pocock — Productivity Skills

| Skill | Invoke | When to use |
|-------|--------|-------------|
| `grill-me` | `/grill-me` | Relentless interview about a plan or design — walks every branch of the decision tree, asks one question at a time, provides recommended answers. Use at the start of any non-trivial change to align with the agent before it writes code. Use `/grill-with-docs` instead if the repo has `CONTEXT.md`. |
| `caveman` | `/caveman` | Switches to ultra-compressed communication (~75% fewer tokens). Drops articles, filler, and pleasantries; keeps all technical accuracy. Use in long sessions to reduce context consumption. Disable with "stop caveman". |
| `handoff` | `/handoff` | Compacts the current conversation into a handoff document (saved to the OS temp dir) so a fresh agent can continue. Redacts sensitive data. Use before hitting context limits or switching agents. |
| `write-a-skill` | `/write-a-skill` | Creates new agent skills with proper `SKILL.md` structure, progressive disclosure, and bundled resource files. Use when you want to encode a repeatable workflow as an agent skill for this repo. |

---

#### Matt Pocock — Misc Skills

These are checked in under `.claude/skills/` directly (not installable via `npx skills add` by name — copy manually after cloning if needed).

| Skill | Invoke | When to use |
|-------|--------|-------------|
| `git-guardrails-claude-code` | `/git-guardrails-claude-code` | Installs a Claude Code `PreToolUse` hook that blocks destructive git commands (`push`, `reset --hard`, `clean -f`, `branch -D`, `checkout .`) before they execute. Run once to set up the hook, scoped to this project or globally. |
| `migrate-to-shoehorn` | `/migrate-to-shoehorn` | Migrates test files from `as` type assertions to `@total-typescript/shoehorn` (`fromPartial`). Use when TypeScript test code has excessive `as` casts or double-`as` patterns. Test code only — never production. |
| `scaffold-exercises` | `/scaffold-exercises` | Creates exercise directory structures with sections, problems, solutions, and explainers. Niche — only relevant if this repo is repurposed as a course or training material. |
| `setup-pre-commit` | `/setup-pre-commit` | Sets up Husky pre-commit hooks with lint-staged (Prettier), type checking, and tests. Run once when adding commit-time quality gates to the repo. |

---

### Recommended Workflow for New Features

```
1. /setup-matt-pocock-skills   # once per repo
2. /grill-with-docs            # align on plan + update CONTEXT.md
3. /to-prd                     # publish PRD as GitHub issue
4. /to-issues                  # break PRD into vertical-slice issues
5. /tdd                        # implement each issue with red-green-refactor
6. /code-review                # review the PR before merging
```

### Recommended Workflow for Bugs

```
1. /triage                     # classify + write agent brief
2. /diagnose                   # build feedback loop + fix
3. /architecture-decision-records  # if a structural decision was made
```
