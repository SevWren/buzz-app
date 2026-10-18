import { GlitchSequencer } from './matrix.js';

const socket = io({ reconnectionDelayMax: 10_000 });

// --- DOM refs ---
const connDot   = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const msgInput  = document.getElementById('msg-input');
const btnBuzz   = document.getElementById('btn-buzz');
const btnSend   = document.getElementById('btn-send');
const logList   = document.getElementById('log-list');
const logEmpty  = document.getElementById('log-empty');
const btnClear  = document.getElementById('btn-clear');

// --- Matrix sequencer ---
const sequencer = new GlitchSequencer(
  document.getElementById('matrix-rain-canvas'),
  document.getElementById('matrix-msg-canvas'),
  document.getElementById('matrix-a11y'),
);

// Debug hook — always registered on window.
// Bypasses prefers-reduced-motion so the full animation is visible regardless
// of OS accessibility settings. Works from any hostname (localhost, LAN IP, etc).
// Usage: window.__matrixTest()  or  window.__matrixTest('custom message')
window.__matrixTest = (msg) => sequencer.trigger(msg ?? 'Test shutdown message.', { forceAnimation: true });

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

  // Don't trigger matrix when the client intentionally disconnected itself.
  if (reason === 'io client disconnect') return;

  // Delay to avoid showing the Matrix for brief reconnection blips.
  // If, after 1200ms, the socket is still disconnected, show the Matrix takeover.
  setTimeout(() => {
    if (!socket.connected) {
      // Make #matrix-scene scanlines visible (same as server-shutdown flow)
      document.getElementById('matrix-scene').classList.add('active');

      // Trigger sequencer; respect prefers-reduced-motion by default.
      sequencer.trigger('Connection lost — attempting to reconnect or offline.', { forceAnimation: false });
    }
  }, 1200);
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

// --- Server shutdown — Matrix takeover ---
socket.on('server-shutdown', ({ message }) => {
  // Remove all socket listeners to prevent reconnect side-effects (audit #43)
  socket.off('connect');
  socket.off('disconnect');
  socket.off('connect_error');
  socket.off('ack');
  socket.disconnect();

  // Also make #matrix-scene scanlines visible
  document.getElementById('matrix-scene').classList.add('active');

  const shutdownMsg = message ?? 'Server is shutting down.';

  // For explicit server-initiated shutdowns we force the animation so the
  // full Matrix sequence plays even if the OS has prefers-reduced-motion set.
  // This is intentional: a server shutdown is a critical UI state.
  sequencer.trigger(shutdownMsg, { forceAnimation: true }).catch(() => {});

  // Watchdog: if the canvases never became visible (blank screen), fall back
  // to the static draw so the user still sees the shutdown message.
  setTimeout(() => {
    const rCanvas = document.getElementById('matrix-rain-canvas');
    const mCanvas = document.getElementById('matrix-msg-canvas');
    const active = (rCanvas && rCanvas.classList.contains('active')) ||
                   (mCanvas && mCanvas.classList.contains('active'));
    if (!active) {
      // Prefer the sequencer's internal static-draw helper if available.
      if (typeof sequencer._showStatic === 'function') {
        try { sequencer._showStatic(shutdownMsg); } catch (_) { /* ignore */ }
      } else {
        // Best-effort fallback: make canvases visible so the CSS shows a black
        // background and at least the matrix scene overlay is present.
        if (rCanvas) rCanvas.classList.add('active');
        if (mCanvas) mCanvas.classList.add('active');
      }
    }
  }, 2500);
});

// ────────────────────────────────────────────────────────────────[...]

// Whitelist of valid log types.  Building a class name from an unvalidated
// server-supplied string would allow a compromised server to inject arbitrary
// CSS classes into the DOM (e.g. to override styling or trigger CSS selector
// attacks in future content-security-policy-free contexts).
const VALID_LOG_TYPES = new Set(['client', 'server', 'error', 'system']);

function addLog(type, text) {
  // Detach the empty state placeholder so it doesn't interfere with child limits
  if (logList.contains(logEmpty)) {
    logEmpty.remove();
  }

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
  while (logList.children.length > 100) {
    logList.removeChild(logList.lastChild);
  }
}
