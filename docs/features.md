# Features

This document describes every feature of Buzz App from a user's perspective.

---

## Son's Interface (phone)

Accessed at `http://192.168.x.x:3000` — the Network address printed in the terminal.

---

### Buzz Dad

A single large button. Tap it to get Dad's immediate attention without typing anything.

- Plays an audio alert on Dad's computer
- Dad sees "Buzz!" in the conversation thread
- Use this when you need Dad right now and don't have time to type

---

### Send a Message

A text input and Send button. Type anything up to 500 characters and tap Send (or press Enter).

- Plays an audio alert on Dad's computer
- Dad sees your message in the conversation thread and can reply
- Messages are saved permanently

---

### Quick Needs (one-tap buttons)

Five buttons that each communicate a specific need without typing:

| Button | What it means |
|--------|---------------|
| Pickup | "I need a ride" |
| Food | "I'm hungry / need food" |
| Money | "I need money" |
| Call Me | "Please call me" |
| Help | "I need help" |

- Each plays a distinct audio alert on Dad's computer
- Dad sees which button you tapped in the conversation thread

---

### Status

Six emoji buttons to share how you're doing or where you are:

| Button | Emoji | Meaning |
|--------|-------|---------|
| Tired | Sleeping face | I'm tired |
| Hungry | Burger | I'm hungry |
| At School | School | I'm at school |
| Heading Home | House | I'm on my way home |
| All Good | Checkmark | Everything is fine |
| Upset | Sad face | I'm upset |

- Plays an audio alert on Dad's computer
- Dad sees the emoji and label in the conversation thread

---

### Share My Location

Tap this button to send your GPS coordinates to Dad.

- Browser asks for location permission the first time — tap Allow
- Dad sees your coordinates in the conversation thread with a "Open in Maps" link that opens Google Maps
- Rate limited to 3 sends per 30 seconds to avoid GPS spam

**Note:** Location sharing requires the browser to have permission. If you tapped Deny previously, go to your browser's site settings and re-allow location for this page.


---

### My Phone is Dying

Send a battery warning so Dad knows your phone may go offline soon.

- Shows your battery percentage if the browser supports the Battery Status API. On iOS Safari and some Firefox versions this API is unavailable — the alert still goes to Dad but the percentage shows as "unknown %"
- Rate limited to 2 per 60 seconds

---

### ETA Countdown

Tell Dad exactly how many minutes until you're ready. Four buttons: 5, 10, 15, or 30 minutes.

- Dad sees "I'll be ready in N minutes" in the conversation thread
- Use this before a pickup so Dad knows when to leave

---

### Reading Dad's Replies

Dad's replies appear at the bottom of the page in the conversation thread. Your messages appear on the left; Dad's replies appear on the right.

- Replies show a read receipt ("Seen") once Dad views them in the admin panel
- The thread scrolls automatically when new messages arrive
- The thread shows the last 100 messages (loaded from the server on page open)
- The thread displays a maximum of 200 messages at a time in your browser. When this cap is reached, the oldest bubble is removed as new ones arrive. This is display-only — the server log (`data/messages.jsonl`) retains all messages permanently.

---

### Connection Status

The colored dot in the top-right corner:

| Color | Meaning |
|-------|---------|
| Green | Connected — all actions work |
| Yellow (pulsing) | Reconnecting — the app is trying to restore the connection |
| Red | Disconnected — the server may be offline |

The app reconnects automatically. You don't need to refresh the page.

---

## Dad's Admin Panel

Accessed at `http://localhost:3000/admin` — only works on the computer running the server.

---

### Conversation Thread

Shows all messages and replies in chronological order, oldest at the top. Inbound messages (from son) appear on the left; outbound replies (from Dad) appear on the right.

On page load, the last 100 messages are fetched from the server so you can see recent history even after a restart.

---

### Sending a Reply

Type in the reply box at the bottom and press Enter or click Send Reply. Replies are broadcast to all connected clients — son sees them appear immediately.

---

### Unread Badge

When a new message arrives while the admin tab is in the background, an unread badge appears showing how many unread messages there are. The browser tab title also updates to `(N) Buzz App — Admin`.

When you bring the tab into focus, the badge clears and a read receipt is sent to all clients.

---

### Read Receipts

When son sees one of Dad's replies (son's tab becomes visible), a "Seen" indicator appears next to the reply in the admin conversation thread.

---

### Connection Status

Same colored dot indicator as the son's page. The reply input is disabled when disconnected.

---

## Persistent Message Log

All messages, buzzes, quick needs, location pings, battery alerts, countdowns, and replies are saved permanently to `data/messages.jsonl` on the server machine. The log is never automatically deleted.

Each record contains:
- A unique ID
- Timestamp (UTC)
- Direction (`in` for son's events, `out` for Dad's replies)
- Type (`buzz`, `message`, `quick-need`, `status`, `location`, `battery-low`, `countdown`, `reply`)
- The socket ID of the sender
- The event payload

The log persists across server restarts. The admin panel history endpoint reads from this file.

---

## Audio Alerts

When any inbound event arrives on the server, a distinct MP3 chime plays. Different events play different chimes:

| Event | MP3 File |
|-------|----------|
| Buzz | buzz_chat_1.mp3 |
| Message | buzz_chat_1.mp3 |
| Quick Need: Pickup | buzz_chat_2.mp3 |
| Quick Need: Food | buzz_chat_2.mp3 |
| Quick Need: Money | buzz_chat_3.mp3 |
| Quick Need: Call Me | buzz_chat_4.mp3 |
| Quick Need: Help | buzz_chat_5.mp3 |
| Status update | buzz_chat_6.mp3 |
| Location ping | buzz_chat_3.mp3 |
| Battery low | buzz_chat_5.mp3 |
| Countdown | buzz_chat_6.mp3 |
| Reply (Dad's reply) | *(silent — Dad is at the keyboard)* |

Audio playback requires a system audio player. See `README.md` for installation instructions per OS.

---

## Rate Limits

To prevent accidental spam, each event type has a per-connection rate limit:

| Event | Limit |
|-------|-------|
| Buzz | 5 per 10 seconds |
| Message | 20 per 5 seconds |
| Quick need | 10 per 10 seconds |
| Status | 5 per 10 seconds |
| Location | 3 per 30 seconds |
| Battery low | 2 per 60 seconds |
| Countdown | 5 per 10 seconds |
| Reply (admin) | 20 per 5 seconds |

When a rate limit is hit, the server sends back an error acknowledgement and the action is not processed. The phone UI will show the error message.

Rate limiting is part of the overall security model — see [docs/security.md](security.md) for the full threat model and how rate limits fit into the protection strategy.

---

## Server Shutdown Animation

When Dad shuts down the server (or the server stops for any reason), the son's phone displays a cinematic shutdown sequence rather than a plain disconnection error.

**What the son sees:**

1. The app UI desaturates and fades out over about 2.5 seconds
2. A cascade of green Matrix-style characters fills the screen
3. Three messages appear in sequence, each rippling in character by character:
   - "CONNECTION LOST"
   - "SERVER SHUTTING DOWN...."
   - The server's final message — this one stays on screen permanently with a glowing, micro-flickering effect
4. The green rain continues indefinitely until the page is refreshed

The animation is purely visual — no audio plays. Refreshing the page reconnects to the server if it has restarted.

**Admin panel:** Dad's admin panel does not show the animation. It displays a plain "[SYSTEM] Server shutting down" note in the conversation thread and disables the reply input.

**Accessibility:** The animation respects `prefers-reduced-motion`. On devices with this setting enabled, the visual effects are suppressed and the messages are still announced via the screen reader.

For full technical details, see [docs/matrix-shutdown.md](matrix-shutdown.md).

---

## See Also

- [API Reference](api.md) — technical event payload specifications and exact response formats
- [Security Model](security.md) — how the app protects against misuse
- [Matrix Shutdown Animation](matrix-shutdown.md) — technical reference for the shutdown sequence
