# 0005 — Two-Layer Admin Authentication

## Status

Accepted

## Context

The admin panel must only be accessible from the machine running the server (localhost). Dad uses it at his desk; the phone on the Wi-Fi must never be able to reach admin routes or send admin socket commands.

A single authentication layer has failure modes:
- HTTP middleware could theoretically be bypassed by a malicious actor who directly connects a WebSocket without making an HTTP request first
- Socket.IO middleware could theoretically be bypassed if a future code change accidentally exposes the admin HTML through a different route

## Decision Drivers

- Defense in depth: no single point of failure in admin access control
- The two layers must be independent — a bypass of one must not grant access through the other
- Implementation must be simple enough to audit at a glance
- Must handle IPv4, IPv6, and IPv4-mapped IPv6 addresses correctly

## Considered Options

- **HTTP middleware only** — `adminGuard.js` blocks `/admin` routes; but a socket connection bypasses HTTP entirely
- **Socket.IO middleware only** — sets `socket.data.isAdmin`; but the HTML page and history endpoint are served via HTTP, not WebSocket
- **Two independent layers** — HTTP middleware for HTTP routes + Socket.IO middleware for socket commands

## Decision Outcome

Chosen option: **Two independent layers**

## Rationale

The HTTP layer (`src/middleware/adminGuard.js`) protects:
- `GET /admin` — serving the admin HTML page
- `GET /admin/history` — returning message history as JSON

The Socket.IO layer (`io.use()` in `src/server.js`) protects:
- `send-reply` — admin-only socket command
- `admin-mark-read` — admin-only socket command

Each layer independently checks the remote address. The HTTP layer reads `req.ip`; the Socket.IO layer reads `socket.handshake.address`. Neither depends on the state of the other.

Localhost detection handles three address forms:
- `127.0.0.1` — IPv4 loopback
- `::1` — IPv6 loopback
- `::ffff:127.0.0.1` — IPv4-mapped IPv6 (stripped to `127.0.0.1` before comparison)

The `::ffff:` prefix is stripped using `.replace('::ffff:', '')` (first occurrence only) to avoid edge cases with double-prefixed strings.

## Consequences

### Positive
- No single bypass compromises admin access
- Each layer is independently testable (see `tests/unit/adminGuard.test.js` and `socket.handlers.test.js`)
- Audit is straightforward: grep for `isAdmin` to find all protected code paths

### Negative
- Two code paths to maintain and keep in sync when adding new admin features
- `adminGuard` and the Socket.IO middleware must agree on what constitutes "localhost" — a divergence would create an inconsistency

### Risks
- If `app.set('trust proxy', 1)` is enabled (required behind a reverse proxy), `req.ip` reflects the `X-Forwarded-For` header. If the proxy is misconfigured, this could allow a spoofed IP to pass the HTTP layer. The Socket.IO layer provides a second check. See `docs/deployment.md` for reverse proxy configuration

## Related Decisions

- [ADR-0006](0006-vanilla-frontend-no-build-step.md) — the IP-based auth model is appropriate because the admin panel is served as static HTML with no server-side session
