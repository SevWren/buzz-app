# 0003 — Map-based Fixed-Window Rate Limiting

## Status

Accepted

## Context

The app must prevent abuse scenarios on the local network:
- A child accidentally or deliberately spamming the Buzz button, filling Dad's terminal with audio alerts
- Rapid socket events flooding `data/messages.jsonl` with junk
- A device on the Wi-Fi attempting to exhaust server memory through event flooding

Rate limiting must be per-socket (not per-IP) because the phone may share an IP with other devices via NAT. It must be enforced in-process, with no external service dependency.

## Decision Drivers

- In-process only — no Redis or external state store
- Per-socket granularity (one rate counter per socket per event type)
- O(1) lookup and update per event
- Entries must be cleaned up on socket disconnect to prevent unbounded memory growth
- Must support different limits per event type (buzz: 5/10s, message: 20/5s, location: 3/30s, etc.)
- Implementation must be simple enough to unit-test exhaustively

## Considered Options

- **`express-rate-limit`** — HTTP-level only; cannot apply to Socket.IO events
- **`rate-limiter-flexible`** — full-featured; supports Redis, in-memory, and per-key strategies; adds a production dependency
- **Custom Map-based fixed-window counter** — ~15-line implementation; no dependency; fully controllable

## Decision Outcome

Chosen option: **Custom `makeRateLimiter()` factory using in-process Maps**

## Rationale

The per-socket, per-event-type requirement is not well-served by HTTP middleware libraries. `rate-limiter-flexible` would work but introduces a dependency for a ~15-line problem. The custom implementation in `src/handlers/socket.js` is a **fixed-window counter**:

1. `makeRateLimiter()` — zero arguments; returns an object with `isLimited(socketId, { windowMs, max })` and `remove(socketId)`
2. Internally maintains a `Map<socketId, { count: number, resetAt: number }>` — one entry per socket per limiter instance
3. On each call: if no entry exists, or `now >= resetAt`, reset `{ count: 1, resetAt: now + windowMs }`; otherwise increment `count`. Return `true` (rate-limited) if `count >= max`
4. `remove(socketId)` is called in the `disconnect` handler to delete every limiter entry for that socket

All 9 rate limiters are instantiated at module load time and share their Maps across all socket connections.

Rate limit values (from `src/handlers/socket.js`):

| Event | Max | Window |
|-------|-----|--------|
| `buzz-dad` | 5 | 10 s |
| `send-message` | 20 | 5 s |
| `quick-need` | 10 | 10 s |
| `set-status` | 5 | 10 s |
| `location-ping` | 3 | 30 s |
| `battery-low` | 2 | 60 s |
| `countdown-start` | 5 | 10 s |
| `send-reply` (admin) | 20 | 5 s |
| `admin-mark-read` (admin) | 10 | 5 s |

## Consequences

### Positive
- Zero external dependencies
- True O(1) per event — single Map lookup + integer compare, no array iteration
- Easy to test: mock `socketId` strings and call the limiter directly
- Per-socket isolation: one phone exhausting its buzz limit does not affect another socket

### Negative
- State is not shared across worker processes — if the server were clustered, each worker would have independent counters. This is not a concern for this app (single-process deployment)
- Fixed-window means a burst at window boundary (max events at end of window + max events at start of next window) is theoretically possible — acceptable for the abuse-prevention use case here

### Risks
- A socket that never disconnects (long-lived connection) keeps its Map entry indefinitely. Each entry is a single `{ count, resetAt }` object — constant memory per limiter per socket, negligible at this scale

## Related Decisions

- [ADR-0001](0001-socket-io-over-raw-websockets.md) — rate limiting is per Socket.IO socket, not per HTTP request
