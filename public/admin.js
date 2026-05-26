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
// BUG-09: flag + buffer to prevent live messages being wiped by loadHistory's innerHTML=''
let loadingHistory = false;
let pendingLive    = [];

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
  // BUG-09: if loadHistory fetch is in-flight, buffer the message so that
  // threadList.innerHTML='' in loadHistory doesn't wipe it.
  if (loadingHistory) {
    pendingLive.push(msg);
    return;
  }
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
  // BUG-09: set flag before fetch so incoming-message events are buffered,
  // not rendered into a thread that is about to be cleared.
  loadingHistory = true;
  pendingLive    = [];
  try {
    const res = await fetch('/admin/history');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // BUG-33: build all bubbles into a DocumentFragment then replace in one operation.
    // This prevents the browser from painting an intermediate empty thread.
    readReceiptMap.clear();
    const frag = document.createDocumentFragment();
    if (data.messages.length === 0) {
      frag.appendChild(threadEmpty);
    } else {
      // readRecentMessages returns oldest-first — render in that order
      for (const msg of data.messages) {
        addBubble(msg, { skipScroll: true });
      }
      // Drain threadList into the fragment for a single atomic appendChild below
      while (threadList.firstChild) frag.appendChild(threadList.firstChild);
    }
    // Single DOM mutation: clear + repopulate in one paint frame
    threadList.textContent = '';
    threadList.appendChild(frag);
    // Flush any live messages that arrived while the fetch was in-flight
    for (const msg of pendingLive) {
      addBubble(msg);
    }
    if (data.messages.length > 0 || pendingLive.length > 0) {
      threadList.scrollTop = threadList.scrollHeight;
    }
  } catch {
    addSystemNote('Could not load history — check server.');
    // Still flush buffered live messages on error so they are not lost
    for (const msg of pendingLive) {
      addBubble(msg);
    }
  } finally {
    loadingHistory = false;
    pendingLive    = [];
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
    // BUG-12: guard against null/undefined lat/lng from corrupted log entries
    const lat      = msg.payload?.lat ?? null;
    const lng      = msg.payload?.lng ?? null;
    const accuracy = msg.payload?.accuracy ?? 0;
    if (lat == null || lng == null) {
      textEl.textContent = '📍 Location (coordinates unavailable)';
    } else {
      // Use URLSearchParams to safely encode coordinate values into the URL
      const mapsUrl = `https://maps.google.com/?${new URLSearchParams({ q: `${lat},${lng}` })}`;
      textEl.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)} (±${Math.round(accuracy)}m) — `;
      const link = document.createElement('a');
      link.href        = mapsUrl;
      link.textContent = 'Open in Maps';
      link.target      = '_blank';
      link.rel         = 'noopener noreferrer';
      textEl.appendChild(link);
    }
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

  // BUG-11: cap thread at 200 bubbles — mirrors client.js behaviour
  while (threadList.children.length > 200) {
    const removed = threadList.firstChild;
    // Remove stale receipt reference so the Map doesn't grow unbounded
    if (removed.dataset?.msgId) readReceiptMap.delete(removed.dataset.msgId);
    threadList.removeChild(removed);
  }

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
    // 'location' is handled in addBubble (renders a clickable Maps link) and never
    // reaches formatPayload — this case is intentionally omitted (BUG-25 dead code removed)
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
