import { z } from 'zod';
import { logger } from '../lib/logger.js';

// .trim() must come BEFORE .min() so whitespace-only strings ('   ') are
// correctly rejected instead of passing the length check and then becoming ''.
const MessageSchema = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(500, 'Message too long'),
});

// ── Per-socket rate limiters ───────────────────────────────────────────────
// Simple in-memory sliding-window counter per socket.
// Entries are cleaned up on disconnect so there is no unbounded memory growth.

const BUZZ_LIMIT = { windowMs: 10_000, max: 5 };   // 5 buzzes per 10 s
const MSG_LIMIT  = { windowMs: 5_000,  max: 20 };  // 20 messages per 5 s

function makeRateLimiter() {
  // Map<socketId, { count: number, resetAt: number }>
  const store = new Map();
  return {
    isLimited(socketId, { windowMs, max }) {
      const now = Date.now();
      const entry = store.get(socketId);
      if (!entry || now >= entry.resetAt) {
        store.set(socketId, { count: 1, resetAt: now + windowMs });
        return false;
      }
      if (entry.count >= max) return true;
      entry.count++;
      return false;
    },
    remove(socketId) {
      store.delete(socketId);
    },
  };
}

const buzzLimiter = makeRateLimiter();
const msgLimiter  = makeRateLimiter();

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
  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');

    // ── buzz-dad ────────────────────────────────────────────────────────────
    socket.on('buzz-dad', () => {
      if (buzzLimiter.isLimited(socket.id, BUZZ_LIMIT)) {
        logger.warn({ socketId: socket.id }, 'buzz-dad rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many buzzes.' });
        return;
      }

      logger.info({ socketId: socket.id }, 'Buzz received');
      // TODO: play audio on server machine — add a package like `play-sound` here
      socket.emit('ack', { type: 'buzz', message: 'Buzz received — Dad has been alerted!' });
    });

    // ── send-message ────────────────────────────────────────────────────────
    socket.on('send-message', (data, callback) => {
      if (msgLimiter.isLimited(socket.id, MSG_LIMIT)) {
        logger.warn({ socketId: socket.id }, 'send-message rate limit exceeded');
        socket.emit('ack', { type: 'error', message: 'Slow down — too many messages.' });
        if (typeof callback === 'function') callback({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      const result = MessageSchema.safeParse(data);

      if (!result.success) {
        const issue = result.error.issues[0]?.message ?? 'Invalid input';
        // Log only the type of data, never the raw value — prevents log injection
        // and avoids writing arbitrarily large payloads to the log stream.
        logger.warn({ socketId: socket.id, dataType: typeof data }, 'Message validation failed');
        socket.emit('ack', { type: 'error', message: `Validation error: ${issue}` });
        if (typeof callback === 'function') callback({ ok: false, error: issue });
        return;
      }

      const { text } = result.data;
      logger.info({ socketId: socket.id }, 'Message received');
      socket.emit('ack', { type: 'message', message: `Server received: "${text}"` });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── lifecycle ───────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      // Clean up rate-limiter state so memory doesn't grow with connection churn
      buzzLimiter.remove(socket.id);
      msgLimiter.remove(socket.id);
      logger.info({ socketId: socket.id, reason }, 'Client disconnected');
    });

    socket.on('error', (err) => {
      logger.error({ socketId: socket.id, err }, 'Socket error');
    });
  });
}
