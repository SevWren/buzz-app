/**
 * Unit tests for src/handlers/socket.js
 *
 * The Socket.IO server and socket objects are replaced with lightweight
 * fakes so we can exercise every code path without starting a real server
 * or opening a real network connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSocketHandlers } from '../../src/handlers/socket.js';
import { logger } from '../../src/lib/logger.js';

vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Test doubles ─────────────────────────────────────────────────────────────

function createMockSocket(id = 'test-socket-id') {
  const handlers = new Map();
  return {
    id,
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    emit: vi.fn(),
    // Simulate an incoming event from the client
    receive: (event, ...args) => handlers.get(event)?.(...args),
  };
}

function createMockIo(socket) {
  return {
    on: vi.fn((event, cb) => {
      if (event === 'connection') cb(socket);
    }),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Registers handlers and returns the socket so tests can call socket.receive().
 */
function setup(socketOverrides = {}) {
  const socket = { ...createMockSocket(), ...socketOverrides };
  const io = createMockIo(socket);
  registerSocketHandlers(io);
  return socket;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('registerSocketHandlers', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Connection lifecycle ──────────────────────────────────────────────────

  describe('connection', () => {
    it('registers a "connection" listener on the io object', () => {
      const socket = createMockSocket();
      const io = createMockIo(socket);
      registerSocketHandlers(io);
      expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('registers event listeners on the socket', () => {
      const socket = setup();
      expect(socket.on).toHaveBeenCalledWith('buzz-dad', expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('send-message', expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('logs the connection with the socket id', () => {
      setup({ id: 'abc-123' });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: 'abc-123' }),
        expect.any(String)
      );
    });
  });

  // ── buzz-dad ──────────────────────────────────────────────────────────────

  describe('buzz-dad event', () => {
    it('emits an ack with type "buzz"', () => {
      const socket = setup();
      socket.receive('buzz-dad');
      expect(socket.emit).toHaveBeenCalledWith(
        'ack',
        expect.objectContaining({ type: 'buzz' })
      );
    });

    it('includes a non-empty message in the ack', () => {
      const socket = setup();
      socket.receive('buzz-dad');
      const [, payload] = socket.emit.mock.calls[0];
      expect(typeof payload.message).toBe('string');
      expect(payload.message.length).toBeGreaterThan(0);
    });

    it('logs the buzz event', () => {
      const socket = setup({ id: 'buzz-socket' });
      socket.receive('buzz-dad');
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: 'buzz-socket' }),
        expect.any(String)
      );
    });
  });

  // ── send-message — happy path ─────────────────────────────────────────────

  describe('send-message event — valid input', () => {
    it('emits an ack with type "message" for a valid message', () => {
      const socket = setup();
      socket.receive('send-message', { text: 'Hello, world!' });
      expect(socket.emit).toHaveBeenCalledWith(
        'ack',
        expect.objectContaining({ type: 'message' })
      );
    });

    it('ack message echoes the sent text', () => {
      const socket = setup();
      socket.receive('send-message', { text: 'ping' });
      const [, payload] = socket.emit.mock.calls[0];
      expect(payload.message).toContain('ping');
    });

    it('trims leading/trailing whitespace before echoing', () => {
      const socket = setup();
      socket.receive('send-message', { text: '  hello  ' });
      const [, payload] = socket.emit.mock.calls[0];
      expect(payload.message).toContain('hello');
      expect(payload.message).not.toContain('  hello  ');
    });

    it('accepts a message exactly 500 characters long', () => {
      const socket = setup();
      socket.receive('send-message', { text: 'a'.repeat(500) });
      const [, payload] = socket.emit.mock.calls[0];
      expect(payload.type).toBe('message');
    });

    it('calls the acknowledgement callback with { ok: true }', () => {
      const socket = setup();
      const cb = vi.fn();
      socket.receive('send-message', { text: 'Hello' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('logs the received message', () => {
      const socket = setup({ id: 'msg-socket' });
      socket.receive('send-message', { text: 'test msg' });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: 'msg-socket', text: 'test msg' }),
        expect.any(String)
      );
    });
  });

  // ── send-message — validation failures ───────────────────────────────────

  describe('send-message event — validation failures', () => {
    const expectErrorAck = (socket) => {
      expect(socket.emit).toHaveBeenCalledWith(
        'ack',
        expect.objectContaining({ type: 'error' })
      );
    };

    it('rejects an empty string', () => {
      const socket = setup();
      socket.receive('send-message', { text: '' });
      expectErrorAck(socket);
    });

    it('rejects a message longer than 500 characters', () => {
      const socket = setup();
      socket.receive('send-message', { text: 'x'.repeat(501) });
      expectErrorAck(socket);
    });

    it('rejects when the text field is missing entirely', () => {
      const socket = setup();
      socket.receive('send-message', {});
      expectErrorAck(socket);
    });

    it('rejects when text is not a string', () => {
      const socket = setup();
      socket.receive('send-message', { text: 42 });
      expectErrorAck(socket);
    });

    it('rejects when data is null', () => {
      const socket = setup();
      socket.receive('send-message', null);
      expectErrorAck(socket);
    });

    it('includes a human-readable error message in the ack', () => {
      const socket = setup();
      socket.receive('send-message', { text: '' });
      const [, payload] = socket.emit.mock.calls[0];
      expect(typeof payload.message).toBe('string');
      expect(payload.message.length).toBeGreaterThan(0);
    });

    it('calls the acknowledgement callback with { ok: false } on failure', () => {
      const socket = setup();
      const cb = vi.fn();
      socket.receive('send-message', { text: '' }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('does not call the callback when no callback is provided', () => {
      // Should not throw when callback is undefined
      const socket = setup();
      expect(() => socket.receive('send-message', { text: '' })).not.toThrow();
    });

    it('logs a warning for validation failures', () => {
      const socket = setup();
      socket.receive('send-message', { text: '' });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ── disconnect ────────────────────────────────────────────────────────────

  describe('disconnect event', () => {
    it('logs the disconnect with socket id and reason', () => {
      const socket = setup({ id: 'dc-socket' });
      vi.clearAllMocks(); // clear connection log
      socket.receive('disconnect', 'transport close');
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: 'dc-socket', reason: 'transport close' }),
        expect.any(String)
      );
    });
  });

  // ── error ─────────────────────────────────────────────────────────────────

  describe('error event', () => {
    it('logs socket errors', () => {
      const socket = setup({ id: 'err-socket' });
      const err = new Error('socket blew up');
      socket.receive('error', err);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: 'err-socket', err }),
        expect.any(String)
      );
    });
  });
});
