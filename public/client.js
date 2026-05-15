import { GlitchSequencer } from './matrix.js';

const socket = io({ reconnectionDelayMax: 10_000 });

// ── DOM refs ──────────────────────────────────────────────────────────────────
const connDot   = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const msgInput  = document.getElementById('msg-input');
const btnBuzz   = document.getElementById('btn-buzz');
const btnSend   = document.getElementById('btn-send');

// Quick need
const quickNeedBtns = document.querySelectorAll('.btn-need');

// Status
const statusBtns = document.querySelectorAll('.btn-status');

// Location + Battery
const btnLocation = document.getElementById('btn-location');
const btnBattery  = document.getElementById('btn-battery');

// Countdown
const countdownBtns      = document.querySelectorAll('.btn-countdown');
const countdownDisplay   = document.getElementById('countdown-display');
const countdownText      = document.getElementById('countdown-text');
const btnCountdownCancel = document.getElementById('btn-countdown-cancel');

// Thread
const threadList     = document.getElementById('thread-list');
const threadEmpty    = document.getElementById('thread-empty');
const btnClearThread = document.getElementById('btn-clear-thread');

// ── Matrix sequencer ──────────────────────────────────────────────────────────
const sequencer = new GlitchSequencer(
  document.getElementById('matrix-rain-canvas'),
  document.getElementById('matrix-msg-canvas'),
  document.getElementById('matrix-a11y'),
);

// Debug hook — bypasses prefers-reduced-motion for testing
window.__matrixTest = (msg) => sequencer.trigger(msg ?? 'Test shutdown message.', { forceAnimation: true });

// ── State ─────────────────────────────────────────────────────────────────────
let countdownTimer   = null; // setInterval handle
let countdownEndTime = null; // epoch ms when countdown expires

// ── Connection lifecycle ──────────────────────────────────────────────────────
socket.on('connect', () => {
  setConnState('connected', 'Connected');
  setButtons(true);
  addBubble({ id: null, ts: new Date().toISOString(), direction: 'system', type: 'system', payload: { text: 'Connected to server' } });
  msgInput.focus();
});

socket.on('disconnect', (reason) => {
  setConnState('disconnected', 'Disconnected');
  setButtons(false);
  addBubble({ id: null, ts: new Date().toISOString(), direction: 'system', type: 'system', payload: { text: `Disconnected: ${reason}` } });
  // Clear any active countdown so timers don't accumulate across reconnects
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countdownEndTime = null;
  countdownDisplay.hidden = true;
  countdownText.textContent = '';
});

socket.on('connect_error', () => {
  setConnState('connecting', 'Reconnecting…');
  setButtons(false);
});

// ── Incoming: Dad's replies ───────────────────────────────────────────────────
socket.on('incoming-message', (msg) => {
  if (msg.direction === 'out') {
    // Dad's reply — render on son's thread
    addBubble(msg);
    threadList.scrollTop = threadList.scrollHeight;
  }
  // direction: 'in' messages are already rendered optimistically on button press
});

// ── Read receipts ─────────────────────────────────────────────────────────────
socket.on('messages-read', () => {
  // Show "✓ Seen" on the most recent inbound bubble
  const allInBubbles = threadList.querySelectorAll('.bubble-in');
  const lastIn = allInBubbles[allInBubbles.length - 1];
  if (!lastIn) return;
  let receipt = lastIn.querySelector('.read-receipt');
  if (!receipt) {
    receipt = document.createElement('span');
    receipt.className = 'read-receipt';
    const meta = lastIn.querySelector('.bubble-meta');
    if (meta) meta.appendChild(receipt);
  }
  receipt.textContent = '✓ Seen';
});

// ── Button handlers ───────────────────────────────────────────────────────────

// Buzz Dad
btnBuzz.addEventListener('click', () => {
  socket.emit('buzz-dad');
  addBubble({ id: Date.now().toString(), ts: new Date().toISOString(),
    direction: 'in', type: 'buzz', payload: {} });
});

// Send message
btnSend.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Quick Need
for (const btn of quickNeedBtns) {
  btn.addEventListener('click', () => {
    const need = btn.dataset.need;
    socket.emit('quick-need', { need }, (resp) => {
      if (!resp?.ok) addErrorBubble(resp?.error ?? 'Failed to send.');
    });
    addBubble({ id: Date.now().toString(), ts: new Date().toISOString(),
      direction: 'in', type: 'quick-need', payload: { need } });
  });
}

// Status Stamp
for (const btn of statusBtns) {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    const label = btn.dataset.label;
    socket.emit('set-status', { emoji, label }, (resp) => {
      if (!resp?.ok) addErrorBubble(resp?.error ?? 'Failed to send.');
    });
    addBubble({ id: Date.now().toString(), ts: new Date().toISOString(),
      direction: 'in', type: 'status', payload: { emoji, label } });
  });
}

// Location Ping
btnLocation.addEventListener('click', () => {
  if (!navigator.geolocation) {
    addErrorBubble('Geolocation is not supported by this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const { latitude: lat, longitude: lng, accuracy } = coords;
      socket.emit('location-ping', { lat, lng, accuracy }, (resp) => {
        if (!resp?.ok) addErrorBubble(resp?.error ?? 'Failed to send.');
      });
      addBubble({ id: Date.now().toString(), ts: new Date().toISOString(),
        direction: 'in', type: 'location', payload: { lat, lng, accuracy } });
    },
    (err) => {
      // GeolocationPositionError.message is not standardised — map the numeric
      // code to a readable string instead so all browsers show a useful message.
      const GEO_ERRORS = {
        1: 'Location access denied — please allow permission and try again.',
        2: 'Location unavailable — device could not determine position.',
        3: 'Location request timed out — please try again.',
      };
      addErrorBubble(GEO_ERRORS[err.code] ?? `Location error (code ${err.code}).`);
    },
    { timeout: 10_000, maximumAge: 30_000 },
  );
});

// Battery Low
btnBattery.addEventListener('click', async () => {
  let level = null;
  try {
    if ('getBattery' in navigator) {
      const battery = await navigator.getBattery();
      level = battery.level; // 0.0–1.0
    }
  } catch {
    // Battery API disabled (iOS Safari, some Firefox) — level stays null
  }
  socket.emit('battery-low', { level }, (resp) => {
    if (!resp?.ok) addErrorBubble(resp?.error ?? 'Failed to send.');
  });
  addBubble({ id: Date.now().toString(), ts: new Date().toISOString(),
    direction: 'in', type: 'battery-low', payload: { level } });
});

// Countdown
for (const btn of countdownBtns) {
  btn.addEventListener('click', () => {
    const minutes = Number(btn.dataset.minutes);
    startCountdown(minutes);
    socket.emit('countdown-start', { minutes }, (resp) => {
      if (!resp?.ok) addErrorBubble(resp?.error ?? 'Failed to send.');
    });
    addBubble({ id: Date.now().toString(), ts: new Date().toISOString(),
      direction: 'in', type: 'countdown', payload: { minutes } });
  });
}

btnCountdownCancel.addEventListener('click', () => {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countdownEndTime = null;
  countdownDisplay.hidden = true;
  countdownText.textContent = '';
});

// Clear thread
btnClearThread.addEventListener('click', () => {
  threadList.innerHTML = '';
  threadList.appendChild(threadEmpty);
});

// ── Server shutdown — Matrix takeover ────────────────────────────────────────
socket.on('server-shutdown', ({ message }) => {
  // Remove all socket listeners to prevent reconnect side-effects
  socket.off('connect');
  socket.off('disconnect');
  socket.off('connect_error');
  socket.off('incoming-message');
  socket.off('messages-read');
  socket.disconnect();

  // Also make #matrix-scene scanlines visible
  document.getElementById('matrix-scene').classList.add('active');

  sequencer.trigger(message ?? 'Server is shutting down.');
});

// ── Functions ─────────────────────────────────────────────────────────────────

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('send-message', { text }, (resp) => {
    if (!resp?.ok) addErrorBubble(resp?.error ?? 'Failed to send.');
  });
  addBubble({ id: Date.now().toString(), ts: new Date().toISOString(),
    direction: 'in', type: 'message', payload: { text } });
  msgInput.value = '';
  msgInput.focus();
}

function startCountdown(minutes) {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countdownEndTime = Date.now() + minutes * 60_000;
  countdownDisplay.hidden = false;

  function tick() {
    const remaining = countdownEndTime - Date.now();
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      countdownTimer   = null;
      countdownEndTime = null;
      countdownDisplay.hidden = true;
      countdownText.textContent = '';
      return;
    }
    const totalSecs = Math.ceil(remaining / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    countdownText.textContent = `${m}:${s.toString().padStart(2, '0')} remaining`;
  }

  tick(); // immediate first render — no 1-second blank
  countdownTimer = setInterval(tick, 1_000);
}

function setConnState(state, label) {
  connDot.className = `conn-dot ${state}`;
  connLabel.textContent = label;
}

function setButtons(enabled) {
  btnBuzz.disabled     = !enabled;
  btnSend.disabled     = !enabled;
  btnLocation.disabled = !enabled;
  btnBattery.disabled  = !enabled;
  for (const btn of quickNeedBtns) btn.disabled = !enabled;
  for (const btn of statusBtns)    btn.disabled = !enabled;
  for (const btn of countdownBtns) btn.disabled = !enabled;
}

function addErrorBubble(text) {
  addBubble({ id: null, ts: new Date().toISOString(),
    direction: 'error', type: 'error', payload: { text } });
}

// ── addBubble ─────────────────────────────────────────────────────────────────
function addBubble(msg) {
  if (threadList.contains(threadEmpty)) threadEmpty.remove();

  const li = document.createElement('li');

  if (msg.direction === 'error' || msg.type === 'error') {
    li.className = 'bubble bubble-error';
    const errText = document.createElement('span');
    errText.className = 'bubble-text';
    errText.textContent = msg.payload?.text ?? 'An error occurred.'; // textContent — XSS safe
    li.appendChild(errText);
    threadList.appendChild(li);
    while (threadList.children.length > 200) threadList.removeChild(threadList.firstChild);
    return;
  }

  if (msg.direction === 'system') {
    li.className = 'bubble bubble-system';
    const sysText = document.createElement('span');
    sysText.textContent = msg.payload?.text ?? '';
    li.appendChild(sysText);
    threadList.appendChild(li);
    while (threadList.children.length > 200) threadList.removeChild(threadList.firstChild);
    threadList.scrollTop = threadList.scrollHeight;
    return;
  }

  li.className = `bubble bubble-${msg.direction === 'out' ? 'out' : 'in'}`;
  if (msg.id) li.dataset.msgId = msg.id;

  const textEl = document.createElement('span');
  textEl.className = 'bubble-text';
  textEl.textContent = formatPayload(msg.type, msg.payload); // textContent — XSS safe

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';

  const timeEl = document.createElement('span');
  timeEl.className = 'bubble-time';
  timeEl.textContent = new Date(msg.ts).toLocaleTimeString();
  meta.appendChild(timeEl);

  li.append(textEl, meta);
  threadList.appendChild(li);

  // Cap at 200 bubbles — remove oldest first
  while (threadList.children.length > 200) threadList.removeChild(threadList.firstChild);

  threadList.scrollTop = threadList.scrollHeight;
}

// ── formatPayload ─────────────────────────────────────────────────────────────
function formatPayload(type, payload) {
  switch (type) {
    case 'buzz':        return '🔔 Buzz sent!';
    case 'quick-need':  return `🚨 ${payload.need} — sent to Dad`;
    case 'status':      return `${payload.emoji} Status: ${payload.label}`;
    case 'location':    return '📍 Location sent to Dad';
    case 'battery-low':
      return `🔋 Battery alert sent${payload.level !== null ? ` (${Math.round(payload.level * 100)}%)` : ''}`;
    case 'countdown':   return `⏱ ${payload.minutes} min countdown started`;
    case 'message':     return `💬 ${payload.text}`;
    case 'reply':       return `↩ Dad: ${payload.text}`;
    default:            return JSON.stringify(payload);
  }
}
