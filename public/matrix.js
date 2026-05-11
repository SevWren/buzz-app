/**
 * matrix.js — Matrix rain engine + shutdown sequencer
 *
 * Exports:
 *   class MatrixRain      — canvas rain engine
 *   class GlitchSequencer — orchestrates the full 6-phase shutdown sequence
 *   function randChar()   — returns one random Matrix character
 *
 * All coordinates are in CSS pixels. DPR scaling is applied internally.
 * Load via <script type="module"> in client.js.
 */

// ─── Character pools ─────────────────────────────────────────────────────────

const KATAKANA = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const LATIN   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS  = '0123456789';
const SYMBOLS = '@#$%&*!?<>/\\|[]{}';

// Two-step weighted selection gives exact 50/20/20/10 distribution regardless
// of pool sizes — flat-string uniform draw would give wrong weights (audit #3).
export function randChar() {
  const r = Math.random();
  if (r < 0.50) return KATAKANA[Math.floor(Math.random() * KATAKANA.length)];
  if (r < 0.70) return LATIN[Math.floor(Math.random() * LATIN.length)];
  if (r < 0.90) return DIGITS[Math.floor(Math.random() * DIGITS.length)];
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ─── MatrixRain ───────────────────────────────────────────────────────────────

const FONT_SIZE = 14; // CSS pixels — base size; colStride measured at runtime

export class MatrixRain {
  constructor(canvas) {
    this._canvas    = canvas;
    // alpha:false — opaque raster; faster compositing since background is always black (audit #42)
    this._ctx       = canvas.getContext('2d', { alpha: false });
    this._cols      = [];
    this._rafId     = null;
    this._lastTs    = 0;
    this._colStride = FONT_SIZE;
    this._W         = 0;
    this._H         = 0;
    this._dpr       = 1;
    this._running   = false;
    this._pausedSet = new Set();
    this._spikeNext = 50;     // frames until next random glow spike
    this._frame     = 0;
    this._baseFont  = `${FONT_SIZE}px "Share Tech Mono", "Courier New", monospace`;
  }

  async start() {
    // Gate on font availability — silent fallback if font load fails (audit #36)
    try { await document.fonts.load(this._baseFont); } catch (_) { /* use fallback */ }
    this._resize();
    window.addEventListener('resize', () => this._resize());
    // Pre-warm: 60 simulated frames so streams have realistic decay trails
    // before the canvas becomes visible (audit #15, #17)
    this._prewarm(60);
  }

  startLoop() {
    if (this._running) return;
    this._running = true;
    this._lastTs  = performance.now();
    this._rafId   = requestAnimationFrame(ts => this._tick(ts));
  }

  stop() {
    this._running = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  // Pause columns whose x falls within [xStart-pad, xEnd+pad] (audit #40)
  colsForRect(xStart, xEnd) {
    const pad = this._colStride * 2;
    const result = [];
    for (let i = 0; i < this._cols.length; i++) {
      const cx = this._cols[i].x;
      if (cx + this._colStride >= xStart - pad && cx <= xEnd + pad) result.push(i);
    }
    return result;
  }

  pause(indices) {
    for (const i of indices) { this._pausedSet.add(i); if (this._cols[i]) this._cols[i].active = false; }
  }

  resume(indices) {
    for (const i of indices) { this._pausedSet.delete(i); if (this._cols[i]) this._cols[i].active = true; }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const W   = window.innerWidth;
    const H   = window.innerHeight;
    this._dpr = dpr;
    this._W   = W;
    this._H   = H;

    // Apply DPR to canvas raster; keep CSS dimensions at logical size (audit #1, #2)
    this._canvas.width        = Math.round(W * dpr);
    this._canvas.height       = Math.round(H * dpr);
    this._canvas.style.width  = W + 'px';
    this._canvas.style.height = H + 'px';
    const ctx = this._ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Measure actual advance width after DPR transform (audit #6, #27)
    ctx.font        = this._baseFont;
    ctx.textBaseline = 'top';
    this._colStride = Math.max(8, Math.ceil(ctx.measureText('ｦ').width));

    this._initCols(W, H);
  }

  _initCols(W, H) {
    const stride  = this._colStride;
    const numCols = Math.ceil(W / stride) + 2;
    this._cols    = [];
    for (let i = 0; i < numCols; i++) {
      this._cols.push(this._makeCol(i * stride, H, true));
    }
  }

  _makeCol(x, H, staggered) {
    const streamLen = this._randStreamLen();
    return {
      x,
      // Staggered launch: heads scattered from well above to halfway down screen (audit #15)
      headY:          staggered ? -(Math.random() * H * 1.5) : -FONT_SIZE * 2,
      speed:          0.8 + Math.random() * 2.2,
      streamLen,
      chars:          Array.from({ length: streamLen }, () => randChar()),
      mutateInterval: 2 + Math.floor(Math.random() * 5),
      mutateTimer:    0,
      glowIntensity:  0.6 + Math.random() * 0.4,
      glowSpikeTimer: 0,
      active:         true,
    };
  }

  _randStreamLen() {
    const r = Math.random();
    if (r < 0.20) return  8 + Math.floor(Math.random() * 5);   // short  8–12
    if (r < 0.70) return 13 + Math.floor(Math.random() * 8);   // medium 13–20
    return 21 + Math.floor(Math.random() * 10);                 // long   21–30
  }

  _prewarm(frames) {
    const ctx    = this._ctx;
    const W      = this._W;
    const H      = this._H;
    const stride = this._colStride;
    ctx.font        = this._baseFont;
    ctx.textBaseline = 'top';
    for (let f = 0; f < frames; f++) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, W, H);
      for (const col of this._cols) {
        this._drawCol(ctx, col, H, 1.0);
        col.headY += col.speed;
        col.mutateTimer++;
        if (col.mutateTimer >= col.mutateInterval) { this._mutateCol(col); col.mutateTimer = 0; }
        if (col.headY - col.streamLen * FONT_SIZE > H) this._resetCol(col, H);
      }
      ctx.shadowBlur  = 0;
      ctx.shadowColor = 'transparent';
    }
  }

  _tick(ts) {
    if (!this._running) return;
    const elapsed = ts - this._lastTs;
    this._lastTs  = ts;
    // Cap dt at 3× to prevent teleportation after tab switch (audit #13)
    const dt = Math.min(elapsed / 16.67, 3.0);

    const ctx = this._ctx;
    const W   = this._W;
    const H   = this._H;
    this._frame++;

    // Decay rect — scaled by dt so trail length is frame-rate independent (audit #10)
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.15, 0.05 * dt)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.font        = this._baseFont;
    ctx.textBaseline = 'top';

    // Random glow spike every ~50 frames (audit #7, #14)
    this._spikeNext -= dt;
    if (this._spikeNext <= 0) {
      this._spikeNext = 40 + Math.random() * 20;
      const ci = Math.floor(Math.random() * this._cols.length);
      if (this._cols[ci]) { this._cols[ci].glowSpikeTimer = 3; this._cols[ci].glowIntensity = 1.4; }
    }

    for (const col of this._cols) {
      if (!col.active) continue;

      // Glow spike countdown (audit #7)
      if (col.glowSpikeTimer > 0) {
        col.glowSpikeTimer--;
        if (col.glowSpikeTimer === 0) col.glowIntensity = 0.6 + Math.random() * 0.4;
      }

      this._drawCol(ctx, col, H, dt);
      col.headY       += col.speed * dt;
      col.mutateTimer += dt;
      if (col.mutateTimer >= col.mutateInterval) { this._mutateCol(col); col.mutateTimer = 0; }
      if (col.headY - col.streamLen * FONT_SIZE > H) this._resetCol(col, H);
    }
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';

    this._rafId = requestAnimationFrame(ts => this._tick(ts));
  }

  _drawCol(ctx, col, H, dt) {
    const spiking = col.glowSpikeTimer > 0;
    for (let j = 0; j < col.streamLen; j++) {
      const charY = col.headY - j * FONT_SIZE;
      if (charY + FONT_SIZE < 0 || charY > H) continue;

      const t          = j / col.streamLen;         // 0=head, 1=tail
      const brightness = Math.max(0, 1 - t * 1.1);  // continuous gradient (audit #12)
      const green      = Math.floor(lerp(30, 255, brightness));
      const alpha      = lerp(0.08, 0.9, brightness);

      if (j === 0) {
        // Head — glow only on leading char, keeps shadow call count low (audit #9)
        ctx.shadowBlur  = (spiking ? 22 : 15) * col.glowIntensity;
        ctx.shadowColor = '#00ff41';
        ctx.fillStyle   = spiking ? 'rgb(255,255,255)' : 'rgb(230,255,230)';
      } else {
        ctx.shadowBlur = 0;  // reset each char so no bleed to next column (audit #11)
        ctx.fillStyle  = `rgba(0,${green},${Math.floor(green * 0.08)},${alpha.toFixed(2)})`;
      }
      ctx.fillText(col.chars[j], col.x, charY);
    }
    // Explicit reset after every column (audit #11)
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
  }

  _mutateCol(col) {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < count; k++) {
      col.chars[Math.floor(Math.random() * col.streamLen)] = randChar();
    }
  }

  _resetCol(col, H) {
    col.headY          = -FONT_SIZE * 2;
    col.speed          = 0.8 + Math.random() * 2.2;
    col.streamLen      = this._randStreamLen();
    // Reinitialise chars array to new length — prevents "undefined" render (audit #5)
    col.chars          = Array.from({ length: col.streamLen }, () => randChar());
    col.glowIntensity  = 0.6 + Math.random() * 0.4;
    col.glowSpikeTimer = 0;
  }
}

// ─── GlitchSequencer ─────────────────────────────────────────────────────────

const MSG1 = 'CONNECTION LOST';
const MSG2 = 'SERVER SHUTTING DOWN....';
const MSG3 = 'THE SERVER HAS GONE OFFLINE.';

export class GlitchSequencer {
  constructor(rainCanvas, msgCanvas, a11yEl) {
    this._rain    = new MatrixRain(rainCanvas);
    this._rCanvas = rainCanvas;
    this._mCanvas = msgCanvas;
    // alpha:true on message canvas — transparent so rain shows through (audit #42)
    this._mCtx    = msgCanvas.getContext('2d');
    this._a11y    = a11yEl;
    this._phase   = 'idle';
    this._chars   = [];
    this._msgFont = null;
    this._msgRaf  = null;
    this._W       = window.innerWidth;
    this._H       = window.innerHeight;
    this._dpr     = window.devicePixelRatio || 1;

    this._setupMsgCanvas();
    window.addEventListener('resize', () => this._setupMsgCanvas());
  }

  // forceAnimation: true bypasses prefers-reduced-motion (used by __matrixTest)
  async trigger(customMessage, { forceAnimation = false } = {}) {
    if (this._phase !== 'idle') return;
    this._phase = 'running';

    if (!forceAnimation && prefersReducedMotion()) {
      this._showStatic(customMessage);
      return;
    }

    // Cancel bgdrift animation before applying matrix transition (audit #18)
    document.body.style.animation = 'none';
    document.body.classList.add('matrix-transition');

    // Corrupt the app UI
    const app = document.querySelector('.app');
    if (app) app.classList.add('matrix-corrupting');

    // Pre-warm rain before it becomes visible, then start RAF loop (audit #15, #17)
    await this._rain.start();
    this._rain.startLoop();

    // Start message canvas draw loop
    this._startMsgLoop();

    // After 500ms, fade both canvases in
    await sleep(500);
    this._rCanvas.classList.add('active');
    this._mCanvas.classList.add('active');

    // Wait for corruption animation + rain fade-in to finish (~2200ms)
    await sleep(2200);

    // Phase 2: density build
    await sleep(600);

    // Phase 3: first message
    await this._showMessage(MSG1, false);
    await sleep(400);

    // Phase 4: second message
    await this._showMessage(MSG2, false);
    await sleep(400);

    // Phase 5: final message — permanent hold with micro-ripple
    await this._showMessage(MSG3, true);
  }

  // ── Message canvas setup ──────────────────────────────────────────────────

  _setupMsgCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const W   = window.innerWidth;
    const H   = window.innerHeight;
    this._dpr = dpr;
    this._W   = W;
    this._H   = H;

    this._mCanvas.width        = Math.round(W * dpr);
    this._mCanvas.height       = Math.round(H * dpr);
    this._mCanvas.style.width  = W + 'px';
    this._mCanvas.style.height = H + 'px';
    const ctx = this._mCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _startMsgLoop() {
    const ctx  = this._mCtx;
    const draw = () => {
      ctx.clearRect(0, 0, this._W, this._H);
      const now = performance.now();
      for (const ch of this._chars) this._tickChar(ch, ctx, now);
      ctx.shadowBlur  = 0;
      ctx.shadowColor = 'transparent';
      this._msgRaf = requestAnimationFrame(draw);
    };
    this._msgRaf = requestAnimationFrame(draw);
  }

  // ── Per-character tick ────────────────────────────────────────────────────

  _tickChar(ch, ctx, now) {
    if (ch.state === 'hidden' || ch.state === 'dead') return;
    if (ch.finalChar === ' ') return; // spaces are invisible — skip (audit #20)

    if (ch.state === 'assembling') this._tickAssembling(ch, now);
    if (ch.state === 'falling')    this._tickFalling(ch, now);
    if (ch.state === 'settled' && ch.microGlitch) this._tickMicroGlitch(ch, now);

    const pulseBlur = ch.state === 'settled'
      // Sinusoidal glow pulse using performance.now() — frame-rate independent (audit #31)
      ? 6 + 4 * Math.sin(now * 0.0025 + ch.phaseOffset)
      : 0;

    this._drawGlowChar(ctx, ch.currentChar, ch.x, ch.currentY, ch.fontSize, ch.flashT, ch.alpha, pulseBlur);
  }

  _tickAssembling(ch, now) {
    // Time-based glitch-in — does not compress at high refresh rates (audit #24)
    const elapsed = now - ch.activatedAt;
    if (elapsed < 233) {
      ch.currentChar = randChar();
      ch.flashT      = 0;
      ch.alpha       = 0.6;
    } else if (elapsed < 300) {
      ch.currentChar = ch.finalChar;
      ch.flashT      = (elapsed - 233) / 67;   // 0→1 white ramp
      ch.alpha       = 1.0;
    } else if (elapsed < 370) {
      ch.flashT      = 1 - (elapsed - 300) / 70; // 1→0 back to green
      ch.alpha       = 1.0;
    } else {
      ch.state       = 'settled';
      ch.currentChar = ch.finalChar;
      ch.flashT      = 0;
      ch.alpha       = 1.0;
    }
  }

  _tickFalling(ch, now) {
    const dt = Math.min((now - (ch._lastFallTick || now)) / 16.67, 3.0);
    ch._lastFallTick = now;

    const GRAVITY   = 0.4;
    const TERMINAL  = 35;
    ch.velY         = Math.min(ch.velY + GRAVITY * dt, TERMINAL);
    ch.currentY    += ch.velY * dt;

    // Alpha fades to 0 by the time char exits screen (audit #28)
    const screenH      = this._H;
    const fadeDistance = Math.max(screenH * 0.5, screenH - ch.startY + screenH * 0.15);
    ch.alpha           = Math.max(0, 1 - (ch.currentY - ch.startY) / fadeDistance);

    // Scramble chars during fall
    if (Math.random() < 0.08) ch.currentChar = randChar();

    if (ch.alpha <= 0 || ch.currentY > screenH + 60) ch.state = 'dead';
  }

  _tickMicroGlitch(ch, now) {
    // setTimeout-based revert — duration is in real ms, not frames (audit #32)
    if (now >= ch.microGlitchAt) {
      ch.microGlitchAt    = now + 1500 + Math.random() * 2500;
      const saved         = ch.finalChar;
      ch.currentChar      = randChar();
      ch.flashT           = 0.35;
      setTimeout(() => { ch.currentChar = saved; ch.flashT = 0; }, 33);
    }
  }

  // ── Multi-pass glow renderer (audit #33) ──────────────────────────────────

  _drawGlowChar(ctx, char, x, y, fontSize, flashT, alpha, extraBlur) {
    if (!char || char === ' ') return;
    // Interpolate rgb(0,255,65) → rgb(255,255,255) for lock-in flash (audit #23)
    const r  = Math.round(lerp(0,   255, flashT));
    const g  = 255;
    const b  = Math.round(lerp(65,  255, flashT));
    const a  = Math.max(0, Math.min(1, alpha));
    const eb = extraBlur || 0;

    ctx.font        = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
    ctx.textBaseline = 'middle'; // vertically centres on y coordinate (audit #25)

    // Pass 1 — wide outer halo
    ctx.shadowBlur  = 48 + eb;
    ctx.shadowColor = `rgba(0,255,65,${(0.22 * a).toFixed(2)})`;
    ctx.fillStyle   = `rgba(0,255,65,${(0.10 * a).toFixed(2)})`;
    ctx.fillText(char, x, y);

    // Pass 2 — mid glow
    ctx.shadowBlur  = 24 + eb * 0.5;
    ctx.shadowColor = `rgba(0,255,65,${(0.45 * a).toFixed(2)})`;
    ctx.fillStyle   = `rgba(0,255,65,${(0.30 * a).toFixed(2)})`;
    ctx.fillText(char, x, y);

    // Pass 3 — inner glow with color interpolated for flash
    ctx.shadowBlur  = 10;
    ctx.shadowColor = `rgba(0,255,65,${a.toFixed(2)})`;
    ctx.fillStyle   = `rgba(${r},${g},${b},${(0.82 * a).toFixed(2)})`;
    ctx.fillText(char, x, y);

    // Pass 4 — sharp opaque fill
    ctx.shadowBlur = 0;
    ctx.fillStyle  = `rgba(${r},${g},${b},${a.toFixed(2)})`;
    ctx.fillText(char, x, y);
  }

  // ── Layout calculation (audit #26, #27) ───────────────────────────────────

  _computeLayout(text) {
    const ctx = this._mCtx;
    const W   = this._W;
    const H   = this._H;

    // Responsive starting font size
    let fontSize = Math.min(56, Math.max(12, Math.round(W * 0.04)));

    // Shrink font until text fits within 92% of viewport width (audit #26)
    let colStride, totalWidth;
    for (let attempt = 0; attempt < 60; attempt++) {
      ctx.font   = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
      colStride  = ctx.measureText('ｦ').width; // measured advance (audit #27)
      totalWidth = text.length * colStride;
      if (totalWidth <= W * 0.92 || fontSize <= 12) break;
      fontSize--;
    }

    // Still overflows at min size — split into two lines (audit #26)
    if (totalWidth > W * 0.92 && fontSize <= 12) {
      return this._twoLineLayout(text, fontSize, colStride, W, H);
    }

    this._msgFont = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
    const startX  = (W - totalWidth) / 2;
    const centerY = H / 2;

    return [...text].map((char, i) => this._makeChar(char, startX + i * colStride, centerY, fontSize));
  }

  _twoLineLayout(text, fontSize, colStride, W, H) {
    // Split at last space at or before midpoint
    const mid      = Math.floor(text.length / 2);
    let splitAt    = text.lastIndexOf(' ', mid);
    if (splitAt <= 0) splitAt = text.indexOf(' ');
    if (splitAt <= 0) splitAt = mid; // no space — hard split

    const line1 = text.slice(0, splitAt).trimEnd();
    const line2 = text.slice(splitAt).trimStart();
    const lineH = fontSize * 1.6;

    const makeRow = (str, y) => {
      const tw     = str.length * colStride;
      const startX = (W - tw) / 2;
      return [...str].map((ch, i) => this._makeChar(ch, startX + i * colStride, y, fontSize));
    };

    this._msgFont = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
    return [
      ...makeRow(line1, H / 2 - lineH * 0.55),
      ...makeRow(line2, H / 2 + lineH * 0.55),
    ];
  }

  _makeChar(finalChar, x, y, fontSize) {
    return {
      finalChar,
      currentChar:    finalChar,
      x,
      y,
      currentY:       y,
      startY:         y,          // captured before fall begins (audit #8)
      alpha:          0,
      state:          'hidden',
      flashT:         0,
      activatedAt:    0,
      velY:           0.5,
      phaseOffset:    Math.random() * Math.PI * 2,
      microGlitch:    false,
      microGlitchAt:  0,
      fontSize,
      _lastFallTick:  0,
    };
  }

  // ── Message orchestration ─────────────────────────────────────────────────

  async _showMessage(text, hold) {
    // Update SR-only live region (audit #19)
    if (this._a11y) this._a11y.textContent = text;

    const chars = this._computeLayout(text);
    this._chars = chars;

    // Pause rain columns behind the message text (audit #40)
    const xs       = chars.filter(c => c.finalChar !== ' ').map(c => c.x);
    const xMin     = Math.min(...xs);
    const xMax     = Math.max(...xs) + (chars[0]?.fontSize || FONT_SIZE);
    const rainCols = this._rain.colsForRect(xMin, xMax);
    // Pause 500ms before ripple starts so decay naturally clears the zone
    this._rain.pause(rainCols);
    await sleep(500);

    // Ripple-in from center outward (audit #30 fix: center→out for entry)
    // Group chars per line for per-line center calculation
    const lines   = this._groupLines(chars);
    const rippleMs = await this._rippleIn(lines);

    // Wait for last char's glitch-in to complete + settle buffer
    await sleep(370 + 120);
    // Hold
    await sleep(800);

    if (hold) {
      // Enable micro-ripple for all settled chars (Phase 5) (audit #32)
      for (const ch of chars) {
        if (ch.state === 'settled') {
          ch.microGlitch   = true;
          ch.microGlitchAt = performance.now() + 1500 + Math.random() * 2500;
        }
      }
      return; // never falls
    }

    // Fall — edge-inward order (outermost characters fall first) (audit #30)
    await this._triggerFall(lines);

    // Wait for fall to complete
    await sleep(1000);

    this._rain.resume(rainCols);
    this._chars = [];
  }

  _groupLines(chars) {
    // Group chars by their y position (handles both 1-line and 2-line layout)
    const byY = new Map();
    for (const ch of chars) {
      const key = Math.round(ch.y);
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key).push(ch);
    }
    // Sort lines top-to-bottom
    return [...byY.values()].sort((a, b) => a[0].y - b[0].y);
  }

  async _rippleIn(lines) {
    // Fire all lines simultaneously, each with its own center
    let maxRing = 0;
    for (const line of lines) {
      const n      = line.length;
      const center = Math.floor((n - 1) / 2);
      const rings  = Math.max(center, n - 1 - center);
      if (rings > maxRing) maxRing = rings;
    }

    for (let ring = 0; ring <= maxRing; ring++) {
      for (const line of lines) {
        const n      = line.length;
        const center = Math.floor((n - 1) / 2);
        const indices = [];
        if (center - ring >= 0)          indices.push(center - ring);
        if (ring > 0 && center + ring < n) indices.push(center + ring);

        for (const i of indices) {
          const ch = line[i];
          if (ch.finalChar === ' ') {
            ch.state = 'settled'; ch.alpha = 0; // spaces skipped (audit #20)
          } else {
            ch.state       = 'assembling';
            ch.activatedAt = performance.now();
            ch.alpha       = 0.6;
          }
        }
      }
      if (ring < maxRing) await sleep(60);
    }
    return maxRing;
  }

  async _triggerFall(lines) {
    // Edge-inward: outermost ring falls first (audit #30 — "mirror of ripple-in"
    // is clarified to mean edge→center, making the message contract inward)
    let maxRing = 0;
    for (const line of lines) {
      const n = line.length;
      maxRing = Math.max(maxRing, Math.max(Math.floor((n - 1) / 2), n - 1 - Math.floor((n - 1) / 2)));
    }

    for (let ring = maxRing; ring >= 0; ring--) {
      for (const line of lines) {
        const n      = line.length;
        const center = Math.floor((n - 1) / 2);
        const indices = [];
        if (center - ring >= 0)          indices.push(center - ring);
        if (ring > 0 && center + ring < n) indices.push(center + ring);

        for (const i of indices) {
          const ch = line[i];
          if (ch.state === 'settled') {
            ch.state         = 'falling';
            ch.startY        = ch.currentY;
            ch._lastFallTick = performance.now();
            ch.velY          = 0.5;
          }
        }
      }
      if (ring > 0) await sleep(60);
    }
  }

  // ── Reduced motion fallback ───────────────────────────────────────────────

  _showStatic(customMessage) {
    // Cancel bgdrift and snap to black
    document.body.style.animation = 'none';
    document.body.classList.add('matrix-transition');
    const app = document.querySelector('.app');
    if (app) { app.style.opacity = '0'; app.style.pointerEvents = 'none'; }

    this._rCanvas.classList.add('active');
    this._mCanvas.classList.add('active');

    // Draw static text on message canvas
    const ctx = this._mCtx;
    const W   = this._W;
    const H   = this._H;
    ctx.clearRect(0, 0, W, H);
    ctx.font        = '24px "Share Tech Mono", "Courier New", monospace';
    ctx.fillStyle   = '#00ff41';
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'center';

    const messages = [MSG1, MSG2, MSG3];
    const lineH    = 40;
    const startY   = H / 2 - lineH;
    messages.forEach((m, i) => ctx.fillText(m, W / 2, startY + i * lineH));
    ctx.textAlign = 'left'; // reset

    if (this._a11y) this._a11y.textContent = messages.join('. ');
  }
}
