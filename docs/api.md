# API Reference

This document covers all HTTP endpoints and Socket.IO events exposed by the server.

---

## HTTP Endpoints

All endpoints return JSON unless noted. All routes share a global rate limit of **100 requests per 15 minutes** per IP and a **10 KB** JSON body size cap.

---

### `GET /`

Serves the son's mobile UI (`public/index.html`).

- Auth: none
- Response: HTML

---

### `GET /api/health`

Liveness check. Suitable for uptime monitors and load balancer health checks. Always returns `Cache-Control: no-store`.

- Auth: none
- Response headers: `Cache-Control: no-store`

**Response 200**

```json
{
  "status": "ok",
  "uptime": 42.3,
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"ok"` | Always `"ok"` if the server is up |
| `uptime` | `number` | Seconds since server start (`process.uptime()`) |
| `timestamp` | `string` | ISO-8601 timestamp |

---

### `GET /admin`

Serves the admin panel (`public/admin.html`).

- Auth: **localhost only** (403 from any other IP)
- Response: HTML

**Response 403** (non-localhost)

```json
{ "error": "Admin access is restricted to localhost only." }
```

---

### `GET /admin/history`

Returns the last 100 log entries from `data/messages.jsonl`, oldest-first.

- Auth: **localhost only** (403 from any other IP)

**Response 200**

```json
{
  "messages": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ts": "2025-01-01T12:00:00.000Z",
      "direction": "in",
      "type": "message",
      "socketId": "abc123",
      "payload": { "text": "Can I get a ride?" }
    }
  ]
}
```

Returns `{ "messages": [] }` if no log file exists yet.

---

## Socket.IO Events

The server uses Socket.IO 4 with `transports: ['websocket']`. **Long-polling is disabled.** Clients must support WebSocket upgrades. See [Architecture — Socket.IO Configuration](architecture.md#socketio-configuration) for the full parameter table and rationale.

**Connection URL:** `ws://[host]:[port]` (or `http://[host]:[port]` — Socket.IO handles the WebSocket upgrade)

---

### Client-to-Server Events (phone / son)

All events below are sent from the browser client to the server. All accept an optional acknowledgement callback:

```js
socket.emit('event-name', payload, (response) => {
  // response: { ok: boolean, error?: string }
});
```

Example with error handling:

```js
socket.emit('send-message', { text: 'Can I get a ride?' }, (response) => {
  if (response.ok) {
    console.log('Message delivered');
  } else {
    // e.g. "Slow down — too many send-messages." or "Validation error: Message too long"
    console.error('Failed:', response.error);
  }
});
```

---

#### `buzz-dad`

Get Dad's attention with no message.

- Payload: *(none)*
- Rate limit: 5 per 10 seconds

**Server response events:**
- `ack` → `{ type: 'buzz', message: 'Buzz received — Dad has been alerted!' }`
- `ack` → `{ type: 'error', message: '...' }` on rate limit exceeded
- `incoming-message` broadcast to all clients

---

#### `send-message`

Send a text message to Dad.

- Payload: `{ text: string }` — 1 to 500 characters (leading/trailing whitespace trimmed)
- Rate limit: 20 per 5 seconds

**Server response events:**
- `ack` → `{ type: 'message', message: 'Server received: "..."' }`
- `ack` → `{ type: 'error', message: '...' }` on validation or rate limit failure
- `incoming-message` broadcast to all clients

---

#### `quick-need`

Send a one-tap need request.

- Payload: `{ need: 'Pickup' | 'Food' | 'Money' | 'Call Me' | 'Help' }`
- Rate limit: 10 per 10 seconds

**Server response events:**
- `ack` → `{ type: 'quick-need', message: 'Need sent: [need]' }`
- `ack` → `{ type: 'error', message: '...' }` on failure
- `incoming-message` broadcast to all clients

---

#### `set-status`

Set a status emoji so Dad knows where you are or how you feel.

- Payload:
  ```json
  {
    "emoji": "😴" | "🍔" | "🏫" | "🏠" | "✅" | "😢",
    "label": "Tired" | "Hungry" | "At School" | "Heading Home" | "All Good" | "Upset"
  }
  ```
  `emoji` and `label` must be a valid pair from the list above.
- Rate limit: 5 per 10 seconds

**Server response events:**
- `ack` → `{ type: 'status', message: 'Status set: [emoji] [label]' }`
- `incoming-message` broadcast to all clients

---

#### `location-ping`

Send GPS coordinates to Dad.

- Payload:
  ```json
  {
    "lat": number,      // -90 to 90
    "lng": number,      // -180 to 180
    "accuracy": number  // >= 0, meters
  }
  ```
- Rate limit: 3 per 30 seconds

**Server response events:**
- `ack` → `{ type: 'location', message: 'Location sent to Dad.' }`
- `incoming-message` broadcast — admin panel renders a Google Maps link

---

#### `battery-low`

Alert Dad that your phone battery is low.

- Payload: `{ level: number | null }` — battery level 0.0–1.0 or null if unavailable
- Rate limit: 2 per 60 seconds

**Server response events:**
- `ack` → `{ type: 'battery-low', message: 'Battery alert sent (XX%).' }`
- `incoming-message` broadcast to all clients

---

#### `countdown-start`

Tell Dad you'll be ready in N minutes.

- Payload: `{ minutes: 5 | 10 | 15 | 30 }`
- Rate limit: 5 per 10 seconds

**Server response events:**
- `ack` → `{ type: 'countdown', message: 'Countdown started: [N] min.' }`
- `incoming-message` broadcast to all clients

---

### Client-to-Server Events (admin panel / Dad)

These events require the socket to originate from localhost. The server sets `socket.data.isAdmin = true` for localhost connections in the Socket.IO middleware. Non-admin sockets that emit these events receive `ack { type: 'error', message: 'Unauthorized.' }`.

---

#### `send-reply`

Send a text reply from Dad to son.

- Payload: `{ text: string }` — 1 to 500 characters (trimmed)
- Auth: localhost only (`socket.data.isAdmin`)
- Rate limit: 20 per 5 seconds

**Server response events:**
- `ack` → `{ type: 'reply', message: 'Reply sent: "..."' }`
- `incoming-message` broadcast to all clients with `direction: 'out'`

---

#### `admin-mark-read`

Mark all messages as read. Broadcasts `messages-read` to all clients so son's UI can update read receipts.

- Payload: *(none)*
- Auth: localhost only (`socket.data.isAdmin`)

**Server response events:**
- `messages-read` broadcast to all clients → `{ ts: string }`
- Acknowledgement callback: `{ ok: true }`

---

### Server-to-Client Events

These are emitted by the server to all connected clients (or sender only as noted).

---

#### `incoming-message` (broadcast to all)

Emitted whenever any message, buzz, or reply is processed.

```json
{
  "id": "uuid-v4",
  "ts": "ISO-8601",
  "direction": "in" | "out",
  "type": "buzz" | "message" | "quick-need" | "status" | "location" | "battery-low" | "countdown" | "reply",
  "payload": {}
}
```

Payload shape per type:

| `type` | `payload` fields |
|--------|-----------------|
| `buzz` | `{}` |
| `message` | `{ text: string }` |
| `quick-need` | `{ need: string }` |
| `status` | `{ emoji: string, label: string }` |
| `location` | `{ lat: number, lng: number, accuracy: number }` |
| `battery-low` | `{ level: number \| null }` |
| `countdown` | `{ minutes: number }` |
| `reply` | `{ text: string }` |

---

#### `ack` (sender only)

Confirmation after each event. Always sent to the socket that emitted the event.

```json
{
  "type": "buzz" | "message" | "quick-need" | "status" | "location" | "battery-low" | "countdown" | "reply" | "error",
  "message": "string"
}
```

`type: 'error'` indicates the event was rejected (rate limit, validation failure, or auth failure).

---

#### `messages-read` (broadcast to all)

Emitted when `admin-mark-read` is received. Used by son's `client.js` to update read-receipt indicators on Dad's replies.

```json
{ "ts": "ISO-8601" }
```

---

#### `server-shutdown` (broadcast to all)

Emitted during graceful shutdown before sockets are disconnected.

```json
{ "message": "Server is shutting down. Connection will be lost." }
```

**Son's client behaviour (`public/client.js`):**
1. All socket listeners are removed (prevents the thread from updating behind the animation overlay)
2. The socket is disconnected
3. `#matrix-scene` overlay is activated
4. `GlitchSequencer.trigger(message)` is called — the 6-phase matrix shutdown animation begins
5. The `message` field becomes the Phase 5 permanent on-screen message
6. The page must be refreshed to reconnect

See [docs/matrix-shutdown.md](matrix-shutdown.md) for the full animation sequence and timing.

**Admin client behaviour (`public/admin.js`):**
1. All socket listeners are removed
2. The socket is disconnected
3. `document.title` is updated to `"Buzz App — Offline"`
4. A `[SYSTEM]` note is appended to the conversation thread
5. The reply input is disabled
6. No matrix animation is shown on the admin panel

---

## Error Responses

### HTTP errors

| Status | When |
|--------|------|
| 400 | Malformed JSON body |
| 403 | Admin route accessed from non-localhost |
| 404 | Route not found |
| 429 | HTTP rate limit exceeded |
| 500 | Unhandled server error |

### Socket errors

Emitted as `ack` events with `type: 'error'`:

| Reason | `message` |
|--------|-----------|
| Rate limit | `"Slow down — too many [events]."` |
| Validation | `"Validation error: [Zod issue message]"` |
| Auth | `"Unauthorized."` |
