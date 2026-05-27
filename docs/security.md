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
- `set-status.emoji` and `.label`: validated as **atomic pairs** — only the 6 defined combinations are accepted (e.g. `{ emoji: "😴", label: "Tired" }`); mismatched but individually valid values are rejected
- `location-ping`: lat/lng/accuracy are `number` with min/max bounds
- `battery-low.level`: `number` 0–1 or `null`
- `countdown-start.minutes`: literal union `5 | 10 | 15 | 30`

### No raw user data in logs

`src/lib/logger.js` uses Pino. Socket handlers log `typeof data` or field names only — never the actual values. This prevents:
- Log injection (control characters, ANSI escape sequences, newline injection)
- Sensitive content written to disk (a long message payload in a structured log)

#### Pino log redaction

`src/lib/logger.js` configures Pino with a redaction list. The following field names are automatically replaced with `[Redacted]` in all log output, regardless of nesting depth:

- `password`, `*.password`
- `token`, `*.token`
- `secret`, `*.secret`
- `authorization`, `*.authorization`
- `cookie`, `*.cookie`

This prevents accidental credential exposure if future middleware passes request objects with auth headers to logger calls.

#### Production log format

In `NODE_ENV=production`, Pino outputs newline-delimited JSON — no colour, no pretty-printing. To read production logs:

```bash
npm start 2>&1 | npx pino-pretty     # human-readable while running
npm start 2>&1 | jq .                # raw JSON filtering
pm2 logs buzz-app | npx pino-pretty  # if running under PM2
```

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

`helmet` is applied with a full Content Security Policy scoped to what the app actually serves (configured in `src/server.js` lines 74–101):

- `default-src 'self'` — all resources must come from the same origin
- `script-src 'self'` — all JS loaded from same origin (including `/socket.io/socket.io.js`)
- `style-src 'self' 'unsafe-inline'` — `'unsafe-inline'` is required because `index.html` and `admin.html` contain inline `<style>` blocks; there is no build step to extract them. This is the only permissive directive.
- `connect-src 'self'` — covers Socket.IO WebSocket connections to the same origin (per CSP Level 3, `'self'` in `connect-src` covers `ws://` to the same host without needing explicit `ws:` wildcards)
- `font-src 'self' data:` — allows the self-hosted ShareTechMono WOFF2 and inline data URIs
- `img-src 'self' data:` — allows inline data URIs for any future image use
- `object-src 'none'` — no plugins
- `base-uri 'self'` — prevents base tag injection
- `form-action 'self'` — no form submissions to external origins
- `frame-ancestors 'none'` — prevents clickjacking
- `worker-src 'none'` — no service workers or workers

Additionally, a `Permissions-Policy` header disables browser features the app does not use: `camera`, `microphone`, `geolocation`, `payment`, `usb`, `interest-cohort`.

Standard Helmet headers also active:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` (redundant with `frame-ancestors 'none'` but kept for older browsers)
- `Strict-Transport-Security` (only meaningful over HTTPS)
- And others

---

## Known Limitations (acceptable for local-network use)

### No authentication on the son's interface

Any device on the same Wi-Fi that knows the server's IP and port can send buzzes and messages. For a home network with trusted devices this is intentional — adding a login would make it less usable for a child.

### No HTTPS

Traffic between the browser and server is unencrypted. On a trusted home Wi-Fi this is acceptable. On a public Wi-Fi or if exposing to the internet, use HTTPS (see Production Hardening).

### CSP `'unsafe-inline'` in `style-src`

CSP is active (see "Security headers via Helmet" above). The one permissive directive is `'unsafe-inline'` in `style-src`, required because `index.html` and `admin.html` contain inline `<style>` blocks with no build step to extract them. This is a known limitation documented in `docs/tech-debt.md`. For hardened deployments, the path to removing it is either extracting styles to external `.css` files or adding per-element nonces (which requires server-side rendering).

### `CORS_ORIGIN=*`

By default, any origin can make requests to the server. Acceptable for local-network use where the IP is not publicly routable. Restrict this in production.

Valid values for `CORS_ORIGIN`:
- `*` — wildcard, any origin (default, acceptable for home networks)
- An exact origin: must match the pattern `^https?://[^/]+$` — a full scheme + host + optional port, no trailing slash, no path. Examples: `http://192.168.1.50:3000`, `https://myapp.local`

Note: `CORS_ORIGIN` has no `.trim()` in the Zod schema (intentional). Spaces-only values and values with **leading** spaces fail the `^https?://` regex and cause a server exit. However, a value with a **trailing** space on an otherwise-valid host (e.g. `http://192.168.1.50:3000 `) passes the refine check — the space becomes part of the configured origin string. Always copy-paste CORS origins carefully to avoid trailing whitespace.

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

3. **Tighten the Content Security Policy** — the app ships with an active CSP (see "Security headers via Helmet" above). To harden further, remove `'unsafe-inline'` from `style-src` by extracting the inline `<style>` blocks in `index.html` and `admin.html` to external `.css` files.

4. **Uncomment `trust proxy`** in `server.js`:
   ```js
   app.set('trust proxy', 1);
   ```
   Without this, all requests appear to come from the proxy's IP and rate limiting uses the proxy's IP instead of the real client IP.

5. **Add authentication to the son's interface** — consider a simple shared PIN or token so only family devices can send events.

6. **Restrict the admin panel** — consider an additional authentication layer (Basic Auth, mTLS, VPN) rather than relying on IP-based localhost check when not on the same machine.

7. **Log retention** — the server auto-rotates `messages.jsonl` at 10 MB (keeps one `.jsonl.1` archive). For longer retention, configure external `logrotate` or a monthly cron job (see `docs/deployment.md`).

---

---

## See Also

- [Architecture overview](architecture.md) — module responsibilities and request flow
- [ADR-0005: Two-layer admin auth](adr/0005-two-layer-admin-auth.md) — rationale for the two-layer approach
- [ADR-0006: Vanilla frontend](adr/0006-vanilla-frontend-no-build-step.md) — why `'unsafe-inline'` is required in `style-src`
- [Documentation index](index.md)

---

## Data Privacy

- `data/messages.jsonl` is covered by `.gitignore` (the `data/` directory is listed there) and is never committed to the repository.
- The file contains all message text, location coordinates, and battery levels in plaintext. It is stored on the server machine's local filesystem.
- No data is ever sent to a third party. The app has no analytics, telemetry, or cloud connectivity.
- Location data (latitude, longitude, accuracy) is stored in the log. If this is a concern, the `location-ping` handler can be removed.
