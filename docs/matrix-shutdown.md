# Matrix Shutdown Animation

When the Buzz App server shuts down gracefully, the son's phone UI does not simply go blank or show a disconnection error. Instead it displays a cinematic 6-phase animated sequence inspired by the "digital rain" from *The Matrix* — the living app interface is "corrupted" and consumed by falling green characters, culminating in a permanent glowing terminal message. This animation is a deliberate design choice: the shutdown is not a failure state, it is a moment.

The admin panel does **not** display this animation. It shows a plain text system note and disables the reply input.

---

## Trigger

The animation is activated by the `server-shutdown` Socket.IO event emitted during graceful shutdown (`src/handlers/socket.js: broadcastShutdown()`).

In `public/client.js` (lines 224–237), the handler:
1. Removes all socket listeners (prevents reconnect side-effects from updating the thread behind the overlay)
2. Disconnects the socket
3. Activates `#matrix-scene` by adding the `.active` class
4. Calls `sequencer.trigger(message)` with the server's shutdown message

The `message` field from the `server-shutdown` payload becomes the Phase 5 permanent message. If the field is absent, the default is `"Server is shutting down."` The message can be customised by passing a different value in `broadcastShutdown()`.

---

## Phase Sequence

The sequence is measured from the moment `server-shutdown` is received.

| Phase | Start | Duration | What happens |
|-------|-------|----------|--------------|
| 1 — Infiltration | T+0 ms | ~2500 ms | The app UI desaturates and fades via `@keyframes appCorrupt`; the matrix rain canvas fades in over 2 s; the body background transitions to solid black |
| 2 — Takeover | T+2500 ms | — | App UI fully invisible; rain running at full density |
| 3 — Message 1 | T+3300 ms | ~800 ms hold | "CONNECTION LOST" ripples in character-by-character (60 ms per ring outward from centre), holds 800 ms, then each character falls inward with gravity |
| 4 — Message 2 | T+6900 ms | ~800 ms hold | "SERVER SHUTTING DOWN...." ripples in, holds, falls |
| 5 — Message 3 | T+10800 ms | permanent | The server's custom shutdown message ripples in and **never falls** — it persists with micro-glitch and breathing glow indefinitely |
| 6 — Idle | T+∞ | — | Rain continues; final message micro-glitches forever; page must be refreshed to reconnect |

---

## Architecture

### Module: `public/matrix.js`

ES module loaded via `<script type="module">` in `public/client.js`.

**Exports:**

`class MatrixRain` — canvas rain engine.
- Manages column state (position, speed, trail length, character pool selection)
- DPR-aware canvas sizing — physical pixels match device pixel ratio on Retina/HiDPI displays
- Pre-warms 60 simulated frames before becoming visible (prevents the rain starting sparse)
- Frame-rate-independent via `dt` (delta time), capped at 3.0 to prevent large jumps after tab background/foreground
- Registers a message zone so rain glow-boosts near active message characters

`class GlitchSequencer` — 6-phase shutdown orchestrator.
- Per-character assembly: 233 ms "hunt" phase (random glitched character) → 67 ms white flash → 70 ms fade to green settled state
- Character fall physics: 0.4 px/frame² gravity, 35 px/frame terminal velocity
- Micro-glitch mode (Phase 5): random 33 ms character flash every 1.5–4 s per character
- Glow sinusoidal breathing with per-character phase offset for organic appearance
- Glow spike: every ~50 frames a random spike multiplier brightens the glow briefly

`function randChar()` — weighted random Matrix character selection.
- 50% half-width Katakana (for authenticity)
- 20% Latin uppercase
- 20% digits
- 10% symbols (`@#$%&*!?<>/\|[]{}`)
- Two-step weighted draw (not flat-string uniform) to give exact distribution regardless of pool sizes

### HTML elements in `public/index.html`

```
#matrix-scene      — fixed full-viewport overlay div (hidden until .active added)
  #matrix-rain-canvas  — rain layer (z-index 1000, alpha:false context for performance)
  #matrix-msg-canvas   — message layer (z-index 1001, transparent, sits above rain)
#matrix-a11y       — SR-only live region (role="status", aria-live="assertive")
```

The font `ShareTechMono-Regular.woff2` is self-hosted in `public/fonts/` with `font-display: block` to prevent a flash-of-unstyled-text during canvas render.

### CSS in `public/index.html`

- `@keyframes appCorrupt` — saturation and brightness decay over 2.2 s
- `.app.matrix-corrupting` — applies `appCorrupt` and sets `pointer-events: none`
- `body.matrix-transition` — transitions background to `#000000`
- `#matrix-scene` — `position: fixed; inset: 0; z-index: 1000`; hidden by default
- `#matrix-scene::after` — CRT scanline overlay with `@keyframes scanroll`
- `.sr-only` — screen-reader-only positioning for `#matrix-a11y`

---

## Admin Panel Behaviour

`public/admin.js` has no matrix animation. On `server-shutdown` it:
- Removes all socket listeners and disconnects
- Updates `document.title` to `"Buzz App — Offline"`
- Appends a `[SYSTEM]` note to the conversation thread
- Disables the reply input

---

## Accessibility

- `prefers-reduced-motion: reduce` — all canvas animations and CSS keyframes are disabled. The final message is still delivered via `#matrix-a11y` as plain text so screen readers announce it
- `#matrix-a11y` is a `role="status"` live region with `aria-live="assertive"` — each phase message is written to it so screen readers announce phase transitions

---

## Debug Hook

`window.__matrixTest(msg?)` is available **on localhost and 127.0.0.1 only** (guarded at `public/client.js` lines 45–48):

```js
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__matrixTest = (msg) => sequencer.trigger(msg ?? 'Test shutdown message.', { forceAnimation: true });
}
```

Open the browser console on the son's page at localhost and call `__matrixTest()` to trigger the full animation without shutting down the server. `forceAnimation: true` bypasses the `prefers-reduced-motion` check.

This hook is not present on non-localhost connections and is not part of the production surface.

---

## Related Documents

- [`docs/api.md`](api.md) — `server-shutdown` event payload and timing
- [`docs/architecture.md`](architecture.md) — server-side graceful shutdown sequence that emits the event
- [`docs/matrix-shutdown-plan.md`](matrix-shutdown-plan.md) — the original design specification (pre-implementation)
- [`docs/matrix-shutdown-audit.md`](matrix-shutdown-audit.md) — pre-implementation audit; issues were addressed during development (`matrix.js` references resolved items by audit number, e.g. `// audit #3`)
