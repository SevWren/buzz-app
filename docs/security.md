# Security

Buzz App is designed for local-network use between trusted family members. This document describes the security model, current protections, and what to harden if you ever expose it to a wider network.

---

## Threat Model

**In-scope threats (local network):**
- A device on the same Wi-Fi sending malformed or spammy events
- Someone on the network discovering and abusing the admin panel
- Log injection via crafted message payloads

**Out-of-scope threats (internet-facing):**
- Buzz App is not hardened for public internet exposure by default. If you need that, see the "Production Hardening" section.

---

## Current Protections

### Admin panel is localhost-only

`src/middleware/adminGuard.js` checks `req.ip` on every HTTP request to `/admin`. Any IP other than `127.0.0.1`, `::1`, or `localhost` receives a 403 immediately — the HTML is never served and the history endpoint returns no data.

The same check is applied at the Socket.IO layer: `io.use()` in `server.js` sets `socket.data.isAdmin` based on the socket's remote address. The `send-reply` and `admin-mark-read` handlers verify `socket.data.isAdmin` before processing. A phone on the Wi-Fi that somehow connects to the Socket.IO server cannot send replies or mark messages read.

This is two independent layers — HTTP middleware and Socket.IO middleware — neither depends on the other.

### Input validation with Zod

Every Socket.IO event payload is validated against a Zod schema before any action is taken. Invalid payloads are rejected with a descriptive error message. Nothing reaches `appendMessage`, `playAlert`, or `io.emit` without passing schema validation.

Validated constraints:
- Text fields: trimmed, 1–500 characters
- `quick-need.need`: enum (only 5 allowed values)
- `set-status.emoji` and `.label`: separate enums that must be from a fixed list
- `location-ping`: lat/lng/accuracy are `number` with min/max bounds
- `battery-low.level`: `number` 0–1 or `null`
- `countdown-start.minutes`: literal union `5 | 10 | 15 | 30`

### No raw user data in logs

`src/lib/logger.js` uses Pino. Socket handlers log `typeof data` or field names only — never the actual values. This prevents:
- Log injection (control characters, ANSI escape sequences, newline injection)
- Sensitive content written to disk (a long message payload in a structured log)

### XSS prevention via `textContent`

Both `public/client.js` and `public/admin.js` use `element.textContent = value` exclusively when rendering user-supplied data. `innerHTML` is never used on untrusted content. This prevents cross-site scripting in the browser.

### CSS class injection prevention

`client.js` maintains a `VALID_LOG_TYPES` Set and validates `msg.type` against it before applying the type as a CSS class name. An unexpected `type` value falls back to a safe default class — it cannot inject arbitrary CSS classes or attribute values.

### Per-socket rate limiting

`makeRateLimiter()` in `socket.js` creates Map-based sliding-window counters (see `CLAUDE.md` for all limits). If a socket exceeds its limit, the event is dropped with an `ack error`. This prevents:
- Audio spam (rapid buzzes flooding Dad with alerts)
- Log flooding (filling `data/messages.jsonl` with junk)
- Memory exhaustion from rapid event processing

Rate limiter entries are removed on `disconnect` to prevent unbounded Map growth from connection churn.

### HTTP-level rate limiting

`express-rate-limit` applies a 100 req/15 min limit to all HTTP routes. This prevents HTTP-level flooding.

### Graceful shutdown broadcast

Before disconnecting clients, the server emits `server-shutdown` to all connected sockets. Clients that receive this event stop their reconnection logic. This prevents a storm of reconnect attempts after a clean restart.

### Security headers via Helmet

`helmet` is applied with all defaults except CSP (disabled — see below). This sets:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection` (legacy browsers)
- `Strict-Transport-Security` (only meaningful over HTTPS)
- And others

---

## Known Limitations (acceptable for local-network use)

### No authentication on the son's interface

Any device on the same Wi-Fi that knows the server's IP and port can send buzzes and messages. For a home network with trusted devices this is intentional — adding a login would make it less usable for a child.

### No HTTPS

Traffic between the browser and server is unencrypted. On a trusted home Wi-Fi this is acceptable. On a public Wi-Fi or if exposing to the internet, use HTTPS (see Production Hardening).

### CSP disabled

`helmet({ contentSecurityPolicy: false })` — Content Security Policy is disabled to avoid breaking the vanilla HTML/JS UI without a build step. For hardened deployments, configure a proper CSP.

### `CORS_ORIGIN=*`

By default, any origin can make requests to the server. Acceptable for local-network use where the IP is not publicly routable. Restrict this in production.

### No persistent admin session / token

Admin access is determined solely by IP address (localhost). There is no password, session token, or API key. This is appropriate for a tool only Dad accesses from his own machine.

---

## Production Hardening

If you ever expose Buzz App to the internet or a less-trusted network:

1. **Enable HTTPS** — run behind a reverse proxy (nginx, Caddy) that terminates TLS.

2. **Set `CORS_ORIGIN`** to your specific domain or LAN IP:
   ```
   CORS_ORIGIN=http://192.168.1.50:3000
   ```

3. **Enable Content Security Policy** — remove `contentSecurityPolicy: false` from the Helmet call in `server.js` and configure a policy appropriate for your deployment.

4. **Uncomment `trust proxy`** in `server.js`:
   ```js
   app.set('trust proxy', 1);
   ```
   Without this, all requests appear to come from the proxy's IP and rate limiting uses the proxy's IP instead of the real client IP.

5. **Add authentication to the son's interface** — consider a simple shared PIN or token so only family devices can send events.

6. **Restrict the admin panel** — consider an additional authentication layer (Basic Auth, mTLS, VPN) rather than relying on IP-based localhost check when not on the same machine.

7. **Log rotation** — `data/messages.jsonl` grows indefinitely. Set up logrotate or a cron job to archive or truncate it periodically.

---

## Data Privacy

- `data/messages.jsonl` is excluded from `.gitignore` and is never committed to the repository.
- The file contains all message text, location coordinates, and battery levels in plaintext. It is stored on the server machine's local filesystem.
- No data is ever sent to a third party. The app has no analytics, telemetry, or cloud connectivity.
- Location data (latitude, longitude, accuracy) is stored in the log. If this is a concern, the `location-ping` handler can be removed.
