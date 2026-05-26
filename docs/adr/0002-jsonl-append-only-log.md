# 0002 — JSONL Append-Only Log over a Database

## Status

Accepted

## Context

All messages, buzzes, location pings, and other events must be persisted so that the admin panel can show conversation history after a server restart. A persistence mechanism must be chosen.

The access patterns are:
- **Write**: one append per inbound event (fire-and-forget, must never block a socket response)
- **Read**: fetch the last N records on admin panel load (rare, typically once per session)
- No random access, no updates, no deletes, no cross-record queries

## Decision Drivers

- Persistence must never block or error a socket event handler (latency-sensitive path)
- The server must start with zero setup beyond `npm install`
- The deployment target is Windows, macOS, and Linux without a database process
- The log must survive server restarts and be human-readable for debugging
- Backup must be possible with a simple `cp` command
- No schema migrations when new event types are added

## Considered Options

- **SQLite via `better-sqlite3`** — embedded relational DB; no process; synchronous write API; requires native module compilation
- **SQLite via `sqlite`** — async API; same native compilation issue
- **JSON file (single object)** — simple but requires full parse/serialize on every write; not safe under concurrent writes
- **JSONL (newline-delimited JSON)** — append-only; each write is atomic at the OS level; human-readable; trivially backed up

## Decision Outcome

Chosen option: **JSONL append-only file at `data/messages.jsonl`**

## Rationale

JSONL satisfies all requirements with zero runtime dependencies beyond Node.js built-ins (`fs/promises`). A file append is the fastest possible write — no connection pooling, no SQL parsing, no index maintenance. The file is human-readable and can be inspected with any text editor or streamed with standard Unix tools.

SQLite would require a native module (compilation issues on Windows are common) and introduces transactional overhead for what is a purely append-only workload.

The only read operation (`readRecentMessages(limit)`) reads the last N lines via `fs.readFile` and splits on newlines — acceptable since history is read only on admin panel load, not on every event.

**Known edge case:** `readRecentMessages(0)` returns all records because `Array.prototype.slice(-0)` is equivalent to `slice(0)` in JavaScript. This is documented and tested in `tests/unit/messageLog.test.js`. Callers should not pass `0` to get zero records.

## Consequences

### Positive
- Zero runtime dependencies; no process to manage
- Works on Windows without native compilation
- Human-readable; `tail -f data/messages.jsonl` gives a live event stream
- Trivial backup: `cp data/messages.jsonl backup/`
- Schema-free: new event types require no migration

### Negative
- No indexing — reading last N records requires loading the full file
- No transactions — a partial write during a crash could leave a malformed line (handled: `readRecentMessages` silently skips malformed lines)
- File grows indefinitely — log rotation must be configured externally (see `docs/tech-debt.md`)

### Risks
- Very high message volume could make the file large enough that `readRecentMessages` becomes slow. Acceptable for local-network family use

## Related Decisions

- [ADR-0004](0004-fire-and-forget-for-side-effects.md) — persistence is fire-and-forget precisely because it must never block the socket response path
