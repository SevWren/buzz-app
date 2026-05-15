// Admin panel client — Dad's reply interface
// ES module (type="module" on the script tag in admin.html)

const socket = io({
  reconnectionDelayMax: 10_000,
  reconnectionAttempts: 10,  // prevent indefinite reconnection to an unavailable server
});

// ── DOM refs ──────────────────────────────────────────────────────────────────
const connDot     = document.getElementById('conn-dot');
const connLabel   = document.getElementById('conn-label');
const threadList  = document.getElementById('thread-list');
const threadEmpty = document.getElementById('thread-empty');
const unreadBadge = document.getElementById('unread-badge');
const replyInput  = document.getElementById('reply-input');
const btnReply    = document.getElementById('btn-reply');

// ── State ─────────────────────────────────────────────────────────────────────
let unreadCount = 0;
// Map<messageId, HTMLSpanElement> — read-receipt span for each outbound bubble
const readReceiptMap = new Map();

// ── Connection lifecycle ──────────────────────────────────────────────────────
socket.on('connect', () => {
  setConnState('connected', 'Connected');
  btnReply.disabled = false;
  replyInput.focus();
  // Reset stale unread state from a previous session before loading fresh history
  unreadCount = 0;
  updateUnreadBadge();
  updateTabTitle();
  loadHistory();
});

socket.on('disconnect', () => {
  setConnState('disconnected', 'Disconnected');
  btnReply.disabled = true;
  // Reset title so "(N) Buzz App — Admin" doesn't persist while offline
  unreadCount = 0;
  updateUnreadBadge();
  updateTabTitle();
  // Release DOM element references so garbage collection can reclaim them.
  // loadHistory() clears the map on reconnect, but clearing here too prevents
  // the map growing unbounded on a long-lived session that never reconnects.
  readReceiptMap.clear();
});

socket.on('connect_error', () => {
  setConnState('connecting', 'Reconnecting…');
  btnReply.disabled = true;
});

// ── Incoming messages ─────────────────────────────────────────────────────────
socket.on('incoming-message', (msg) => {
  addBubble(msg);
  threadList.scrollTop = threadList.scrollHeight;

  if (msg.direction === 'in') {
    if (document.hidden) {
      unreadCount++;
      updateUnreadBadge();
      updateTabTitle();
    } else {
      // Tab is already visible — mark read immediately
      socket.emit('admin-mark-read');
    }
  }
});

// ── Read receipts ─────────────────────────────────────────────────────────────
socket.on('messages-read', () => {
  for (const el of readReceiptMap.values()) {
    el.textContent = '✓ Seen';
    el.hidden = false;
  }
});

// ── Tab visibility / focus — clear unread count ───────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && unreadCount > 0) {
    unreadCount = 0;
    updateUnreadBadge();
    updateTabTitle();
    socket.emit('admin-mark-read');
  }
});

window.addEventListener('focus', () => {
  if (unreadCount > 0) {
    unreadCount = 0;
    updateUnreadBadge();
    updateTabTitle();
    socket.emit('admin-mark-read');
  }
});

// ── Send reply ────────────────────────────────────────────────────────────────
btnReply.addEventListener('click', sendReply);
replyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendReply();
});

function sendReply() {
  const text = replyInput.value.trim();
  if (!text) return;
  // Client-side guard mirrors server's ReplySchema max(500).
  if (text.length > 500) { addSystemNote('Reply too long (max 500 characters).'); return; }
  socket.emit('send-reply', { text }, (resp) => {
    if (!resp?.ok) addSystemNote(`Send failed: ${resp?.error ?? 'Unknown error'}`);
  });
  replyInput.value = '';
  replyInput.focus();
}

// ── Server shutdown ───────────────────────────────────────────────────────────
socket.on('server-shutdown', ({ message }) => {
  socket.off('connect');
  socket.off('disconnect');
  socket.off('connect_error');
  socket.off('incoming-message');
  socket.off('messages-read');
  socket.disconnect();
  document.title = 'Buzz App — Offline';
  addSystemNote(message ?? 'Server has shut down.');
  btnReply.disabled = true;
});

// ── History loading ───────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const res = await fetch('/admin/history');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Clear thread and re-render (handles reconnect correctly)
    threadList.innerHTML = '';
    readReceiptMap.clear();

    if (data.messages.length === 0) {
      threadList.appendChild(threadEmpty);
      return;
    }

    // readRecentMessages returns oldest-first — render in that order
    for (const msg of data.messages) {
      addBubble(msg, { skipScroll: true });
    }
    threadList.scrollTop = threadList.scrollHeight;
  } catch {
    addSystemNote('Could not load history — check server.');
  }
}

// ── addBubble ─────────────────────────────────────────────────────────────────
function addBubble(msg, opts = {}) {
  if (threadList.contains(threadEmpty)) threadEmpty.remove();

  const li = document.createElement('li');

  if (msg.direction === 'in') {
    li.className = 'bubble bubble-in';
  } else if (msg.direction === 'out') {
    li.className = 'bubble bubble-out';
  } else {
    li.className = 'bubble bubble-system';
  }

  if (msg.id) li.dataset.msgId = msg.id;

  const textEl = document.createElement('span');
  textEl.className = 'bubble-text';

  if (msg.type === 'location' && msg.payload) {
    // Render location as "📍 coords — [Open in Maps]" with a real clickable link
    const { lat, lng, accuracy } = msg.payload;
    // Use URLSearchParams to safely encode coordinate values into the URL
    // rather than raw template-string interpolation.
    const mapsUrl = `https://maps.google.com/?${new URLSearchParams({ q: `${lat},${lng}` })}`;
    textEl.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)} (±${Math.round(accuracy)}m) — `;
    const link = document.createElement('a');
    link.href        = mapsUrl;
    link.textContent = 'Open in Maps';
    link.target      = '_blank';
    link.rel         = 'noopener noreferrer';
    textEl.appendChild(link);
  } else {
    textEl.textContent = formatPayload(msg.type, msg.payload); // textContent — XSS safe
  }

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';

  const timeEl = document.createElement('span');
  timeEl.className = 'bubble-time';
  timeEl.textContent = new Date(msg.ts).toLocaleTimeString();
  meta.appendChild(timeEl);

  // Read-receipt placeholder for outbound (Dad's replies)
  if (msg.direction === 'out' && msg.id) {
    const receipt = document.createElement('span');
    receipt.className = 'read-receipt';
    receipt.textContent = '';
    receipt.hidden = true;
    meta.appendChild(receipt);
    readReceiptMap.set(msg.id, receipt);
  }

  li.append(textEl, meta);
  threadList.appendChild(li);

  if (!opts.skipScroll) {
    threadList.scrollTop = threadList.scrollHeight;
  }
}

// ── formatPayload ─────────────────────────────────────────────────────────────
function formatPayload(type, payload) {
  switch (type) {
    case 'buzz':        return '🔔 Buzz!';
    case 'quick-need':  return `🚨 Needs: ${payload.need}`;
    case 'status':      return `${payload.emoji} ${payload.label}`;
    case 'location': {
      // Null guard: payload fields may be missing if the record was corrupted.
      // toFixed() throws TypeError on null/undefined — use optional chaining.
      const latStr = payload.lat?.toFixed?.(5) ?? payload.lat ?? '?';
      const lngStr = payload.lng?.toFixed?.(5) ?? payload.lng ?? '?';
      const acc    = payload.accuracy != null ? `±${Math.round(payload.accuracy)}m` : '';
      // Handled specially in addBubble to render a clickable <a> link
      return `📍 ${latStr}, ${lngStr} ${acc}`.trimEnd();
    }
    case 'battery-low':
      return `🔋 Battery Low: ${payload.level !== null ? Math.round(payload.level * 100) + '%' : 'unknown'}`;
    case 'countdown':   return `⏱ I'll be ready in ${payload.minutes} min`;
    case 'message':     return `💬 ${payload.text}`;
    case 'reply':       return `↩ ${payload.text}`;
    // Unknown type — safe generic label rather than JSON.stringify(payload)
    // to avoid exposing raw payload structure in the admin UI.
    default:            return '📨 Message';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setConnState(state, label) {
  connDot.className = `conn-dot ${state}`;
  connLabel.textContent = label;
}

function updateUnreadBadge() {
  if (unreadCount > 0) {
    unreadBadge.textContent = `${unreadCount} unread`;
    unreadBadge.hidden = false;
  } else {
    unreadBadge.hidden = true;
  }
}

function updateTabTitle() {
  document.title = unreadCount > 0
    ? `(${unreadCount}) Buzz App — Admin`
    : 'Buzz App — Admin';
}

function addSystemNote(text) {
  const li = document.createElement('li');
  li.className = 'bubble bubble-system';
  li.textContent = text; // textContent — XSS safe
  if (threadList.contains(threadEmpty)) threadEmpty.remove();
  threadList.appendChild(li);
  threadList.scrollTop = threadList.scrollHeight;
}
