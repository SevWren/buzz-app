import { z }             from 'zod';
import { randomUUID }    from 'node:crypto';
import { logger }        from '../lib/logger.js';
import { appendMessage } from '../lib/messageLog.js';
import { playAlert }     from '../lib/audioAlert.js';

// ── Validation schemas ────────────────────────────────────────────────────────

// .trim() must come BEFORE .min() so whitespace-only strings ('   ') are
// correctly rejected instead of passing the length check and then becoming ''.
const MessageSchema = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(500, 'Message too long'),
});

const QuickNeedSchema = z.object({
  need: z.enum(['Pickup', 'Food', 'Money', 'Call Me', 'Help']),
});

// BUG-08: validate emoji+label as atomic pairs — independent enums accepted mismatches
// (e.g. { emoji:'😴', label:'Hungry' }) which stores and broadcasts semantically invalid status.
const StatusSchema = z.union([
  z.object({ emoji: z.literal('😴'), label: z.literal('Tired') }),
  z.object({ emoji: z.literal('🍔'), label: z.literal('Hungry') }),
  z.object({ emoji: z.literal('🏫'), label: z.literal('At School') }),
  z.object({ emoji: z.literal('🏠'), label: z.literal('Heading Home') }),
  z.object({ emoji: z.literal('✅'), label: z.literal('All Good') }),
  z.object({ emoji: z.literal('😢'), label: z.literal('Upset') }),
]);

const LocationSchema = z.object({
  lat:      z.number().min(-90).max(90),
  lng:      z.number().min(-180).max(180),
  accuracy: z.number().min(0),
});

const BatterySchema = z.object({
  level: z.number().min(0).max(1).nullable(),
});

const CountdownSchema = z.object({
  minutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
});

const ReplySchema = z.object({
  text: z.string().trim().min(1, 'Reply cannot be empty').max(500, 'Reply too long'),
});

// ── Per-socket rate limiters ──────────────────────────────────────────────────
// Simple in-memory sliding-window counter per socket.
// Entries are cleaned up on disconnect so there is no unbounded memory growth.

const BUZZ_LIMIT     = { windowMs: 10_000, max:  5 };
const MSG_LIMIT      = { windowMs:  5_000, max: 20 };
const QUICK_LIMIT    = { windowMs: 10_000, max: 10 };
const STATUS_LIMIT   = { windowMs: 10_000, max:  5 };
const LOCATION_LIMIT = { windowMs: 30_000, max:  3 };
const BATTERY_LIMIT  = { windowMs: 60_000, max:  2 };
const COUNTDOWN_LIMIT= { windowMs: 10_000, max:  5 };
const REPLY_LIMIT    = { windowMs:  5_000, max: 20 };

function makeRateLimiter() {
  // Map<socketId, { count: number, resetAt: number }>
  const store = new Map();
  return {
    isLimited(socketId, { windowMs, max }) {
      const now   = Date.now();
      const entry = store.get(socketId);
      if (!entry || now >= entry.resetAt) {
        store.set(socketId, { count: 1, resetAt: now + windowMs });
        return false;
      }
      if (entry.count >= max) return true;
      entry.count++;
      return false;
    },
    remove(socketId) { store.delete(socketId); },
  };
}

const buzzLimiter     = makeRateLimiter();
const msgLimiter      = makeRateLimiter();
const quickLimiter    = makeRateLimiter();
const statusLimiter   = makeRateLimiter();
const locationLimiter = makeRateLimiter();
const batteryLimiter  = makeRateLimiter();
const countdownLimiter= makeRateLimiter();
const replyLimiter    = makeRateLimiter();

// ─────────────────────────────────────────────────────────────────────────────

// Emits a warning to all connected clients before the server tears down
// sockets. Must be called BEFORE io.disconnectSockets() — once sockets are
// closed the emit packet never reaches clients.
export function broadcastShutdown(io) {
  io.emit('server-shutdown', {
    message: 'Server is shutting down. Connection will be lost.',
  });
}

export function registerSocketHandlers(io) {
  // Helper: build a standard incoming-message payload for io.emit
  function buildIncomingMsg(type, payload) {
    return {
      id:        randomUUID(),
      ts:        new Date().toISOString(),
      direction: 'in',
      type,
      payload,
    };
  }

  io.on('connection', (socket) => {
    // Defensive guard: socket.id must be a non-empty string before it is used
    // as a Map key in rate limiters and as a log field. In Socket.IO v4 this is
    // always true, but the guard protects against unexpected future changes.
    if (typeof socket.id !== 'string' || !socket.id) {
      logger.warn({ socketId: socket.id }, 'Socket connected with invalid id — disconnecting');
      socket.disconnect(true);
      return;
    }

    logger.info(
      { socketId: socket.id, address: socket.handshake?.address },
      'Client connected',
    );

    // ── buzz-dad ─────────────────────────────────────────────────────────────
    // BUG-05/06: handler now accepts (_data, callback) so Socket.IO ack is resolved.
    // All return paths call callback() to prevent ack tracker memory leaks.
    socket.on('buzz-dad', (_data, callback) => {
      if (buzzLimiter.isLimited(socket.id, BUZZ_LIMIT)) {
        logger.warn({ socketId: socket.id, address: socket.handshake?.address }, 'buzz-dad rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many buzzes.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      logger.info({ socketId: socket.id }, 'Buzz received');
      playAlert('buzz');
      appendMessage({ direction: 'in', type: 'buzz', socketId: socket.id, payload: {} });
      const buzzMsg = buildIncomingMsg('buzz', {});
      io.to('admin').emit('incoming-message', buzzMsg);
      socket.emit('incoming-message', buzzMsg);
      socket.emit('ack', { type: 'buzz', message: 'Buzz received — Dad has been alerted!' });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── send-message ──────────────────────────────────────────────────────────
    socket.on('send-message', (data, callback) => {
      if (msgLimiter.isLimited(socket.id, MSG_LIMIT)) {
        logger.warn({ socketId: socket.id, address: socket.handshake?.address }, 'send-message rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many messages.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      const result = MessageSchema.safeParse(data);

      if (!result.success) {
        const issue = result.error.issues[0]?.message ?? 'Invalid input';
        logger.warn({ socketId: socket.id, address: socket.handshake?.address, dataType: typeof data }, 'Message validation failed');
        socket.emit('ack', { type: 'error', message: `Validation error: ${issue}` });
        if (typeof callback === 'function') callback({ ok: false, error: issue });
        return;
      }

      const { text } = result.data;
      logger.info({ socketId: socket.id }, 'Message received');
      playAlert('message');
      appendMessage({ direction: 'in', type: 'message', socketId: socket.id, payload: { text } });
      const msgMsg = buildIncomingMsg('message', { text });
      io.to('admin').emit('incoming-message', msgMsg);
      socket.emit('incoming-message', msgMsg);
      socket.emit('ack', { type: 'message', message: `Server received: "${text}"` });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── quick-need ────────────────────────────────────────────────────────────
    socket.on('quick-need', (data, callback) => {
      if (quickLimiter.isLimited(socket.id, QUICK_LIMIT)) {
        logger.warn({ socketId: socket.id, address: socket.handshake?.address }, 'quick-need rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many requests.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      const result = QuickNeedSchema.safeParse(data);
      if (!result.success) {
        const issue = result.error.issues[0]?.message ?? 'Invalid input';
        logger.warn({ socketId: socket.id, address: socket.handshake?.address, dataType: typeof data }, 'quick-need validation failed');
        socket.emit('ack', { type: 'error', message: `Validation error: ${issue}` });
        if (typeof callback === 'function') callback({ ok: false, error: issue });
        return;
      }

      const { need } = result.data;
      logger.info({ socketId: socket.id }, 'quick-need received');
      playAlert('quick-need', need);
      appendMessage({ direction: 'in', type: 'quick-need', socketId: socket.id, payload: { need } });
      const quickMsg = buildIncomingMsg('quick-need', { need });
      io.to('admin').emit('incoming-message', quickMsg);
      socket.emit('incoming-message', quickMsg);
      socket.emit('ack', { type: 'quick-need', message: `Need sent: ${need}` });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── set-status ────────────────────────────────────────────────────────────
    socket.on('set-status', (data, callback) => {
      if (statusLimiter.isLimited(socket.id, STATUS_LIMIT)) {
        logger.warn({ socketId: socket.id, address: socket.handshake?.address }, 'set-status rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many status updates.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      const result = StatusSchema.safeParse(data);
      if (!result.success) {
        const issue = result.error.issues[0]?.message ?? 'Invalid input';
        logger.warn({ socketId: socket.id, address: socket.handshake?.address, dataType: typeof data }, 'set-status validation failed');
        socket.emit('ack', { type: 'error', message: `Validation error: ${issue}` });
        if (typeof callback === 'function') callback({ ok: false, error: issue });
        return;
      }

      const { emoji, label } = result.data;
      logger.info({ socketId: socket.id }, 'set-status received');
      playAlert('status');
      appendMessage({ direction: 'in', type: 'status', socketId: socket.id, payload: { emoji, label } });
      const statusMsg = buildIncomingMsg('status', { emoji, label });
      io.to('admin').emit('incoming-message', statusMsg);
      socket.emit('incoming-message', statusMsg);
      socket.emit('ack', { type: 'status', message: `Status set: ${emoji} ${label}` });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── location-ping ─────────────────────────────────────────────────────────
    socket.on('location-ping', (data, callback) => {
      if (locationLimiter.isLimited(socket.id, LOCATION_LIMIT)) {
        logger.warn({ socketId: socket.id, address: socket.handshake?.address }, 'location-ping rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many location pings.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      const result = LocationSchema.safeParse(data);
      if (!result.success) {
        const issue = result.error.issues[0]?.message ?? 'Invalid input';
        logger.warn({ socketId: socket.id, address: socket.handshake?.address, dataType: typeof data }, 'location-ping validation failed');
        socket.emit('ack', { type: 'error', message: `Validation error: ${issue}` });
        if (typeof callback === 'function') callback({ ok: false, error: issue });
        return;
      }

      const { lat, lng, accuracy } = result.data;
      logger.info({ socketId: socket.id }, 'location-ping received');
      playAlert('location');
      appendMessage({ direction: 'in', type: 'location', socketId: socket.id, payload: { lat, lng, accuracy } });
      const locMsg = buildIncomingMsg('location', { lat, lng, accuracy });
      io.to('admin').emit('incoming-message', locMsg);
      socket.emit('incoming-message', locMsg);
      socket.emit('ack', { type: 'location', message: 'Location sent to Dad.' });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── battery-low ───────────────────────────────────────────────────────────
    socket.on('battery-low', (data, callback) => {
      if (batteryLimiter.isLimited(socket.id, BATTERY_LIMIT)) {
        logger.warn({ socketId: socket.id, address: socket.handshake?.address }, 'battery-low rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many battery alerts.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      const result = BatterySchema.safeParse(data);
      if (!result.success) {
        const issue = result.error.issues[0]?.message ?? 'Invalid input';
        logger.warn({ socketId: socket.id, address: socket.handshake?.address, dataType: typeof data }, 'battery-low validation failed');
        socket.emit('ack', { type: 'error', message: `Validation error: ${issue}` });
        if (typeof callback === 'function') callback({ ok: false, error: issue });
        return;
      }

      const { level } = result.data;
      logger.info({ socketId: socket.id }, 'battery-low received');
      playAlert('battery-low');
      appendMessage({ direction: 'in', type: 'battery-low', socketId: socket.id, payload: { level } });
      const battMsg = buildIncomingMsg('battery-low', { level });
      io.to('admin').emit('incoming-message', battMsg);
      socket.emit('incoming-message', battMsg);
      const pct = level !== null ? `${Math.round(level * 100)}%` : 'unknown';
      socket.emit('ack', { type: 'battery-low', message: `Battery alert sent (${pct}).` });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── countdown-start ───────────────────────────────────────────────────────
    socket.on('countdown-start', (data, callback) => {
      if (countdownLimiter.isLimited(socket.id, COUNTDOWN_LIMIT)) {
        logger.warn({ socketId: socket.id, address: socket.handshake?.address }, 'countdown-start rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many countdowns.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      const result = CountdownSchema.safeParse(data);
      if (!result.success) {
        const issue = result.error.issues[0]?.message ?? 'Invalid input';
        logger.warn({ socketId: socket.id, address: socket.handshake?.address, dataType: typeof data }, 'countdown-start validation failed');
        socket.emit('ack', { type: 'error', message: `Validation error: ${issue}` });
        if (typeof callback === 'function') callback({ ok: false, error: issue });
        return;
      }

      const { minutes } = result.data;
      logger.info({ socketId: socket.id }, 'countdown-start received');
      playAlert('countdown');
      appendMessage({ direction: 'in', type: 'countdown', socketId: socket.id, payload: { minutes } });
      const cdMsg = buildIncomingMsg('countdown', { minutes });
      io.to('admin').emit('incoming-message', cdMsg);
      socket.emit('incoming-message', cdMsg);
      socket.emit('ack', { type: 'countdown', message: `Countdown started: ${minutes} min.` });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── send-reply (admin only) ───────────────────────────────────────────────
    socket.on('send-reply', (data, callback) => {
      if (socket.data?.isAdmin !== true) {
        socket.emit('ack', { type: 'error', message: 'Unauthorized.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Unauthorized' });
        return;
      }

      if (replyLimiter.isLimited(socket.id, REPLY_LIMIT)) {
        logger.warn({ socketId: socket.id, address: socket.handshake?.address }, 'send-reply rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many replies.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      const result = ReplySchema.safeParse(data);
      if (!result.success) {
        const issue = result.error.issues[0]?.message ?? 'Invalid input';
        logger.warn({ socketId: socket.id, address: socket.handshake?.address, dataType: typeof data }, 'send-reply validation failed');
        socket.emit('ack', { type: 'error', message: `Validation error: ${issue}` });
        if (typeof callback === 'function') callback({ ok: false, error: issue });
        return;
      }

      const { text } = result.data;
      logger.info({ socketId: socket.id }, 'send-reply received');
      // No playAlert for 'reply' — Dad is at the keyboard, no alert needed
      appendMessage({ direction: 'out', type: 'reply', socketId: socket.id, payload: { text } });
      const msg = {
        id:        randomUUID(),
        ts:        new Date().toISOString(),
        direction: 'out',
        type:      'reply',
        payload:   { text },
      };
      io.emit('incoming-message', msg);
      socket.emit('ack', { type: 'reply', message: `Reply sent: "${text}"` });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── admin-mark-read (admin only) ──────────────────────────────────────────
    socket.on('admin-mark-read', (data, callback) => {
      if (socket.data?.isAdmin !== true) {
        // BUG-07: emit ack on unauthorized — mirrors send-reply behaviour for consistency
        socket.emit('ack', { type: 'error', message: 'Unauthorized.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Unauthorized' });
        return;
      }
      logger.info({ socketId: socket.id }, 'admin-mark-read received');
      io.emit('messages-read', { ts: new Date().toISOString() });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── lifecycle ─────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      // Clean up all rate-limiter state so memory doesn't grow with connection churn
      buzzLimiter.remove(socket.id);
      msgLimiter.remove(socket.id);
      quickLimiter.remove(socket.id);
      statusLimiter.remove(socket.id);
      locationLimiter.remove(socket.id);
      batteryLimiter.remove(socket.id);
      countdownLimiter.remove(socket.id);
      replyLimiter.remove(socket.id);
      logger.info({ socketId: socket.id, address: socket.handshake?.address, reason }, 'Client disconnected');
    });

    socket.on('error', (err) => {
      // Log only message and code — never the full err object, which can
      // contain stack traces with local file paths or other internal details.
      logger.error(
        { socketId: socket.id, errMessage: err?.message, errCode: err?.code },
        'Socket error',
      );
    });
  });
}
