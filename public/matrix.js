/**
 * matrix.js — Matrix rain + shutdown thing for server shutdowns/disconnects client side
 *
 * has the MatrixRain class for the falling letters
 * and GlitchSequencer for the whole shutdown sequence
 * also a randChar function that picks random matrix chars
 *
 * Load it with <script type="module"> in client.js
 */

// the different characters we can use
const KATAKANA = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const LATIN   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS  = '0123456789';
const SYMBOLS = '@#$%&*!?<>/\\|[]{}';

// picks a random character, tries to do more japanese ones
export function randChar() {
  const r = Math.random();
  if (r < 0.50) return KATAKANA[Math.floor(Math.random() * KATAKANA.length)];
  if (r < 0.70) return LATIN[Math.floor(Math.random() * LATIN.length)];
  if (r < 0.90) return DIGITS[Math.floor(Math.random() * DIGITS.length)];
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

// just a helper to go between two numbers
function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// waits a bit
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// checks if the user wants less animation
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// the main rain class
const FONT_SIZE = 13; // size of the letters

export class MatrixRain {
  constructor(canvas) {
    this._canvas    = canvas;
    // get the drawing context, no transparency needed
    this._ctx       = canvas.getContext('2d', { alpha: false });
    this._cols      = [];
    this._rafId     = null;
    this._lastTs    = 0;
    this._colStride = FONT_SIZE;
    this._W         = 0;
    this._H         = 0;
    this._dpr       = 1;
    this._running   = false;
    this._msgZone   = null;   // where the message is so we can make rain glow more
    this._spikeNext = 50;     // how many frames until next glow thing
    this._frame     = 0;
    this._baseFont  = `${FONT_SIZE}px "Share Tech Mono", "Courier New", monospace`;
    this._resizeTimer = null;  // for debounced resize
  }

  async start() {
    // try to load the font, if it fails just use normal one
    try { await document.fonts.load(this._baseFont); } catch (_) { /* use fallback */ }
    this._resize();
    // debounce resize so rapid window drags dont thrash
    window.addEventListener('resize', () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._resize(), 32);
    });
    // run some fake frames so it doesnt start empty
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

  // tell the rain where the message text is so it can glow more there
  setMessageZone(x1, x2, centerY) {
    this._msgZone = { x1, x2, centerY };
  }

  clearMessageZone() {
    this._msgZone = null;
  }

  // private stuff

  _resize() {
    const firstInit = this._cols.length === 0;
    const dpr = window.devicePixelRatio || 1;
    const W   = window.innerWidth;
    const H   = window.innerHeight;
    this._dpr = dpr;
    this._W   = W;
    this._H   = H;

    // set the canvas size for high dpi screens
    this._canvas.width        = Math.round(W * dpr);
    this._canvas.height       = Math.round(H * dpr);
    this._canvas.style.width  = W + 'px';
    this._canvas.style.height = H + 'px';
    const ctx = this._ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // figure out how wide each column should be
    ctx.font        = this._baseFont;
    ctx.textBaseline = 'top';
    this._colStride = Math.max(8, Math.ceil(ctx.measureText('ｦ').width));

    if (firstInit) {
      // first time, make all the columns
      this._initCols(W, H);
      return;
    }

    // if window size changed, keep the old columns and just add or remove some
    const needed = Math.ceil(W / this._colStride) + 2;
    for (let i = 0; i < this._cols.length; i++) {
      this._cols[i].x = i * this._colStride; // update the x position
    }
    while (this._cols.length < needed) {
      this._cols.push(this._makeCol(this._cols.length * this._colStride, H, false));
    }
    if (this._cols.length > needed) this._cols.length = needed;
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
    const streamLen = this._randStreamLen(H);
    return {
      x,
      // start them at random heights so the screen fills up right away
      headY:          staggered ? Math.random() * H : 0,
      speed:          0.8 + Math.random() * 2.2,
      streamLen,
      chars:          Array.from({ length: streamLen }, () => randChar()),
      mutateInterval: 2 + Math.floor(Math.random() * 5),
      mutateTimer:    0,
      glowIntensity:  0.6 + Math.random() * 0.4,
      glowSpikeTimer: 0,
    };
  }

  _randStreamLen(H) {
    // make the streams long enough to cover the whole screen
    const screenRows = Math.ceil((H || this._H || 900) / FONT_SIZE);
    // add a little extra so they dont all end at the same place
    return screenRows + 2 + Math.floor(Math.random() * 20);
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
        // if it goes off the bottom, reset it
        if (col.headY > H + FONT_SIZE * 4) this._resetCol(col, H);
      }
      ctx.shadowBlur  = 0;
      ctx.shadowColor = 'transparent';
    }
  }

  _tick(ts) {
    if (!this._running) return;
    const elapsed = ts - this._lastTs;
    this._lastTs  = ts;
    // dont let the time jump too much if the tab was in background
    const dt = Math.min(elapsed / 16.67, 3.0);

    const ctx = this._ctx;
    const W   = this._W;
    const H   = this._H;
    this._frame++;

    // fade the old stuff a bit so we get trails
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.15, 0.05 * dt)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.font        = this._baseFont;
    ctx.textBaseline = 'top';

    // every once in a while make one column glow brighter
    this._spikeNext -= dt;
    if (this._spikeNext <= 0) {
      this._spikeNext = 40 + Math.random() * 20;
      const ci = Math.floor(Math.random() * this._cols.length);
      if (this._cols[ci]) { this._cols[ci].glowSpikeTimer = 3; this._cols[ci].glowIntensity = 1.4; }
    }

    for (const col of this._cols) {
      // count down the glow spike
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
    let headDrawn = false;

    for (let j = 0; j < col.streamLen; j++) {
      const charY = col.headY - j * FONT_SIZE;
      if (charY + FONT_SIZE < 0 || charY > H) continue;

      const t          = j / col.streamLen;           // 0 is the front, 1 is the end
      // keep the end a little visible so it doesnt look empty
      const brightness = Math.max(0.05, 1 - t);
      // integer conversion, same result as floor(lerp(30,255,brightness))
      const green      = (30 + (225 * brightness)) | 0;
      const alpha      = lerp(0.10, 0.92, brightness);

      if (j === 0) {
        // if the head is near the message, make it glow more
        let effectiveGlow = col.glowIntensity;
        if (this._msgZone) {
          const mz = this._msgZone;
          if (col.x >= mz.x1 - this._colStride * 3 && col.x <= mz.x2 + this._colStride * 3) {
            const dist = Math.abs(charY - mz.centerY);
            if (dist < 80) {
              effectiveGlow = Math.min(2.0, effectiveGlow + (1 - dist / 80) * 1.2);
            }
          }
        }
        // the front character gets the glow - only set shadow here
        ctx.shadowBlur  = (spiking ? 22 : 15) * effectiveGlow;
        ctx.shadowColor = '#00ff41';
        ctx.fillStyle   = (spiking || effectiveGlow > 1.2) ? 'rgb(255,255,255)' : 'rgb(230,255,230)';
        ctx.fillText(col.chars[j], col.x, charY);
        // turn shadow off immediately after the head so trailing chars never pay the cost
        ctx.shadowBlur  = 0;
        ctx.shadowColor = 'transparent';
        headDrawn = true;
      } else {
        // trailing characters - shadow is already 0
        ctx.fillStyle = `rgba(0,${green},${(green * 0.08) | 0},${alpha.toFixed(2)})`;
        ctx.fillText(col.chars[j], col.x, charY);
      }
    }
    // safety reset if no head was drawn this column (offscreen head)
    if (!headDrawn) {
      ctx.shadowBlur  = 0;
      ctx.shadowColor = 'transparent';
    }
  }

  _mutateCol(col) {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < count; k++) {
      col.chars[Math.floor(Math.random() * col.streamLen)] = randChar();
    }
  }

  _resetCol(col, H) {
    // start it back at the top
    col.headY          = 0;
    col.speed          = 0.8 + Math.random() * 2.2;
    const newLen       = this._randStreamLen(H);
    // reuse the existing chars array when possible to avoid allocation
    if (col.chars && col.chars.length >= newLen) {
      for (let i = 0; i < newLen; i++) {
        col.chars[i] = randChar();
      }
    } else {
      col.chars = Array.from({ length: newLen }, () => randChar());
    }
    col.streamLen      = newLen;
    col.glowIntensity  = 0.6 + Math.random() * 0.4;
    col.glowSpikeTimer = 0;
  }
}

// the sequence that shows the messages and does the glitch stuff
const MSG1 = 'CONNECTION LOST';
const MSG2 = 'SERVER SHUTTING DOWN....';
const MSG3 = 'THE SERVER HAS GONE OFFLINE.';

export class GlitchSequencer {
  constructor(rainCanvas, msgCanvas, a11yEl) {
    this._rain    = new MatrixRain(rainCanvas);
    this._rCanvas = rainCanvas;
    this._mCanvas = msgCanvas;
    // message canvas needs transparency so rain shows through
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

  // forceAnimation is for testing so we can skip the reduced motion check
  async trigger(customMessage, { forceAnimation = false } = {}) {
    if (this._phase !== 'idle') return;
    this._phase = 'running';

    if (!forceAnimation && prefersReducedMotion()) {
      this._showStatic(customMessage);
      return;
    }

    // stop the background animation
    document.body.style.animation = 'none';
    document.body.classList.add('matrix-transition');

    // make the app look broken
    const app = document.querySelector('.app');
    if (app) app.classList.add('matrix-corrupting');

    // start the rain
    await this._rain.start();
    this._rain.startLoop();

    // start drawing the messages
    this._startMsgLoop();

    // wait a bit then show the canvases
    await sleep(500);
    this._rCanvas.classList.add('active');
    this._mCanvas.classList.add('active');

    // wait for the corruption to finish
    await sleep(2200);

    // wait a little more
    await sleep(600);

    // show first message
    await this._showMessage(MSG1, false);
    await sleep(400);

    // show second message
    await this._showMessage(MSG2, false);
    await sleep(400);

    // show the last message and keep it
    await this._showMessage(MSG3, true);
  }

  // set up the message canvas size
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

  // update one character
  _tickChar(ch, ctx, now) {
    if (ch.state === 'hidden' || ch.state === 'dead') return;
    if (ch.finalChar === ' ') return; // skip spaces

    if (ch.state === 'assembling') this._tickAssembling(ch, now);
    if (ch.state === 'falling')    this._tickFalling(ch, now);
    if (ch.state === 'settled' && ch.microGlitch) this._tickMicroGlitch(ch, now);

    const pulseBlur = ch.state === 'settled'
      // make the settled ones pulse a little
      ? 6 + 4 * Math.sin(now * 0.0025 + ch.phaseOffset)
      : 0;

    this._drawGlowChar(ctx, ch.currentChar, ch.x, ch.currentY, ch.fontSize, ch.flashT, ch.alpha, pulseBlur);
  }

  _tickAssembling(ch, now) {
    // the glitch in animation for each letter
    const elapsed = now - ch.activatedAt;
    if (elapsed < 233) {
      ch.currentChar = randChar();
      ch.flashT      = 0;
      ch.alpha       = 0.6;
    } else if (elapsed < 300) {
      ch.currentChar = ch.finalChar;
      ch.flashT      = (elapsed - 233) / 67;   // go white
      ch.alpha       = 1.0;
    } else if (elapsed < 370) {
      ch.flashT      = 1 - (elapsed - 300) / 70; // back to green
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

    // fade out as it falls
    const screenH      = this._H;
    const fadeDistance = Math.max(screenH * 0.5, screenH - ch.startY + screenH * 0.15);
    ch.alpha           = Math.max(0, 1 - (ch.currentY - ch.startY) / fadeDistance);

    // sometimes change the letter while falling
    if (Math.random() < 0.08) ch.currentChar = randChar();

    if (ch.alpha <= 0 || ch.currentY > screenH + 60) ch.state = 'dead';
  }

  _tickMicroGlitch(ch, now) {
    // every now and then glitch a settled letter for a second
    if (now >= ch.microGlitchAt) {
      ch.microGlitchAt    = now + 1500 + Math.random() * 2500;
      const saved         = ch.finalChar;
      ch.currentChar      = randChar();
      ch.flashT           = 0.35;
      setTimeout(() => { ch.currentChar = saved; ch.flashT = 0; }, 33);
    }
  }

  // draws a glowing character with a few passes
  _drawGlowChar(ctx, char, x, y, fontSize, flashT, alpha, extraBlur) {
    if (!char || char === ' ') return;
    // mix between green and white for the flash
    const r  = Math.round(lerp(0,   255, flashT));
    const g  = 255;
    const b  = Math.round(lerp(65,  255, flashT));
    const a  = Math.max(0, Math.min(1, alpha));
    const eb = extraBlur || 0;

    ctx.font        = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
    ctx.textBaseline = 'middle'; // center it vertically

    // outer glow
    ctx.shadowBlur  = 48 + eb;
    ctx.shadowColor = `rgba(0,255,65,${(0.22 * a).toFixed(2)})`;
    ctx.fillStyle   = `rgba(0,255,65,${(0.10 * a).toFixed(2)})`;
    ctx.fillText(char, x, y);

    // middle glow
    ctx.shadowBlur  = 24 + eb * 0.5;
    ctx.shadowColor = `rgba(0,255,65,${(0.45 * a).toFixed(2)})`;
    ctx.fillStyle   = `rgba(0,255,65,${(0.30 * a).toFixed(2)})`;
    ctx.fillText(char, x, y);

    // inner glow
    ctx.shadowBlur  = 10;
    ctx.shadowColor = `rgba(0,255,65,${a.toFixed(2)})`;
    ctx.fillStyle   = `rgba(${r},${g},${b},${(0.82 * a).toFixed(2)})`;
    ctx.fillText(char, x, y);

    // the actual letter
    ctx.shadowBlur = 0;
    ctx.fillStyle  = `rgba(${r},${g},${b},${a.toFixed(2)})`;
    ctx.fillText(char, x, y);
  }

  // figure out where to put the letters
  _computeLayout(text) {
    const ctx = this._mCtx;
    const W   = this._W;
    const H   = this._H;

    // start with a decent size
    let fontSize = Math.min(56, Math.max(12, Math.round(W * 0.04)));

    // make it smaller if it doesnt fit
    let colStride, totalWidth;
    for (let attempt = 0; attempt < 60; attempt++) {
      ctx.font   = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
      colStride  = ctx.measureText('ｦ').width;
      totalWidth = text.length * colStride;
      if (totalWidth <= W * 0.92 || fontSize <= 12) break;
      fontSize--;
    }

    // if still too big, split into two lines
    if (totalWidth > W * 0.92 && fontSize <= 12) {
      return this._twoLineLayout(text, fontSize, colStride, W, H);
    }

    this._msgFont = `${fontSize}px "Share Tech Mono", "Courier New", monospace`;
    const startX  = (W - totalWidth) / 2;
    const centerY = H / 2;

    return [...text].map((char, i) => this._makeChar(char, startX + i * colStride, centerY, fontSize));
  }

  _twoLineLayout(text, fontSize, colStride, W, H) {
    // try to split at a space near the middle
    const mid      = Math.floor(text.length / 2);
    let splitAt    = text.lastIndexOf(' ', mid);
    if (splitAt <= 0) splitAt = text.indexOf(' ');
    if (splitAt <= 0) splitAt = mid; // no space, just split in half

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
      startY:         y,          // remember where it started for the fall
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

  // show a message
  async _showMessage(text, hold) {
    // update the screen reader thing
    if (this._a11y) this._a11y.textContent = text;

    const chars = this._computeLayout(text);
    this._chars = chars;

    // tell the rain where the text is
    const xs      = chars.filter(c => c.finalChar !== ' ').map(c => c.x);
    const xMin    = Math.min(...xs);
    const xMax    = Math.max(...xs) + (chars[0]?.fontSize || FONT_SIZE);
    const centerY = chars[0]?.y ?? this._H / 2;
    this._rain.setMessageZone(xMin, xMax, centerY);

    // make the letters appear from the middle out
    const lines = this._groupLines(chars);
    await this._rippleIn(lines);

    // wait for the last letter to finish
    await sleep(370 + 120);
    // hold for a bit
    await sleep(800);

    if (hold) {
      // make them glitch a little forever
      for (const ch of chars) {
        if (ch.state === 'settled') {
          ch.microGlitch   = true;
          ch.microGlitchAt = performance.now() + 1500 + Math.random() * 2500;
        }
      }
      return; // dont fall
    }

    // make them fall from the edges in
    await this._triggerFall(lines);

    // wait then clean up
    await sleep(1000);
    this._rain.clearMessageZone();
    this._chars = [];
  }

  _groupLines(chars) {
    // put letters on the same line together
    const byY = new Map();
    for (const ch of chars) {
      const key = Math.round(ch.y);
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key).push(ch);
    }
    // sort top to bottom
    return [...byY.values()].sort((a, b) => a[0].y - b[0].y);
  }

  async _rippleIn(lines) {
    // start from the center of each line and go outward
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
            ch.state = 'settled'; ch.alpha = 0; // spaces are invisible
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
    // start from the outside and go in
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

  // if the user has reduced motion, just show the text
  _showStatic(customMessage) {
    // stop background animation and go black
    document.body.style.animation = 'none';
    document.body.classList.add('matrix-transition');
    const app = document.querySelector('.app');
    if (app) { app.style.opacity = '0'; app.style.pointerEvents = 'none'; }

    this._rCanvas.classList.add('active');
    this._mCanvas.classList.add('active');

    // just draw the three messages
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
    ctx.textAlign = 'left'; // put it back

    if (this._a11y) this._a11y.textContent = messages.join('. ');
  }
}
