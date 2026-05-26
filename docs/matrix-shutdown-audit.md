# Matrix Shutdown Plan — Full Audit

> **STATUS: PRE-IMPLEMENTATION AUDIT — FEATURE IS NOW IMPLEMENTED**
>
> Issues identified in this audit were addressed during development.
> `public/matrix.js` references resolved items by number (e.g. `// audit #3`, `// audit #42`).
> For the current as-implemented reference, see **[docs/matrix-shutdown.md](matrix-shutdown.md)**.

Audit of `docs/matrix-shutdown-plan.md`. Issues are classified by severity.

- **CRITICAL** — will produce broken behaviour or crash at runtime
- **VISUAL** — will look wrong, low-fidelity, or nothing like the source image
- **PERF** — will cause frame drops, especially on mid-range hardware or mobile
- **MATH** — incorrect numeric calculation
- **AMBIGUOUS** — unspecified detail that will produce different results depending on the developer's interpretation
- **MISSING** — entire required piece absent from the plan

---

## Section 1.1 — Canvas Architecture

### [VISUAL] Device Pixel Ratio (DPR) never addressed

The plan sets `canvas.width = window.innerWidth` but on any retina or HiDPI display
(`window.devicePixelRatio` ≥ 2) this makes the internal raster half the screen resolution.
Every glyph, glow, and trail will be blurry. On a MacBook Pro or any modern phone the
effect will look like a low-resolution screenshot of the Matrix rather than the source
image itself.

Fix — apply DPR on every resize and after every `getContext` call:
```javascript
const dpr = window.devicePixelRatio || 1;
canvas.width  = window.innerWidth  * dpr;
canvas.height = window.innerHeight * dpr;
canvas.style.width  = window.innerWidth  + 'px';
canvas.style.height = window.innerHeight + 'px';
ctx.scale(dpr, dpr);
```
All coordinates and font sizes remain in CSS pixels. Apply identically to both
`#matrix-rain-canvas` and `#matrix-msg-canvas`. Re-apply on every resize call.

### [CRITICAL] Canvas CSS dimensions never specified

`position: fixed; inset: 0` constrains the element's box but does not set the canvas
raster dimensions. Without `width: 100%; height: 100%` in CSS the canvas element shrinks
to its default intrinsic size (300×150 px) while appearing stretched to fill the viewport.
All characters are drawn into a 300×150 grid and scaled up, producing a heavily pixelated
result.

Fix — add to CSS:
```css
#matrix-rain-canvas,
#matrix-msg-canvas {
  width: 100%;
  height: 100%;
}
```

---

## Section 1.2 — Character Set

### [VISUAL] Stated probability weights are wrong for the described implementation

The plan claims 50% Katakana / 20% Latin / 20% Digits / 10% Symbols but then implements
selection as `ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)]` — a uniform draw
over the concatenated string. The actual weight of each pool is determined entirely by its
character count, which gives:

| Pool | Char count | Actual weight |
|---|---|---|
| Katakana (ｦ–ﾝ) | 47 | 47.5% |
| Latin uppercase A–Z | 26 | 26.3% |
| Digits 0–9 | 10 | 10.1% |
| Symbols | 16 | 16.2% |

Latin is 6% heavier than intended; Digits are 10% lighter. The source image is
predominantly Katakana with sparse numerics. The wrong weights make the rain read more
like scrambled Latin text, which destroys the Japanese-script aesthetic.

Fix — use two-step weighted selection:
```javascript
function randChar() {
  const r = Math.random();
  if (r < 0.50) return KATAKANA[Math.floor(Math.random() * KATAKANA.length)];
  if (r < 0.70) return LATIN[Math.floor(Math.random() * LATIN.length)];
  if (r < 0.90) return DIGITS[Math.floor(Math.random() * DIGITS.length)];
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}
```

### [VISUAL] Font has no bold variant — bold synthesis corrupts glyph shapes

Section 1.4 sets `ctx.font = 'bold 14px "Share Tech Mono"'`. Share Tech Mono is a
regular-weight-only font. When `bold` is requested and no bold face exists, browsers
algorithmically thicken the strokes. This distorts the precise pixel geometry of
Katakana characters, making them visually incorrect and inconsistent with the source image.

Fix — remove `bold`:
```javascript
ctx.font = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
```

---

## Section 1.3 — Stream Data Model

### [CRITICAL] `chars` array is never re-initialised on column reset

The data model holds `chars: string[]` sized to `streamLen`. The reset condition (Section
1.4 step 3d) generates a new random `streamLen` but the plan says nothing about
reinitialising `chars` to match the new length. If the new `streamLen` is longer than the
old, the out-of-bounds slots are `undefined`. `ctx.fillText(undefined, ...)` renders the
string `"undefined"` — wide, wrong character.

Fix — every column reset must rebuild the chars array:
```javascript
col.streamLen = 8 + Math.floor(Math.random() * 23);
col.chars = Array.from({ length: col.streamLen }, () => randChar());
```

### [VISUAL] Column stride equals `fontSize`, not character advance width

The plan sets column width = 14px (fontSize) and claims ~100 columns at 1440px. Monospaced
fonts render a glyph whose advance width is approximately `fontSize * 0.6`. At 14px that is
~8.4px per character. Using a 14px stride leaves 5.6px of black gap between every column.
The source image has zero visible inter-column gap — characters pack edge to edge.

Correct column count at 1440px with 0.6 advance ratio: 1440 / 8.4 ≈ 171 columns — nearly
double. The plan's 100-column estimate gives half the density of the source image.

Fix — measure the actual advance width at runtime and use it as the column stride:
```javascript
ctx.font = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
const colStride = Math.ceil(ctx.measureText('M').width);
const numCols   = Math.ceil(canvas.width / dpr / colStride);
```
Cache `colStride` per font/size combination and use it for both column `x` positions and
the column count calculation.

### [MISSING] `glowIntensity` field defined but never referenced in draw pseudocode

The data model declares `glowIntensity: number  // 0.6 to 1.0` and Section 1.5 describes
a periodic spike to this value. The draw pseudocode in Section 1.4 never reads
`glowIntensity`. There is no specification of which draw parameters it modulates (alpha?
shadowBlur multiplier? fillStyle brightness?), no field to track the spike timer, and no
code path that sets the spike back to normal after 3 frames.

Required additions to the data model:
```javascript
glowIntensity:  number,   // multiplier applied to shadowBlur and brightness — 0.6–1.0
glowSpikeTimer: number,   // counts down from 3 to 0; >0 = spike is active
```
And in the draw call, apply `glowIntensity` to the leading character:
```javascript
ctx.shadowBlur = 15 * col.glowIntensity;
// fontSize bump: only if glowSpikeTimer > 0
const effectiveFont = col.glowSpikeTimer > 0
  ? `${fontSize + 2}px "Share Tech Mono", monospace`
  : baseFont;
```
A separate outer loop (before the draw loop) randomly selects ~1 column every 50 frames
and sets its `glowSpikeTimer = 3`, `glowIntensity = 1.4`.

### [MISSING] `startY` not in `MessageChar` data model but required by fall formula

Section 5.1 computes fall alpha as `1 - (currentY - startY) / (canvas.height * 0.7)`.
`startY` must be the character's resting Y at the moment fall begins. The model has `y`
(layout Y) and `currentY` (animated Y) but no `startY`. When fall begins,
`startY` must be captured and stored because `currentY` immediately begins changing.

Add to model:
```javascript
startY: number,  // captured at the moment state transitions to 'falling'
```

---

## Section 1.4 — Per-Frame Draw Call

### [PERF] `ctx.shadowBlur` set per character — catastrophic on mid-range hardware

The plan enables `shadowBlur` for all `j < 4` characters (four per column) plus the head.
At 171 columns × 4 shadow-enabled draws = 684 shadowed `fillText` calls per frame.
`shadowBlur` is the single most expensive Canvas 2D operation; it forces software rendering
on many drivers. On a phone this will drop to 15–20 fps, turning the smooth rain into a
stuttering slideshow.

Fix — restrict `shadowBlur` to `j === 0` only. Simulate the near-head glow for `j 1–3`
by drawing each character twice: once at full color with no shadow, once at 25% alpha
scaled 1.05× to create a soft halo. This is faster than shadow by ~4×.

Alternatively, render the entire rain canvas at half resolution (DPR/2) and upscale with
CSS `image-rendering: pixelated` — the natural blur from upscaling approximates a glow
effect at essentially zero cost.

### [PERF / VISUAL] Decay alpha is not scaled by `dt` — rain fades 2.4× faster at 144Hz

The plan correctly scales `col.headY` by `dt` for frame-rate independence but the decay
rect is always painted at exactly `rgba(0,0,0,0.05)`. At 144Hz the decay rect is painted
144 times per second instead of 60. The effective fade rate is `(1 - 0.05)^144 ≈ 0.0006`
per second — glyphs disappear in ~0.5 s instead of 1.2 s. The rain looks like brief
sparks rather than long glowing streams on any 120Hz or 144Hz display.

Fix:
```javascript
ctx.fillStyle = `rgba(0, 0, 0, ${0.05 * dt})`;
```
Where `dt = Math.min(elapsed / 16.67, 3.0)`.

### [VISUAL] `shadowBlur` bleeds between columns within the same frame

After drawing a column whose last character was `j < 4`, `ctx.shadowBlur` is 8 or 15.
The plan resets it to 0 only in step 4 (after all columns). The next column's `j ≥ 4`
characters inherit the previous column's shadow value, producing random glow on characters
that should be dim. The reset must occur at the end of each column's inner loop:

```javascript
// after the inner for-j loop, before processing next column:
ctx.shadowBlur = 0;
ctx.shadowColor = 'transparent';
```

### [VISUAL] Body gradient lerp produces brightness discontinuity at j=3/4 boundary

For long streams (`streamLen = 30`), at `j = 4`, `t = 4/30 = 0.133`. The body branch
computes `(t - 0.3) / 0.7 = -0.238`. With `clamp(t, 0, 1)` in `lerp`, this clamps to 0,
giving `green = lerp(160, 40, 0) = 160`. Meanwhile at `j = 3` (near-head branch),
`green = lerp(255, 160, 0.133 * 0.7) ≈ 246`. The jump from green=246 (j=3) to green=160
(j=4) is a visible brightness step — a hard horizontal band across every stream. It will be
especially visible at 171 columns.

Fix — unify the gradient formula into a single continuous expression for all `j > 0` by
normalising `t` against the near-head brightness only for `j < 4`, with no discontinuity:
```javascript
const brightness = Math.max(0, 1 - t * 1.1);   // simple linear falloff
const green = Math.floor(lerp(30, 255, brightness));
ctx.fillStyle = `rgba(0, ${green}, ${Math.floor(green * 0.08)}, ${lerp(0.08, 0.9, brightness)})`;
```

### [AMBIGUOUS] Frame-rate-independent `dt` cap not specified for the rain loop

The plan says `dt = deltaMs / 16.67`. On first frame after tab-switch, `deltaMs` can be
thousands of milliseconds. `dt = 200` would teleport every stream head by `200 × 3.0 =
600px` in one tick. All streams jump to or past the bottom, triggering simultaneous resets
— every column resets at the same frame, producing a 1-frame flash of full-screen
characters followed by a completely empty canvas.

Fix — cap `dt`:
```javascript
const dt = Math.min((timestamp - lastTimestamp) / 16.67, 3.0);
```
3.0 caps at a 50ms frame budget, handles paused tabs and low-fps devices without
teleportation.

---

## Section 1.5 — Visual Fidelity Details

### [VISUAL] Staggered launch `headY` upper bound of `+canvas.height * 0.5` places stream
heads mid-screen on first frame

A column with `headY = canvas.height * 0.5` has its leading character halfway down the
screen. Its tail (at `headY - streamLen * fontSize`) may be at y=250 or higher, so a
long visible stream already exists in the upper portion. However the decay rect
`rgba(0,0,0,0.05)` has only been applied once, so those characters appear at full
brightness with no trailing fade — they look freshly drawn at the start of the effect,
not like they have been running for a while.

Fix — pre-warm the canvas by running the draw loop for 120 frames (at simulated 16.67ms
steps) with the canvas invisible (`opacity: 0`) before the fade-in starts. This builds
up realistic decay gradients before any user sees the canvas. This replaces the 500ms
"start early" suggestion in Part 2.

---

## Section 2.1 — Infiltration: App Fade-Out

### [CRITICAL] CSS transition and @keyframes both applied to same properties — conflict

Section 2.1 specifies `transition: filter 1.6s ease-in, opacity 0.8s 1.6s ease-out` on
`.app`. Section 7.1 specifies `animation: appCorrupt 2.2s ease-in forwards` on
`.app.matrix-corrupting`. Both target `filter` and `opacity`. The CSS specification states
that **animations override transitions** on the same property — the transition is silently
ignored. The result is the animation plays but at the animation's own easing, not the
transition's. The transition declarations in Section 2.1 are dead code.

Fix — delete the transition description from Section 2.1 entirely. The `appCorrupt`
@keyframes in Section 7.1 is the single authoritative implementation. Add a note: "Apply
`.matrix-corrupting` class via JS; the @keyframes handles all timing."

### [VISUAL] Rain canvas must be pre-warmed before its opacity transition begins

Section 2.1 starts the rain and simultaneously begins the 2s fade-in. On a cold start the
rain has no visible characters for the first several hundred milliseconds (streams are still
above the screen). When the canvas fades in, the first thing visible is a sparse handful
of stream heads with no trails — this looks nothing like the source image's dense glowing
rain. The pre-warm described in Section 1.5 (running the loop invisibly first) directly
solves this.

Pre-warm for 120 simulated frames before beginning the `opacity` transition. The canvas
`opacity` only begins rising after pre-warm completes.

### [VISUAL] Body background transition conflicts with existing animated gradient mesh

The current `body` CSS in `index.html` has `animation: bgdrift 30s ease-in-out infinite
alternate` on `background-image`. Adding `body.matrix-transition { background-color:
#000000 !important; background-image: none !important; }` removes the gradient but the
`bgdrift` animation is still registered and running. The `!important` override prevents
the gradient from rendering but does not stop the animation or remove its performance cost.

Fix:
```javascript
// JS side — cancel the animation before applying the class:
document.body.style.animation = 'none';
document.body.classList.add('matrix-transition');
```

---

## Section 3.1 — Message Canvas Architecture

### [CRITICAL] `aria-hidden="true"` combined with `role="status" aria-live="assertive"` on the same element

These are mutually exclusive. `aria-hidden="true"` removes the element from the
accessibility tree. `role="status"` and `aria-live` are meaningless once hidden. Screen
readers will never announce the message text. Canvas elements cannot expose drawn content
to AT regardless of ARIA attributes.

Fix — separate concerns:

```html
<!-- Visually hidden live region for screen readers — no canvas involvement -->
<div id="matrix-a11y" class="sr-only" role="status" aria-live="assertive"
     aria-atomic="true"></div>

<!-- Canvas has no accessibility role — it is purely visual -->
<canvas id="matrix-msg-canvas" aria-hidden="true"></canvas>
```

When each message phase begins, update `#matrix-a11y` textContent with the message string.

```css
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}
```

---

## Section 4.1 — Ripple Assembly: Ring Timing

### [VISUAL] Ring 0 is the space character in "CONNECTION LOST"

"CONNECTION LOST":
```
C(0) O(1) N(2) N(3) E(4) C(5) T(6) I(7) O(8) N(9) [sp](10) L(11) O(12) S(13) T(14)
```
Center = index 7 → `'I'`. The space is at index 10 (ring 3). The `'I'` is fine.

However the space at index 10 passes through the full glitch-in animation — cycling through
random visible glyphs before "resolving" to a space (invisible). The flash-on-lock-in fires
on a character the user cannot see. More importantly: `ctx.fillText(' ', x, y)` with
`ctx.shadowBlur = N` still incurs the shadow computation cost and does nothing visually.

Fix — special-case space in glitch-in:
```javascript
if (char.finalChar === ' ' || char.finalChar === '\u00a0') {
  char.state = 'settled';
  char.alpha = 0;
  return; // skip animation entirely
}
```

### [MATH] "SERVER SHUTTING DOWN...." has 24 characters, not 23

Character count:
```
S E R V E R _ S H U T T I N G _ D O W N . . . .
1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4
                  1           1 1 1 1 1 1 1 1 1 2 2 2 2 2
```
Total: 24. The plan states 23 in both the ring count and the state machine timing estimate.
Every timing calculation that uses "23 chars" is off by one 60ms ring delay = 60ms error.

### [MATH] All three state machine timing estimates are wrong

The ripple-in timing is: `maxRippleRadius × ringDelay + glitchInDuration`:
- `maxRippleRadius = ceil((n - 1) / 2)` (rings needed to cover all characters)
- `ringDelay = 60ms`
- `glitchInDuration = ~380ms` (time for last-fired character to complete its animation)

Correct calculations:

| Message | n | maxRadius | Ripple end | +380ms settle | +800ms hold | +800ms fall |
|---|---|---|---|---|---|---|
| "CONNECTION LOST" | 15 | 7 | 420ms | 800ms | 1600ms | 2400ms |
| "SERVER SHUTTING DOWN...." | 24 | 12 | 720ms | 1100ms | 1900ms | 2700ms |
| "THE SERVER HAS GONE OFFLINE." | 28 | 14 | 840ms | 1220ms | 2020ms | — |

The plan's estimates of ~1400ms / ~1700ms / ~1900ms for ripple-in-plus-settle are
incorrectly lower than the correct values of 800ms / 1100ms / 1220ms (just settle) or
1600ms / 1900ms / 2020ms (through hold). The phase diagram T-values are all derived from
these wrong estimates and must be fully recalculated.

Corrected phase diagram (T=0 at server-shutdown event):
```
T+0       Phase 1 starts: rain pre-warms (invisible)
T+500     Rain canvas opacity fade-in begins (2000ms)
T+500     appCorrupt animation begins (2200ms)
T+2700    App fully hidden; rain fully visible
T+3300    600ms density-build wait ends
T+3300    MSG 1 ripple begins
T+5700    MSG 1 hold ends (3300 + 800 + 800 + 800)
T+6500    MSG 1 fall completes
T+6900    400ms gap
T+6900    MSG 2 ripple begins
T+9600    MSG 2 hold ends (6900 + 1100 + 800 + 800)
T+10400   MSG 2 fall completes
T+10800   400ms gap
T+10800   MSG 3 ripple begins
T+12820   MSG 3 fully settled (10800 + 1220 + 800)
T+∞       Micro-ripple loop
```

### [VISUAL / AMBIGUOUS] `computeLayout` uses fixed `fontSize * 0.6` advance width estimate

Different fonts have different advance widths. Share Tech Mono's actual monospace cell
width may not be exactly 0.6× the font size. Centering calculation using a wrong advance
width produces a message that is shifted left or right by `n * error_per_char`. At 28
characters and even 0.5px error per char, the message is 14px off-centre — noticeable at
the scale these messages render.

Fix — measure the actual advance width after the font is loaded:
```javascript
ctx.font = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
const colStride = ctx.measureText('ｦ').width; // use a representative character
```
Cache the result; it is constant for a given font and size.

### [CRITICAL] Message overflows viewport on mobile — not just <320px

`computeLayout` sets `fontSize = max(24, width * 0.04)`. On a 375px iPhone:
`fontSize = max(24, 15) = 24`. With measured advance ~14.4px and letterGap 3.6px, total
width for 28 chars:
```
28 × (14.4 + 3.6) − 3.6 = 28 × 18 − 3.6 = 504 − 3.6 = 500.4px
```
500px > 375px viewport. The plan's "< 320px" edge case trigger is wrong. Overflow happens
at any viewport narrower than ~500px — every phone in portrait orientation.

Fix — after computing `totalWidth`, check against `canvas.width / dpr`:
```javascript
while (totalWidth > (canvas.width / dpr) * 0.92 && fontSize > 12) {
  fontSize -= 1;
  // recompute charWidth, letterGap, totalWidth
}
```
This shrinks font size in 1px steps until the text fits within 92% of viewport width.
If it still overflows at `fontSize = 12`, split into two lines at the last space before
the midpoint. The two-line ripple must use per-line center indices and per-line `centerY`
offsets: `line[0].y = centerY - lineHeight * 0.6`, `line[1].y = centerY + lineHeight * 0.6`.

---

## Section 4.2 — Per-Character Glitch-In

### [VISUAL] `brightness` multiplier on canvas is not a real operation

The plan specifies `brightness` ramping from 1.0 to 2.5 during lock-in. Canvas 2D has no
brightness property. `ctx.fillStyle` is an RGBA color; to go "brighter" the RGB values
must be interpolated. A brightness of 2.5 on `#00ff41 = rgb(0, 255, 65)` would need:
- R: 0 × 2.5 = 0 (already clipped)
- G: 255 × 2.5 = 637 → clips to 255 (already at max)
- B: 65 × 2.5 = 162

At "2.5× brightness" the colour becomes `rgb(0, 255, 162)` — a cyan-green, not a white
flash. The visual intent (white flash at lock-in) requires interpolating to `#ffffff`
explicitly.

Fix — replace `brightness` field with `flashT: number` (0–1, 0 = green, 1 = white):
```javascript
const r = Math.round(lerp(0,   255, char.flashT));
const g = Math.round(lerp(255, 255, char.flashT)); // G stays 255
const b = Math.round(lerp(65,  255, char.flashT));
ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
```
`flashT` peaks at 1.0 during the lock-in flash (frames 15–18) then ramps back to 0.

### [AMBIGUOUS] Glitch-in is "per frame" but no frame rate independence

The plan specifies "Frames 1–14: currentChar = randChar()" — timed in frames, not
milliseconds. At 144fps, each glitch step lasts 7ms instead of 16ms. The hunt phase
completes in 97ms (7ms × 14) instead of 233ms (16ms × 14). The entire glitch-in
compresses to ~152ms vs the intended ~380ms. The ripple looks hurried and the lock-in
flash is barely perceptible at high refresh rates.

Fix — drive the glitch-in with `performance.now()` timestamps, not frame counts:
```javascript
// On activation, record:
char.activatedAt = performance.now();

// In the draw loop, derive state from elapsed time:
const elapsed = performance.now() - char.activatedAt;
if (elapsed < 233) {
  char.currentChar = randChar(); // hunt phase
} else if (elapsed < 300) {
  char.currentChar = char.finalChar;
  char.flashT = (elapsed - 233) / 67; // ramp to white
} else if (elapsed < 370) {
  char.flashT = 1 - (elapsed - 300) / 70; // ramp back to green
} else {
  char.state = 'settled';
  char.flashT = 0;
}
```

---

## Section 4.3 — Text Layout

### [VISUAL] Canvas text `textBaseline` not specified for message canvas

Section 1.4 sets `ctx.textBaseline = 'top'` for the rain canvas. The message canvas has no
`textBaseline` specification. Default is `'alphabetic'` — the bottom of capital letters,
not the top. The y coordinates in `computeLayout` set `y = canvas.height / 2` intending
the character to be vertically centred. With `textBaseline = 'alphabetic'`, the character
base sits at `y`, meaning the top of the glyph is at `y - ascent` and the bottom is
approximately at `y`. The visual result is characters sitting above centre, not on it.

Fix — explicitly set for the message canvas:
```javascript
ctx.textBaseline = 'middle'; // centres the glyph on the y coordinate
```
And use `y = canvas.height / 2` as the centre line. This requires no offset adjustment.

---

## Section 5.1 — Fall Trajectory

### [MATH] Fall alpha formula gives wrong results when `startY` is in the lower half

```
alpha = max(0, 1 - (currentY - startY) / (canvas.height * 0.7))
```
For a character starting at `startY = canvas.height * 0.6` (lower third, plausible for
"THE SERVER..." which is centred vertically), the fade distance is `canvas.height * 0.7`.
The character reaches `alpha = 0` when `currentY = startY + canvas.height * 0.7`, which
equals `canvas.height * 1.3` — 30% below the bottom of the screen. The character falls
off screen while still visible, producing an abrupt clip rather than a fade.

Fix — make the fade distance proportional to remaining screen space below `startY`:
```javascript
const fadeDistance = (canvas.height / dpr) - startY + (canvas.height / dpr) * 0.15;
alpha = Math.max(0, 1 - (currentY - startY) / fadeDistance);
```
This guarantees `alpha = 0` exactly at 15% below the screen edge regardless of where the
character started.

### [PERF] Fall trajectory not scaled by `dt` — falls at wrong speed on non-60Hz displays

Same issue as rain speed: `velY += velYAccel` per frame means the fall completes 2.4×
faster at 144Hz. The dramatic slow-start + fast-accelerate feel of the fall is destroyed
on high-refresh displays.

Fix — work in px/s²:
```javascript
const GRAVITY_PX_S2 = 1400; // px per second²
const TERMINAL_PX_S = 1200;
// per tick:
char.velY = Math.min(char.velY + GRAVITY_PX_S2 * dt * 0.01667, TERMINAL_PX_S * 0.01667);
char.currentY += char.velY;
```
(Multiply by 0.01667 to convert from px/s units to px/frame-at-60fps equivalents when
`dt` = 1.0.)

### [AMBIGUOUS] Fall stagger order description is contradictory

Section 5.2 says the fall is "center-outward order (mirror of ripple-in)." A mirror of
ripple-in (which goes center → outward) would be outward → center. "Center-outward" and
"mirror" are opposite things. Specify explicitly: the intended order for fall is
**edge-inward** (outermost characters fall first, innermost last). This creates a
contracting visual that reads as the words being swept off the screen from both ends
simultaneously, which is more dramatic than center-first.

---

## Section 6.2 — Glow Pulse

### [AMBIGUOUS] `frame` variable is undefined in the glow pulse formula

```javascript
shadowBlur = 6 + 4 * Math.sin(frame * 0.04 + char.phaseOffset)
```
`frame` is not defined anywhere in the plan — it is not a field on `MessageChar`, not
a parameter to the draw function, and not a module-level variable. If it is a global
frame counter it must be explicitly declared and incremented in the RAF loop. If it is
intended to be time-based (which would be frame-rate independent), use
`performance.now()` instead:

```javascript
shadowBlur = 6 + 4 * Math.sin(performance.now() * 0.0025 + char.phaseOffset);
// period: 2π / (0.0025 × 1000ms) ≈ 2.51 seconds — feels organic, not mechanical
```

### [AMBIGUOUS] Micro-glitch 2-frame revert is frame-rate dependent

"On fire: `currentChar = randChar()` for exactly 2 frames (33ms)" — 2 frames is 33ms at
60fps but 14ms at 144fps and 7ms at 240fps. The parenthetical "(33ms)" reveals the
intended duration is in milliseconds. Use `setTimeout`:

```javascript
char.currentChar = randChar();
char.flashT = 0.4; // slight brightness bump during glitch
setTimeout(() => {
  char.currentChar = char.finalChar;
  char.flashT = 0;
}, 33);
```

---

## Section 7.1 — CSS Animations

### [CRITICAL] `appCorrupt` applies `opacity: 0` at 100% but element remains in DOM
with `animation: forwards`

After the animation holds `opacity: 0`, `.app` is invisible but still occupies layout
space and still receives pointer events unless `pointer-events: none` is set. The plan
sets `pointer-events: none` in the CSS rule, which is correct. However if Socket.IO
reconnects during the Matrix sequence, the reconnect handler (`setButtons(true)`,
`addLog(...)`) will try to update the invisible `.app` DOM — entries will be added to the
invisible log list and buttons will be re-enabled behind the Matrix overlay. On reconnect,
the normal UI would need to be explicitly restored or suppressed. The plan has no
reconnect handling at all.

Minimum required: in `client.js`, after `server-shutdown` fires, remove all Socket.IO
event listeners to prevent reconnect side-effects from surfacing:
```javascript
socket.off('connect');
socket.off('disconnect');
socket.off('connect_error');
socket.off('ack');
socket.disconnect();
```

---

## Section 7.3 — CRT Scanline Overlay

### [PERF] `background-position` animation may trigger layout on some browsers

Animating `background-position` from `0 0` to `0 100vh` is not always composited. On
Chromium it is compositor-eligible but on older WebKit it may trigger paint. The safer
composited approach is to use `transform: translateY` on a `::before` element that is
taller than the viewport:

```css
#matrix-scene::after {
  height: 200dvh;          /* tall enough that translateY(50%) = 100dvh */
  top: 0; left: 0;
  /* repeating-linear-gradient same as before */
  animation: scanroll 8s linear infinite;
}
@keyframes scanroll {
  from { transform: translateY(0);    }
  to   { transform: translateY(50%);  }
}
```
`transform` is always composited — GPU only, no paint triggered.

---

## Section 8 — Color System

### [CRITICAL] `msgGlow` is a CSS `text-shadow` multi-value string — not usable in Canvas 2D

```javascript
msgGlow: '0 0 6px #00ff41, 0 0 12px #00ff41, 0 0 24px rgba(0,255,65,0.5), ...'
```
Canvas 2D `ctx.shadowColor` accepts a single color string. The multi-value `text-shadow`
syntax used here is CSS-only. `ctx.shadowColor = MATRIX_COLORS.msgGlow` would set the
shadow color to the literal string, which is invalid — `ctx.shadowBlur` would have no
effect at all.

Fix — multi-layer glow in Canvas 2D requires multiple `fillText` passes per character:
```javascript
function drawGlowChar(ctx, char, x, y, fontSize) {
  ctx.font = `${fontSize}px "Share Tech Mono", monospace`;
  ctx.textBaseline = 'middle';

  // Pass 1 — outermost halo (large, low opacity)
  ctx.shadowBlur = 48; ctx.shadowColor = 'rgba(0,255,65,0.25)';
  ctx.fillStyle  = 'rgba(0,255,65,0.25)';
  ctx.fillText(char, x, y);

  // Pass 2 — mid glow
  ctx.shadowBlur = 24; ctx.shadowColor = 'rgba(0,255,65,0.5)';
  ctx.fillStyle  = 'rgba(0,255,65,0.5)';
  ctx.fillText(char, x, y);

  // Pass 3 — inner glow
  ctx.shadowBlur = 12; ctx.shadowColor = '#00ff41';
  ctx.fillStyle  = 'rgba(0,255,65,0.85)';
  ctx.fillText(char, x, y);

  // Pass 4 — sharp fill, no shadow
  ctx.shadowBlur = 0;
  ctx.fillStyle  = '#00ff41';
  ctx.fillText(char, x, y);
}
```
At 28 message characters × 4 passes = 112 `fillText` calls per frame. Acceptable.

### [AMBIGUOUS] `MATRIX_COLORS` is defined as a JS object but draw pseudocode uses inline strings

The plan documents the color system as `MATRIX_COLORS = { ... }` but every algorithm in
Sections 1.4, 4.2, and 6.2 uses hardcoded strings like `'#00ff41'` and `'rgb(230,255,230)'`
directly. There is no reference to `MATRIX_COLORS` in any algorithm. The object will
either be unused or the algorithms must be rewritten to reference it. Specify explicitly:
all draw calls must reference the `MATRIX_COLORS` constant, not inline literals.

---

## Section 9 — File Structure

### [CRITICAL] `matrix.js` module exports vs. classic `<script>` tag conflict

The plan exports classes (`export class MatrixRain`) but specifies loading via
`<script src="matrix.js">`. Classic `<script>` does not support ES module `export`
syntax — it throws `SyntaxError: Unexpected token 'export'` in all browsers.

Fix options (choose one — specify which in the plan):

**Option A** — ES modules throughout (recommended):
```html
<script type="module" src="client.js"></script>
```
`client.js` then `import { MatrixRain, GlitchSequencer } from './matrix.js'`

**Option B** — Classic scripts, no exports:
```javascript
// matrix.js — attaches to window, no export keyword
window.MatrixRain       = class MatrixRain { ... };
window.GlitchSequencer  = class GlitchSequencer { ... };
```
Option A is cleaner. The project already uses ES modules in `src/` (Node.js side) and
the static files can independently use `type="module"`.

### [MISSING] Google Fonts requires internet — app is designed for offline LAN use

The app explicitly supports LAN-only operation (`start.bat`, local network URLs). The
Google Fonts `<link>` will timeout (~3s) on an internet-disconnected LAN, then fall back
to `"Courier New"`. Worse: Canvas 2D text drawn before the font loads uses the fallback
silently — no error, no warning, just the wrong font for the rest of the page's lifetime
unless `document.fonts.ready` is awaited.

Share Tech Mono is available under the Open Font License. The woff2 file is ~12KB.

Fix:
1. Download `ShareTechMono-Regular.woff2` and place in `public/fonts/`
2. Replace the Google Fonts `<link>` with a local `@font-face`:
```css
@font-face {
  font-family: 'Share Tech Mono';
  src: url('/fonts/ShareTechMono-Regular.woff2') format('woff2');
  font-display: block; /* block rendering until font loads — avoids FOUT on canvas */
}
```
3. Gate canvas initialisation on font availability:
```javascript
await document.fonts.load(`${fontSize}px "Share Tech Mono"`);
rain.start();
```

### [MISSING] `defer` attribute not specified for script tags

Without `defer`, both `<script src="matrix.js">` and `<script src="client.js">` block HTML
parsing. In the current implementation this is already the case for `client.js` and has
not caused issues, but with the addition of `matrix.js` the total blocking time increases.
Specify `defer` on both:
```html
<script defer src="matrix.js"></script>
<script defer src="client.js"></script>
```
`defer` scripts execute in order after HTML is fully parsed, preserving the dependency
order while not blocking rendering.

---

## Section 10 — State Machine

### [AMBIGUOUS] No async coordination mechanism specified

The `GlitchSequencer.trigger()` method must orchestrate many timed operations: waiting
for CSS transitions, waiting for RAF-driven animations to complete, inserting delays.
The plan mentions none of the following:
- Whether `async/await` + a `sleep(ms)` utility is used
- Whether Promise-based animation callbacks are used
- Whether a frame-counter state machine is used
- How to await "last character settled" (which completes at a variable time based on
  ripple ring count + glitch-in duration)

Without specifying this, the implementation will likely resort to nested `setTimeout`
callbacks — unmaintainable and fragile.

Specified approach:
```javascript
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function trigger(message) {
  // Phase 1
  startRain();
  document.body.classList.add('matrix-transition');
  document.querySelector('.app').classList.add('matrix-corrupting');
  await sleep(500);  // pre-warm complete, begin canvas fade-in
  rainCanvas.classList.add('active');
  await sleep(2200); // appCorrupt + rain fade-in complete

  // Phase 2 — density build
  await sleep(600);

  // Phase 3–5 — messages
  await showMessage('CONNECTION LOST',              'fall');
  await sleep(400);
  await showMessage('SERVER SHUTTING DOWN....',     'fall');
  await sleep(400);
  await showMessage('THE SERVER HAS GONE OFFLINE.', 'hold');
}
```
`showMessage()` is itself an `async` function that resolves when the fall (or hold
setup) completes.

### [MATH] Phase 3 start time T+3200 does not match the sum of prior phases

Per the plan's own numbers: infiltration = 2200ms + rain-full = 600ms = 2800ms total.
Phase 3 is listed at T+3200 — a 400ms gap is unaccounted for. The corrected timing in
the MATH section above resolves this, but the original diagram is internally inconsistent.

### [MISSING] No specification for how `MatrixRain.pause(cols)` determines the exclusion zone

The plan exposes `pause(cols)` in the `MatrixRain` API and mentions "message zone
exclusion" but never specifies:
1. How to compute which column indices overlap the message bounding box
2. When to call `pause` relative to the message ripple-in (before? at the same time?)
3. Whether excluded columns fade their last drawn characters naturally or are cleared
4. Whether a padding margin (1–2 columns wider than the text) is applied

The intended "parting of the waters" effect requires answers to all four. Specify:
- Call `pause(cols)` 500ms before `showMessage()` starts, giving the natural decay
  (~600ms to fade to black) time to clear the zone as the message assembles
- Padding: extend the exclusion zone 2 column-widths left and right of the text bounds
- Do NOT call `clearRect` on those columns — let the 0.05 decay clear them naturally
- `resume(cols)` is called after the fall animation completes (or never, for Phase 5)

---

## Section 11 — Reduced Motion

### [AMBIGUOUS] `reducedMotion` evaluated once at load, never updated

```javascript
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```
If the user changes their system accessibility setting while the page is open (e.g.,
via System Preferences during a long session), this cached boolean is stale.

Fix — query at call time:
```javascript
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```
Call `prefersReducedMotion()` inside `trigger()`, not at module load.

---

## Section 12 — Edge Cases

### [MISSING] Tab visibility change causes `dt` spike on return — not addressed

`requestAnimationFrame` pauses when the tab is hidden. On return, `timestamp -
lastTimestamp` is the full hidden duration (seconds or minutes). With the capped-dt
fix (`Math.min(dt, 3.0)`) this is handled for speed. However `ctx.fillStyle =
rgba(0,0,0, 0.05 * dt)` with `dt` capped at 3.0 would apply `rgba(0,0,0,0.15)` on the
first return frame — a slightly darker decay than normal. This is acceptable. No
additional handling needed beyond the `dt` cap.

### [MISSING] Rain canvas `alpha: false` context hint not specified

```javascript
const ctx = canvas.getContext('2d', { alpha: false });
```
The rain canvas background is always solid black. Specifying `alpha: false` tells the
browser to use an opaque raster path — significantly faster compositing because the
browser doesn't need to compute alpha blending against what's behind the canvas. The
message canvas DOES need `alpha: true` (transparent, so rain shows through).

### [MISSING] `willReadFrequently` hint

Neither canvas ever calls `getImageData`. Setting `willReadFrequently: false` (the
default) is fine. No change needed here — but this should be noted explicitly so no
developer adds `willReadFrequently: true` (which switches to a slower CPU-backed path).

### [MISSING] No handling for extremely tall narrow viewports (mobile landscape edge case)

On a 667×375 phone in landscape, `canvas.width = 667`, `canvas.height = 375`. The
message text at `fontSize = max(24, 667 * 0.04) = max(24, 26.7) = 26.7px` renders fine
width-wise but `canvas.height / 2 = 187.5px` means the centred message text is only ~187px
from the top. With the rain running full-density, the centre of the screen is the most
visually busy area — the message risks being lost in the rain. The column exclusion zone
(see above) is critical here.

---

## Summary: Complete List of Issues

| # | Severity | Section | Issue |
|---|---|---|---|
| 1 | VISUAL | 1.1 | DPR not applied — blurry on all retina/HiDPI displays |
| 2 | CRITICAL | 1.1 | Canvas CSS dimensions (width/height 100%) not specified |
| 3 | VISUAL | 1.2 | Stated probability weights do not match flat-string implementation |
| 4 | VISUAL | 1.2 | `bold` keyword synthesizes wrong glyph shapes for Share Tech Mono |
| 5 | CRITICAL | 1.3 | `chars[]` not reinitialised on column reset — renders "undefined" |
| 6 | VISUAL | 1.3 | Column stride = fontSize gives half the visual density of source image |
| 7 | MISSING | 1.3 | `glowIntensity` defined but never applied in draw pseudocode |
| 8 | MISSING | 1.3 | `startY` field absent from `MessageChar` model, required by fall formula |
| 9 | PERF | 1.4 | `shadowBlur` on 4 chars × 171 cols = 684 shadow draws/frame |
| 10 | PERF/VISUAL | 1.4 | Decay alpha not scaled by `dt` — rain fades 2.4× faster at 144Hz |
| 11 | VISUAL | 1.4 | `shadowBlur` not reset between columns — bleeds across streams |
| 12 | VISUAL | 1.4 | Lerp discontinuity at j=3/4 boundary creates visible brightness band |
| 13 | AMBIGUOUS | 1.4 | `dt` cap not specified — tab-return causes stream teleportation |
| 14 | MISSING | 1.5 | `glowSpikeTimer` field and activation logic entirely absent from model |
| 15 | VISUAL | 1.5 | Staggered launch builds no decay trail — rain looks thin on first reveal |
| 16 | CRITICAL | 2.1 | CSS transition and @keyframes both target same properties — conflict |
| 17 | VISUAL | 2.1 | Rain canvas needs pre-warm before opacity fade-in begins |
| 18 | VISUAL | 2.2 | Existing `bgdrift` animation not cancelled before matrix-transition |
| 19 | CRITICAL | 3.1 | `aria-hidden` + `aria-live` on same element — screen readers get nothing |
| 20 | VISUAL | 4.1 | Space character at ripple-in centre fires invisible flash-on-lock-in |
| 21 | MATH | 4.1 | "SERVER SHUTTING DOWN...." has 24 chars, not 23 |
| 22 | MATH | 4.1 | All three state machine timing estimates are wrong |
| 23 | VISUAL | 4.2 | Canvas `brightness` multiplier is not a real operation — no white flash |
| 24 | AMBIGUOUS | 4.2 | Glitch-in timed in frames — compresses/expands with refresh rate |
| 25 | VISUAL | 4.3 | `textBaseline` not specified for message canvas — text above centre |
| 26 | CRITICAL | 4.3 | Message overflows viewport at ≤500px width, not just <320px |
| 27 | AMBIGUOUS | 4.3 | Advance width uses `fontSize * 0.6` estimate — should be measured |
| 28 | MATH | 5.1 | Fall alpha formula gives wrong result when `startY` is in lower half |
| 29 | PERF | 5.1 | Fall trajectory not scaled by `dt` — wrong speed at high refresh rates |
| 30 | AMBIGUOUS | 5.2 | "Mirror of ripple-in" contradicts "center-outward" — specify edge-inward |
| 31 | AMBIGUOUS | 6.2 | `frame` variable undefined — specify `performance.now()` approach |
| 32 | AMBIGUOUS | 6.2 | Micro-glitch 2-frame revert is frame-rate dependent — use `setTimeout` |
| 33 | CRITICAL | 8 | `msgGlow` is CSS `text-shadow` syntax — Canvas 2D ignores multi-value shadow |
| 34 | AMBIGUOUS | 8 | `MATRIX_COLORS` object never referenced in any draw algorithm |
| 35 | CRITICAL | 9 | `export` keyword in classic `<script>` causes SyntaxError |
| 36 | MISSING | 9 | Google Fonts requires internet — LAN-only app must use local font |
| 37 | MISSING | 9 | `defer` attribute not specified — scripts block HTML parsing |
| 38 | AMBIGUOUS | 10 | No async coordination mechanism specified for `GlitchSequencer` |
| 39 | MATH | 10 | Phase 3 T+3200 does not match sum of prior phases (T+2800) |
| 40 | MISSING | 10 | `MatrixRain.pause(cols)` exclusion zone computation never specified |
| 41 | AMBIGUOUS | 11 | `reducedMotion` cached at load — should be queried at call time |
| 42 | MISSING | 12 | Rain canvas `alpha: false` context hint not specified |
| 43 | MISSING | across | No socket disconnect after `server-shutdown` — reconnect pollutes UI |
| 44 | MISSING | across | `#matrix-scene` CSS (`position: fixed; inset: 0`) not specified |
| 45 | PERF | 7.3 | `background-position` animation may not composite — use `translateY` |
