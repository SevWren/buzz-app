# Domain Documentation Layout

**Layout:** Single-context

- `CONTEXT.md` — does not exist yet (project uses CLAUDE.md as primary agent reference)
- `docs/adr/` — Architecture Decision Records (ADRs 0001–0006 present)
- `CLAUDE.md` — authoritative developer + agent reference (module map, conventions, socket events, HTTP endpoints, testing approach, security notes)

## Key domain terms

- **Son** — the child whose phone browser connects to the server and sends events
- **Dad** — the admin panel user who replies from localhost
- **buzz** — a one-tap alert with no payload
- **incoming-message** — the Socket.IO event broadcast when any inbound event or reply is processed
- **admin room** — the Socket.IO room that all localhost sockets join; inbound events are scoped to this room only
- **JSONL log** — `data/messages.jsonl`, append-only persistent message store
- **maybeRotate** — auto-rotation function that renames the log to `.jsonl.1` when it exceeds 10 MB
- **makeRateLimiter** — factory returning a fixed-window counter (`{ count, resetAt }`) per socket
