const socket = io({ reconnectionDelayMax: 10_000 });

// --- DOM refs ---
const connDot  = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const msgInput  = document.getElementById('msg-input');
const btnBuzz   = document.getElementById('btn-buzz');
const btnSend   = document.getElementById('btn-send');
const logList   = document.getElementById('log-list');
const logEmpty  = document.getElementById('log-empty');
const btnClear  = document.getElementById('btn-clear');

// --- Connection lifecycle ---
socket.on('connect', () => {
  setConnState('connected', 'Connected');
  setButtons(true);
  addLog('system', 'Connected to server');
  msgInput.focus();
});

socket.on('disconnect', (reason) => {
  setConnState('disconnected', 'Disconnected');
  setButtons(false);
  addLog('system', `Disconnected: ${reason}`);
});

socket.on('connect_error', () => {
  setConnState('connecting', 'Reconnecting...');
  setButtons(false);
});

// --- Server acknowledgements ---
socket.on('ack', ({ type, message }) => {
  addLog(type === 'error' ? 'error' : 'server', message);
});

// --- Button actions ---
btnBuzz.addEventListener('click', () => {
  socket.emit('buzz-dad');
  addLog('client', 'Buzz Dad sent');
});

btnSend.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

btnClear.addEventListener('click', () => {
  logList.innerHTML = '';
  logList.appendChild(logEmpty);
  logEmpty.style.display = '';
});

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('send-message', { text });
  addLog('client', `You: "${text}"`);
  msgInput.value = '';
  msgInput.focus();
}

// --- Helpers ---
function setConnState(state, label) {
  connDot.className = `conn-dot ${state}`;
  connLabel.textContent = label;
}

function setButtons(enabled) {
  btnBuzz.disabled = !enabled;
  btnSend.disabled = !enabled;
}

// --- Server shutdown — glitch takeover ---
socket.on('server-shutdown', ({ message }) => {
  triggerGlitchTakeover(message ?? 'Server is shutting down.');
});

// ─────────────────────────────────────────────────────────────────────────────
// Glitch System Takeover
// Three-phase sequence:
//   Phase 1 (0–500 ms)   — .app gets .glitching: horizontal tears, color
//                          inversions, static flash via CSS @keyframes
//   Phase 2 (500 ms+)    — overlay snaps in; canvas radial pulse starts
//   Phase 3 (600 ms+)    — typewriter scramble resolves the message text
// ─────────────────────────────────────────────────────────────────────────────

function triggerGlitchTakeover(message) {
  const app     = document.querySelector('.app');
  const overlay = document.getElementById('glitch-overlay');

  // Clamp message length so the typewriter doesn't run indefinitely
  const text = String(message).slice(0, 120);

  // Phase 1 — tear the existing UI
  app.classList.add('glitching');

  setTimeout(() => {
    // Phase 2 — snap to error screen
    app.classList.remove('glitching');
    overlay.removeAttribute('hidden');
    startRadialPulse();

    // Brief pause lets the snap register visually before text starts
    setTimeout(() => {
      const el = document.getElementById('glitch-message');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = text; // skip scramble for motion-sensitive users
      } else {
        typewriterScramble(el, text);
      }
    }, 100);
  }, 500);
}

// Animates an expanding, fading radial gradient on the overlay canvas.
// Each pulse cycle: radius grows 0 → max, alpha fades 0.28 → 0, then repeats.
function startRadialPulse() {
  const canvas = document.getElementById('glitch-canvas');
  const ctx    = canvas.getContext('2d');
  if (!ctx) return; // canvas unsupported — overlay text still shows

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();

  // ResizeObserver is more accurate than window resize for canvas sizing
  new ResizeObserver(resize).observe(canvas);

  let phase = 0; // 0–1, drives the pulse cycle

  (function draw() {
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const maxRadius = Math.hypot(width, height) * 0.72;
    const radius    = maxRadius * phase;
    const alpha     = 0.28 * (1 - phase);

    const grad = ctx.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, radius
    );
    grad.addColorStop(0,   `rgba(220, 40, 40, ${alpha})`);
    grad.addColorStop(0.5, `rgba(140,  0,  0, ${alpha * 0.5})`);
    grad.addColorStop(1,   'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // ~0.004 per frame at 60 fps = ~4.2 s per full cycle
    phase += 0.004;
    if (phase > 1) phase = 0;

    requestAnimationFrame(draw);
  })();
}

// Resolves characters one at a time, cycling through random glyphs before
// each character locks in. Already-resolved characters occasionally re-glitch
// for a brief moment to keep the text feeling unstable throughout.
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*<>/\\|[]{}';

function typewriterScramble(el, finalText) {
  const chars        = [...finalText];
  const resolved     = Array(chars.length).fill('');
  let   resolvedIdx  = 0;
  let   frameTicks   = 0;

  // Each frontier character scrambles for this many ~16 ms ticks before locking
  const SCRAMBLE_TICKS = 8;

  function rand(str) {
    return str[Math.floor(Math.random() * str.length)];
  }

  (function tick() {
    if (resolvedIdx >= chars.length) return;

    frameTicks++;

    if (frameTicks >= SCRAMBLE_TICKS) {
      // Lock the frontier character in
      resolved[resolvedIdx] = chars[resolvedIdx];
      resolvedIdx++;
      frameTicks = 0;
    } else {
      // Show a scrambled glyph at the frontier
      resolved[resolvedIdx] = rand(SCRAMBLE_CHARS);
    }

    // 1 % chance each resolved character re-glitches briefly
    for (let i = 0; i < resolvedIdx - 1; i++) {
      if (Math.random() < 0.01) {
        const saved = resolved[i];
        resolved[i] = rand(SCRAMBLE_CHARS);
        setTimeout(() => { resolved[i] = saved; }, 80);
      }
    }

    el.textContent = resolved.join('');
    setTimeout(tick, 16); // target ~60 fps
  })();
}

// ─────────────────────────────────────────────────────────────────────────────

// Whitelist of valid log types.  Building a class name from an unvalidated
// server-supplied string would allow a compromised server to inject arbitrary
// CSS classes into the DOM (e.g. to override styling or trigger CSS selector
// attacks in future content-security-policy-free contexts).
const VALID_LOG_TYPES = new Set(['client', 'server', 'error', 'system']);

function addLog(type, text) {
  logEmpty.style.display = 'none';

  const safeType = VALID_LOG_TYPES.has(type) ? type : 'system';
  const item = document.createElement('li');
  item.className = `log-item log-${safeType}`;

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toLocaleTimeString();

  const msg = document.createElement('span');
  msg.className = 'log-text';
  msg.textContent = text; // textContent — no innerHTML, no XSS

  item.append(time, msg);
  logList.prepend(item);

  // Cap log at 100 visible entries
  while (logList.children.length > 101) {
    logList.removeChild(logList.lastChild);
  }
}
