# Matrix Shutdown Experience — Design & Development Plan

## Overview

`index.html` is renamed to `index.bak`. A new `index.html` and a new `public/matrix.js`
module deliver the full experience. The shutdown is a 6-phase orchestrated sequence that
surgically transforms the living UI into a Matrix terminal.

---

## Phase Diagram (absolute timing from `server-shutdown` event)

```
T+0ms    ─── server-shutdown received ─────────────────────────────────────
T+0       Phase 1: INFILTRATION — rain begins; app UI desaturates/fades
T+2500    Phase 2: TAKEOVER — canvas fully opaque; UI gone; rain at full density
T+3200    Phase 3: MESSAGE 1 — "CONNECTION LOST" ripples in, holds, falls
T+7800    Phase 4: MESSAGE 2 — "SERVER SHUTTING DOWN...." ripples in, holds, falls
T+12400   Phase 5: MESSAGE 3 — "THE SERVER HAS GONE OFFLINE." ripples in, HOLDS
T+∞       Phase 6: IDLE — final message micro-ripples; rain runs forever
```

---

## Part 1 — The Matrix Rain Engine

### 1.1 Canvas Architecture

Two stacked `<canvas>` elements, both `position: fixed; inset: 0; pointer-events: none`:

```
z-index 1000  →  #matrix-rain-canvas   (background rain)
z-index 1001  →  #matrix-msg-canvas    (message glyphs — separate so rain
                                         never draws over the active message)
```

The rain canvas uses the **semi-transparent fill technique**: instead of `clearRect()` each
frame, a `rgba(0,0,0,0.05)` rect is painted over the entire surface. This causes older glyphs
to decay at roughly 1/20th opacity per frame — at 60 fps a character fully fades in ~1.2
seconds. This is the exact mechanism that produces the luminous trailing streams of the source
image.

### 1.2 Character Set

Four pools, weighted by probability:

| Pool | Characters | Draw weight |
|---|---|---|
| Half-width Katakana | `ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ` | 50% |
| Latin uppercase | `A-Z` | 20% |
| Digits | `0-9` | 20% |
| Symbols | `@#$%&*!?<>/\|[]{}` | 10% |

Katakana dominates for authenticity. All pools are concatenated into a single `ALL_CHARS`
string; selection is `ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)]`.

### 1.3 Stream (Column) Data Model

Each column maintains an independent state object:

```javascript
{
  x:              number,   // pixel X of left edge of this column
  headY:          number,   // Y pixel of the leading (head) glyph
  speed:          number,   // pixels per frame — 0.8 to 3.0
  streamLen:      number,   // number of glyphs in this stream — 8 to 30
  chars:          string[], // per-slot current glyph character
  mutateInterval: number,   // frames between character mutations — 2 to 6
  mutateTimer:    number,   // counts up to mutateInterval
  glowIntensity:  number,   // 0.6 to 1.0 — varies stream brightness
  active:         boolean,  // false = column paused (message zone exclusion)
}
```

Column width equals font size (14px), giving ~100 columns on a 1440px display.

### 1.4 Per-Frame Draw Call

Every `requestAnimationFrame` tick:

```
1. ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'
   ctx.fillRect(0, 0, W, H)                     ← decay all prior glyphs

2. ctx.font = 'bold 14px "Share Tech Mono", "Courier New", monospace'
   ctx.textBaseline = 'top'

3. For each active column:
   a. Mutate timer: if due, replace 1–3 random char slots with randChar()
   b. For j = 0 to streamLen-1:
        charY = col.headY - j * fontSize
        if charY+fontSize < 0 or charY > H → skip

        t = j / streamLen  (0.0 = head, 1.0 = tail)

        if j === 0:
          ctx.shadowBlur = 15
          ctx.shadowColor = '#00ff41'
          ctx.fillStyle   = 'rgb(230, 255, 230)'   ← near-white head
        else if j < 4:
          ctx.shadowBlur = 8
          ctx.shadowColor = '#00ff41'
          green = lerp(255, 160, t)
          ctx.fillStyle = `rgba(0, ${green}, 20, ${1 - t*0.2})`
        else:
          ctx.shadowBlur = 0
          green = lerp(160, 40, (t-0.3)/0.7)
          alpha = lerp(0.85, 0.08, t)
          ctx.fillStyle = `rgba(0, ${green}, 10, ${alpha})`

        ctx.fillText(col.chars[j], col.x, charY)

   c. col.headY += col.speed * dt    (dt = deltaMs / 16.67 for frame-rate independence)
   d. if col.headY - col.streamLen * fontSize > H:
        reset col (new random speed, length, headY starts above screen)

4. ctx.shadowBlur = 0
```

`lerp(a, b, t)` = `a + (b - a) * clamp(t, 0, 1)`

### 1.5 Visual Fidelity Details

- **Multiple glow radii**: Leading glyphs get `shadowBlur: 15`. Every ~50 frames a random
  column gets a `glowIntensity` spike — character size +2px, shadowBlur +8px — for 3 frames,
  simulating the larger bright characters in the source image.

- **Variable stream density**: Short streams (8–12) at 20% frequency, medium (13–20) at 50%,
  long (21–30) at 30%.

- **Staggered launch**: On `init()` each column gets a random `headY` between
  `-canvas.height * 1.5` and `+canvas.height * 0.5` so the effect looks full immediately.

- **Frame-rate independence**: `speed` is calibrated for 60 fps. The draw loop measures
  `deltaTime` and scales: `col.headY += col.speed * (deltaMs / 16.67)`.

---

## Part 2 — Infiltration Transition (Phase 1)

### 2.1 The App Fade-Out

When `server-shutdown` fires:

1. Rain canvas starts at `opacity: 0`
2. CSS transitions on `.app`:

```
T+0ms    filter: saturate(1) brightness(1)       → transition begins
T+800ms  filter: saturate(0.15) brightness(0.6) hue-rotate(100deg)
T+1600ms filter: saturate(0) brightness(0.05) hue-rotate(120deg)
T+2000ms opacity: 0

transition: filter 1.6s ease-in, opacity 0.8s 1.6s ease-out
```

3. Rain canvas fades in on the same timeline:

```
T+0     opacity: 0
T+2000  opacity: 1
transition: opacity 2s ease-in
```

The overlap period (T+800 to T+2000) is where both are partially visible — the normal UI
looks like it is being corrupted as green characters bleed through it.

### 2.2 The Body Background Shift

`<body>` background animates from current dark theme to `#000000` over 2500ms, ensuring no
residual dark-blue persists behind the rain.

```css
body.matrix-transition {
  transition: background-color 2.5s ease-in;
  background-color: #000000 !important;
  background-image: none !important;
}
```

---

## Part 3 — Message Canvas Architecture

### 3.1 Why a Separate Canvas for Messages

The rain canvas uses the `rgba(0,0,0,0.05)` decay trick, which means anything drawn on it
will fade. The message glyphs need to hold sharp and bright. A second canvas
(`#matrix-msg-canvas`) uses `clearRect()` each frame so characters never decay.

### 3.2 `MessageChar` Data Model

```javascript
{
  finalChar:    string,   // the character this slot resolves to
  currentChar:  string,   // what is currently displayed (glitching)
  x:            number,   // final resting X pixel
  y:            number,   // final resting Y pixel (vertically centered)
  currentY:     number,   // current draw Y (animated during fall)
  alpha:        number,   // 0–1
  state:        'hidden' | 'assembling' | 'settled' | 'falling' | 'dead',
  glitchTick:   number,   // countdown to next character mutation
  glitchRate:   number,   // frames between mutations while assembling
  velY:         number,   // downward velocity during fall phase
  velYAccel:    number,   // gravity acceleration
  brightness:   number,   // 1.0 normally; spikes to 2.0 on lock-in flash
  phaseOffset:  number,   // random radians — drives the sinusoidal glow pulse
  microGlitch:  boolean,  // true for Phase 5 held characters
}
```

---

## Part 4 — Horizontal Ripple Assembly

### 4.1 The Visual Effect

Characters materialize outward from the center of the word in expanding rings.

For `"CONNECTION LOST"` (15 characters, center index 7):

```
Ring 0 delay   0ms: char[7]           ← CENTER appears first
Ring 1 delay  60ms: char[6], char[8]
Ring 2 delay 120ms: char[5], char[9]
Ring 3 delay 180ms: char[4], char[10]
Ring 4 delay 240ms: char[3], char[11]
Ring 5 delay 300ms: char[2], char[12]
Ring 6 delay 360ms: char[1], char[13]
Ring 7 delay 420ms: char[0], char[14] ← outermost, last to appear
```

### 4.2 Per-Character Glitch-In Sequence

```
Frames  1–14:  currentChar = randChar(), alpha = 0.6
               New random glyph each frame — character "hunts" for its target
Frames 15–18:  brightness ramps 1.0 → 2.5 (bright white flash)
               currentChar = finalChar
               color: rgb(200,255,200) → rgb(255,255,255)
Frames 19–22:  brightness ramps 2.5 → 1.2
               color: #ffffff → #40ff80 → #00ff41
Frame  23+:    state = 'settled', brightness = 1.0, color = #00ff41
```

Total glitch-in duration per character: ~380ms at 60 fps.

### 4.3 Text Layout Calculation

```javascript
function computeLayout(text, canvas) {
  const fontSize    = Math.min(56, Math.max(24, canvas.width * 0.04));
  const charWidth   = fontSize * 0.6;
  const letterGap   = fontSize * 0.15;
  const totalWidth  = text.length * charWidth + (text.length - 1) * letterGap;
  const startX      = (canvas.width  - totalWidth) / 2;
  const centerY     = canvas.height / 2;

  return [...text].map((char, i) => ({
    finalChar: char,
    x: startX + i * (charWidth + letterGap),
    y: centerY,
    fontSize,
  }));
}
```

---

## Part 5 — Character Fall Animation

### 5.1 Fall Trajectory

```
Initial velocity:  velY = 0.5 px/frame
Gravity:           velYAccel = 0.4 px/frame²
Terminal velocity: 35 px/frame

Each frame:
  velY       = min(velY + velYAccel, 35)
  currentY  += velY
  alpha       = max(0, 1 - (currentY - startY) / (canvas.height * 0.7))
```

Alpha fade is distance-based — a character that has fallen 70% of screen height is fully
transparent, creating a natural light-streak without a separate trail object.

### 5.2 Fall Order

Characters fall in **center-outward order** (mirror of ripple-in), with 60ms stagger between
rings. This creates a "collapsing inward" visual.

### 5.3 Mid-Fall Glitch

`glitchRate` increases from its settled value to 2 frames while falling. Characters visibly
scramble as they drop, reinforcing the "losing signal" sensation.

---

## Part 6 — Phase 5: Permanent Micro-Ripple

### 6.1 Settled Final Message

`"THE SERVER HAS GONE OFFLINE."` assembles via the same ripple-in and never falls.
Each character enters `microGlitch` mode:

- Independent `microGlitchTimer` per character, period 90–240 frames (~1.5s–4s)
- On fire: `currentChar` = `randChar()` for exactly **2 frames** (33ms); `brightness` spikes
  to 1.8; then reverts to `finalChar`
- Timers are randomly staggered on init so characters do not glitch simultaneously

### 6.2 Glow Pulse

`shadowBlur` pulses sinusoidally per character with a random `phaseOffset`:

```javascript
shadowBlur = 6 + 4 * Math.sin(frame * 0.04 + char.phaseOffset)
// range: 2–10px   period: ~157 frames (~2.6s at 60 fps)
```

Each character breathes independently — low-level luminescence that slowly waxes and wanes.

---

## Part 7 — CSS Animations

### 7.1 App Corruption

```css
@keyframes appCorrupt {
  0%   { filter: saturate(1)    brightness(1)    hue-rotate(0deg);   }
  30%  { filter: saturate(0.6)  brightness(0.7)  hue-rotate(40deg);  }
  60%  { filter: saturate(0.2)  brightness(0.35) hue-rotate(90deg);  }
  80%  { filter: saturate(0.05) brightness(0.12) hue-rotate(115deg); }
  100% { filter: saturate(0)    brightness(0.02) hue-rotate(120deg); opacity: 0; }
}

.app.matrix-corrupting {
  animation: appCorrupt 2.2s ease-in forwards;
  pointer-events: none;
}
```

### 7.2 Canvas Fade-In

```css
#matrix-rain-canvas,
#matrix-msg-canvas {
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 2s ease-in;
}

#matrix-rain-canvas.active,
#matrix-msg-canvas.active { opacity: 1; }
```

### 7.3 CRT Scanline Overlay

```css
#matrix-scene::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 1002;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent          0px,
    transparent          2px,
    rgba(0, 0, 0, 0.08)  2px,
    rgba(0, 0, 0, 0.08)  3px
  );
  animation: scanroll 8s linear infinite;
}

@keyframes scanroll {
  from { background-position: 0 0;     }
  to   { background-position: 0 100vh; }
}
```

---

## Part 8 — Color System

```javascript
const MATRIX_COLORS = {
  bg:          '#000000',
  headGlyph:   'rgb(230, 255, 230)',          // near-white leading character
  brightGlyph: 'rgb(0, 255, 65)',             // #00ff41 — canonical Matrix green
  midGlyph:    'rgb(0, 200, 30)',
  darkGlyph:   'rgb(0, 80, 10)',
  shadowColor: '#00ff41',
  msgText:     '#00ff41',
  msgGlow:     '0 0 6px #00ff41, 0 0 12px #00ff41, 0 0 24px rgba(0,255,65,0.5), 0 0 48px rgba(0,255,65,0.25)',
  msgFlash:    '#ffffff',                     // lock-in flash color
  msgFlashGlow:'0 0 30px #00ff41, 0 0 60px #00ff41',
};
```

---

## Part 9 — File Structure

```
public/
  index.bak      ← renamed from current index.html (preserved)
  index.html     ← new Matrix-themed version (same HTML structure + canvas elements)
  matrix.js      ← MatrixRain, MessageChar, GlitchSequencer classes
  client.js      ← socket.on('server-shutdown') calls sequencer.trigger(message)
```

### `matrix.js` Exports

| Export | Responsibility |
|---|---|
| `class MatrixRain` | Canvas rain engine — `start()`, `stop()`, `pause(cols)`, `resume()` |
| `class GlitchSequencer` | Orchestrates all 6 phases — `trigger(message)` |
| `function randChar()` | Returns one random character from `ALL_CHARS` |

### New HTML Elements (added to `index.html`)

```html
<!-- Google Font — Share Tech Mono is authentically digital, free, Google-hosted -->
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap"
      rel="stylesheet">

<!-- Matrix scene wrapper — the ::after pseudo-element provides CRT scanlines -->
<div id="matrix-scene">
  <canvas id="matrix-rain-canvas" aria-hidden="true"></canvas>
  <canvas id="matrix-msg-canvas"  aria-hidden="true"
          role="status" aria-live="assertive"></canvas>
</div>
```

---

## Part 10 — GlitchSequencer State Machine

```
                     trigger(message)
                           │
                    ┌──────▼──────┐
                    │  INFILTRATE  │  2200ms
                    │  rain fades  │  app corrupts
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  RAIN FULL  │  600ms — density builds
                    └──────┬──────┘
                           │
                    ┌──────▼────────────────┐
                    │  MSG 1: ripple-in      │  ~1400ms (15 chars × 60ms + 600ms settle)
                    │  "CONNECTION LOST"     │
                    │  hold 800ms            │
                    │  fall-off center-out   │  ~800ms
                    └──────┬────────────────┘
                           │  400ms gap (rain only)
                    ┌──────▼────────────────┐
                    │  MSG 2: ripple-in      │  ~1700ms (23 chars × 60ms + 600ms settle)
                    │  "SERVER SHUTTING      │
                    │   DOWN...."            │
                    │  hold 800ms            │
                    │  fall-off center-out   │  ~800ms
                    └──────┬────────────────┘
                           │  400ms gap (rain only)
                    ┌──────▼────────────────┐
                    │  MSG 3: ripple-in      │  ~1900ms (28 chars × 60ms + 600ms settle)
                    │  "THE SERVER HAS       │
                    │   GONE OFFLINE."       │
                    │  PERMANENT HOLD        │  ∞
                    │  micro-ripple active   │
                    └───────────────────────┘
```

---

## Part 11 — prefers-reduced-motion Handling

```javascript
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (reducedMotion) {
  // Skip rain entirely
  // Skip character-by-character assembly
  // Show all three messages simultaneously as static green text on black
  // No micro-glitch, no fall animation
  showStaticFallback(['CONNECTION LOST', 'SERVER SHUTTING DOWN....', message]);
}
```

---

## Part 12 — Edge Cases

| Scenario | Handling |
|---|---|
| `server-shutdown` fires while sequence is in progress | `if (this.phase !== 'idle') return` — ignore duplicate events |
| Window resized mid-sequence | `MatrixRain._resize()` reinits columns; message canvas recalculates layout and re-centers all active characters |
| Very narrow viewport (<320px) | `computeLayout()` clamps `fontSize` to 14px minimum; long messages split at spaces onto two lines |
| Canvas `getContext('2d')` returns null | Falls through immediately to `showStaticFallback()` |
| In-browser testing without killing server | `GlitchSequencer` registers `window.__matrixTest = () => sequencer.trigger('Test shutdown')` in development mode |
| `server-shutdown` arrives before DOM is ready | Listener is registered inside `DOMContentLoaded` — not possible in practice since Socket.IO connects after DOM load |

---

## Part 13 — Implementation Order

1. Rename `public/index.html` → `public/index.bak`
2. Create `public/matrix.js` — `randChar()`, `MatrixRain`, `MessageChar`, `GlitchSequencer`
3. Copy `index.bak` → `index.html` — add Google Font `<link>`, `#matrix-scene` wrapper,
   both `<canvas>` elements, Matrix CSS block, `<script src="matrix.js">` before `client.js`
4. Edit `client.js` — replace existing `socket.on('server-shutdown', ...)` handler with
   `sequencer.trigger(message)`; remove old `triggerGlitchTakeover`, `startRadialPulse`,
   `typewriterScramble` functions (superseded by `matrix.js`)
5. Test via `window.__matrixTest()` in browser console during development
6. Commit and push
