# 0001 — Socket.IO over raw WebSockets

## Status

Accepted

## Context

Buzz App requires real-time bidirectional communication between a phone browser and a Node.js server on a local network. The core requirements are:

- The phone must be able to send named events (buzz, message, location, etc.) to the server
- The server must deliver inbound events to admin clients and echo them back to the sender; outbound replies must reach all connected clients
- Connections must survive brief Wi-Fi interruptions without requiring a page refresh
- The server must be able to confirm each event was received (acknowledgement callbacks)
- Implementation must be achievable without client-side build tooling

## Decision Drivers

- Automatic reconnection is essential on a home Wi-Fi where signal may drop momentarily
- Named event multiplexing is required — the app has 9 distinct event types on a single connection
- Acknowledgement (ack) callbacks simplify client-side error handling
- Room-based targeting (`io.to(room).emit`) and full broadcast (`io.emit`) are first-class operations — inbound events are scoped to the `admin` room; outbound replies and shutdown use `io.emit`
- The client is a vanilla HTML/JS page with no build step — bundle size matters less than API simplicity
- LAN-only deployment means WebSocket support can be assumed in all target browsers

## Considered Options

- **Socket.IO 4** — full-featured abstraction over WebSocket/long-polling with reconnect, rooms, namespaces, and acks built in
- **`ws` npm package** — lightweight raw WebSocket server; no built-in reconnect, rooms, or acks
- **Raw browser WebSocket API** — browser-native; requires manual event multiplexing and reconnect logic

## Decision Outcome

Chosen option: **Socket.IO 4**

## Rationale

Socket.IO provides all required features — named events, auto-reconnect, broadcast, and acks — as first-class primitives. The `ws` package and raw WebSocket API would require manually implementing reconnection (exponential backoff, state recovery), event routing, and acknowledgement semantics. That custom code would be larger, harder to test, and more error-prone than using a well-tested library.

The abstraction cost (bundle size, `socket.io-client` on the browser) is acceptable: the app is served from the local server and never fetched over a slow connection.

Long-polling is explicitly disabled (`transports: ['websocket']` in `src/server.js`) to reduce attack surface and eliminate polling overhead. LAN deployments can always support WebSocket upgrades.

## Consequences

### Positive
- Auto-reconnect with configurable attempts and backoff (configured at `reconnectionAttempts: 10`, `reconnectionDelayMax: 10_000` ms in `public/client.js`). **Transport config must match on both ends** — both the server (`transports: ['websocket']` in `src/server.js`) and the browser clients (`public/client.js`, `public/admin.js`) must declare the same transport; if the client omits this the Socket.IO-client defaults to polling first, the server rejects it, and the client enters an infinite reconnect loop
- Named events with Zod-validated payloads replace ad-hoc message routing
- Room-based emission (`io.to('admin').emit()`) scopes inbound events to localhost sockets only; `io.emit()` is used for outbound replies, read receipts, and shutdown — no manual client tracking needed for either pattern
- Ack callbacks give the phone immediate confirmation of each send without a second event

### Negative
- Socket.IO adds ~40 KB to the page weight compared to raw WebSocket
- Debugging requires understanding Socket.IO's internal transport negotiation

### Risks
- Clients behind corporate proxies or strict firewalls that block WebSocket upgrades cannot connect. This is acceptable for home Wi-Fi; see `docs/deployment.md` for reverse proxy configuration

## Related Decisions

- [ADR-0006](0006-vanilla-frontend-no-build-step.md) — the no-build-step constraint influenced the transport choice
- [ADR-0007](0007-admin-room-scoping-for-inbound-events.md) — privacy decision to scope inbound broadcasts to the `admin` room
