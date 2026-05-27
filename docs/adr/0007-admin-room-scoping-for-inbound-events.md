# 0007 — Admin Room Scoping for Inbound Socket.IO Events

## Status

Accepted

## Context

All inbound Socket.IO events (buzz, message, quick-need, status, location-ping, battery-low, countdown-start) were originally broadcast via `io.emit('incoming-message', ...)`. This sent the son's GPS coordinates, messages, battery level, and status updates to **every connected socket** — including any non-admin device on the LAN that happened to open a WebSocket to the server. No authentication was required to receive this data.

## Decision Drivers

- Any device on the home Wi-Fi that knew the server's IP and port could silently subscribe to the son's real-time data
- The son's location (latitude, longitude, accuracy) is particularly sensitive
- The admin panel is already localhost-restricted by two independent layers (HTTP middleware + Socket.IO middleware); inbound event delivery should respect the same boundary
- The son's own client must still receive an echo of each event it sends (for optimistic UI rendering)
- Outbound admin replies, read receipts, and server-shutdown broadcasts must still reach all clients

## Decision Outcome

Chosen option: **Join localhost sockets to an `'admin'` Socket.IO room on connect; scope all inbound `incoming-message` broadcasts to that room**

## Rationale

Socket.IO rooms are a zero-cost primitive — room membership is stored in memory and `io.to(room).emit()` is O(connected sockets in room). The admin room approach requires no token, no session, and no additional middleware: the existing IP-check middleware (`src/server.js:148–162`) already identifies localhost connections; adding `socket.join('admin')` there is a one-line change.

The split emission pattern (`io.to('admin').emit()` for the admin room + `socket.emit()` for the sender echo) ensures:
1. Admin panel receives all inbound events regardless of which socket sent them
2. The son's client receives its own event echo (needed for optimistic bubble rendering)
3. Third-party LAN devices receive nothing

Events that must remain full-broadcast (`io.emit()`):
- `send-reply` — the son must see Dad's reply in the conversation thread
- `messages-read` — the son must see the read receipt
- `server-shutdown` — all clients must receive the shutdown warning to trigger their respective shutdown sequences

## Consequences

### Positive
- Non-localhost LAN devices receive zero inbound events — GPS data, messages, and battery status are no longer passively exposed
- No change to the admin panel or son's client JavaScript was required — both were already filtering on `msg.direction`
- The room join is atomic with the authentication middleware, so there is no race between room membership and first event receipt

### Negative
- Two code paths to maintain: `io.to('admin').emit()` for inbound events vs. `io.emit()` for outbound/control events
- If a future developer uses `io.emit()` for a new inbound event handler, the scoping will silently break — the pattern must be understood and followed

### Risks
- Integration tests that connect from localhost automatically join the admin room and receive inbound events — this is correct behaviour but requires awareness when writing tests that check privacy boundaries (use a non-localhost address or a separate Socket.IO server instance)

## Implementation

- `src/server.js:161` — `socket.join('admin')` added inside the `io.use()` auth middleware
- `src/handlers/socket.js` — all 7 inbound event handlers changed from `io.emit()` to `io.to('admin').emit()` + `socket.emit()`

## Related Decisions

- [ADR-0001](0001-socket-io-over-raw-websockets.md) — Socket.IO rooms are available precisely because Socket.IO was chosen over raw WebSocket
- [ADR-0005](0005-two-layer-admin-auth.md) — the admin room membership is granted by the same IP-check middleware that sets `socket.data.isAdmin`
