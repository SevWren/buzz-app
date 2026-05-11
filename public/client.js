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

// Development test hook — call window.__matrixTest() in browser console
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__matrixTest = (msg) => sequencer.trigger(msg ?? 'Test shutdown message.');
}

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

  sequencer.trigger(message ?? 'Server is shutting down.');
});

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
