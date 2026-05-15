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
import { appendMessage } from '../../src/lib/messageLog.js';
import { playAlert }     from '../../src/lib/audioAlert.js';

vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/lib/messageLog.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/lib/audioAlert.js', () => ({
  playAlert: vi.fn(),
}));
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

// ── Test doubles ──────────────────────────────────────────────────────────────

// Each call gets a unique ID so rate-limiter state doesn't bleed across tests
let socketIdCounter = 0;

function createMockSocket() {
  const id       = `test-socket-${++socketIdCounter}`;
  const handlers = new Map();
  return {
    id,
    data: { isAdmin: false },
    on:   vi.fn((event, handler) => handlers.set(event, handler)),
    emit: vi.fn(),
    // Simulate an incoming event from the client
    receive: (event, ...args) => handlers.get(event)?.(...args),
  };
}

function createMockIo(socket) {
  return {
    on:   vi.fn((event, cb) => { if (event === 'connection') cb(socket); }),
    emit: vi.fn(),
    use:  vi.fn(),
  };
}

/**
 * Registers handlers and returns { socket, io }.
 * socketData overrides socket.data properties (e.g. { isAdmin: true }).
 */
function setup(socketData = {}) {
  const socket = createMockSocket();
  socket.data  = { isAdmin: false, ...socketData };
  const io     = createMockIo(socket);
  registerSocketHandlers(io);
  return { socket, io };
}

// Helper: expect an error ack
function expectErrorAck(socket) {
  expect(socket.emit).toHaveBeenCalledWith(
    'ack',
    expect.objectContaining({ type: 'error' }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('registerSocketHandlers', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Connection lifecycle ──────────────────────────────────────────────────

  describe('connection', () => {
    it('registers a "connection" listener on the io object', () => {
      const socket = createMockSocket();
      const io     = createMockIo(socket);
      registerSocketHandlers(io);
      expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('registers event listeners on the socket', () => {
      const { socket } = setup();
      expect(socket.on).toHaveBeenCalledWith('buzz-dad',        expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('send-message',    expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('quick-need',      expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('set-status',      expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('location-ping',   expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('battery-low',     expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('countdown-start', expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('send-reply',      expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('admin-mark-read', expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('disconnect',      expect.any(Function));
      expect(socket.on).toHaveBeenCalledWith('error',           expect.any(Function));
    });

    it('logs the connection with the socket id', () => {
      const { socket } = setup();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        expect.any(String),
      );
    });
  });

  // ── buzz-dad ──────────────────────────────────────────────────────────────

  describe('buzz-dad event', () => {
    it('emits an ack with type "buzz"', () => {
      const { socket } = setup();
      socket.receive('buzz-dad');
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'buzz' }));
    });

    it('includes a non-empty message in the ack', () => {
      const { socket } = setup();
      socket.receive('buzz-dad');
      const [, payload] = socket.emit.mock.calls[0];
      expect(typeof payload.message).toBe('string');
      expect(payload.message.length).toBeGreaterThan(0);
    });

    it('logs the buzz event', () => {
      const { socket } = setup();
      socket.receive('buzz-dad');
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        expect.any(String),
      );
    });

    it('calls playAlert("buzz")', () => {
      const { socket } = setup();
      socket.receive('buzz-dad');
      expect(playAlert).toHaveBeenCalledWith('buzz');
    });

    it('calls appendMessage with direction "in", type "buzz"', () => {
      const { socket } = setup();
      socket.receive('buzz-dad');
      expect(appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'in', type: 'buzz' }),
      );
    });

    it('calls io.emit("incoming-message") with type "buzz"', () => {
      const { socket, io } = setup();
      socket.receive('buzz-dad');
      expect(io.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'buzz', direction: 'in' }),
      );
    });
  });

  // ── send-message ──────────────────────────────────────────────────────────

  describe('send-message event — valid input', () => {
    it('emits an ack with type "message" for a valid message', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 'Hello, world!' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'message' }));
    });

    it('ack message echoes the sent text', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 'ping' });
      const [, payload] = socket.emit.mock.calls[0];
      expect(payload.message).toContain('ping');
    });

    it('trims leading/trailing whitespace before echoing', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: '  hello  ' });
      const [, payload] = socket.emit.mock.calls[0];
      expect(payload.message).toContain('hello');
      expect(payload.message).not.toContain('  hello  ');
    });

    it('accepts a message exactly 500 characters long', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 'a'.repeat(500) });
      const [, payload] = socket.emit.mock.calls[0];
      expect(payload.type).toBe('message');
    });

    it('calls the acknowledgement callback with { ok: true }', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('send-message', { text: 'Hello' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('logs the received message (socketId only — no raw text logged)', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 'test msg' });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        expect.any(String),
      );
    });

    it('calls playAlert("message")', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 'hi' });
      expect(playAlert).toHaveBeenCalledWith('message');
    });

    it('calls appendMessage with direction "in", type "message"', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 'hi' });
      expect(appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'in', type: 'message', payload: { text: 'hi' } }),
      );
    });

    it('calls io.emit("incoming-message") with type "message"', () => {
      const { socket, io } = setup();
      socket.receive('send-message', { text: 'hi' });
      expect(io.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'message', direction: 'in' }),
      );
    });
  });

  describe('send-message event — validation failures', () => {
    it('rejects an empty string', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: '' });
      expectErrorAck(socket);
    });

    it('rejects a message longer than 500 characters', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 'x'.repeat(501) });
      expectErrorAck(socket);
    });

    it('rejects when the text field is missing entirely', () => {
      const { socket } = setup();
      socket.receive('send-message', {});
      expectErrorAck(socket);
    });

    it('rejects when text is not a string', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 42 });
      expectErrorAck(socket);
    });

    it('rejects when data is null', () => {
      const { socket } = setup();
      socket.receive('send-message', null);
      expectErrorAck(socket);
    });

    it('calls the acknowledgement callback with { ok: false } on failure', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('send-message', { text: '' }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('does not throw when no callback is provided', () => {
      const { socket } = setup();
      expect(() => socket.receive('send-message', { text: '' })).not.toThrow();
    });

    it('does NOT call playAlert on validation failure', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: '' });
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('does NOT call appendMessage on validation failure', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: '' });
      expect(appendMessage).not.toHaveBeenCalled();
    });
  });

  // ── quick-need ────────────────────────────────────────────────────────────

  describe('quick-need event', () => {
    it('emits ack type "quick-need" for valid need "Pickup"', () => {
      const { socket } = setup();
      socket.receive('quick-need', { need: 'Pickup' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'quick-need' }));
    });

    it('emits ack type "quick-need" for valid need "Help"', () => {
      const { socket } = setup();
      socket.receive('quick-need', { need: 'Help' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'quick-need' }));
    });

    it('emits ack type "error" for invalid need "Dinner"', () => {
      const { socket } = setup();
      socket.receive('quick-need', { need: 'Dinner' });
      expectErrorAck(socket);
    });

    it('emits ack type "error" when need field is missing', () => {
      const { socket } = setup();
      socket.receive('quick-need', {});
      expectErrorAck(socket);
    });

    it('calls playAlert("quick-need", "Pickup") for need "Pickup"', () => {
      const { socket } = setup();
      socket.receive('quick-need', { need: 'Pickup' });
      expect(playAlert).toHaveBeenCalledWith('quick-need', 'Pickup');
    });

    it('calls playAlert("quick-need", "Help") for need "Help"', () => {
      const { socket } = setup();
      socket.receive('quick-need', { need: 'Help' });
      expect(playAlert).toHaveBeenCalledWith('quick-need', 'Help');
    });

    it('calls appendMessage with type "quick-need" and correct payload', () => {
      const { socket } = setup();
      socket.receive('quick-need', { need: 'Food' });
      expect(appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'in', type: 'quick-need', payload: { need: 'Food' } }),
      );
    });

    it('calls io.emit("incoming-message") with type "quick-need"', () => {
      const { socket, io } = setup();
      socket.receive('quick-need', { need: 'Money' });
      expect(io.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'quick-need', direction: 'in' }),
      );
    });

    it('callback receives { ok: true } on success', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('quick-need', { need: 'Pickup' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('callback receives { ok: false } on validation failure', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('quick-need', { need: 'Dinner' }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });
  });

  // ── set-status ────────────────────────────────────────────────────────────

  describe('set-status event', () => {
    it('emits ack type "status" for valid { emoji: "😴", label: "Tired" }', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'status' }));
    });

    it('emits ack type "error" for emoji not in enum', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '🐱', label: 'Tired' });
      expectErrorAck(socket);
    });

    it('emits ack type "error" for label not in enum', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '😴', label: 'Dancing' });
      expectErrorAck(socket);
    });

    it('calls playAlert("status")', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(playAlert).toHaveBeenCalledWith('status');
    });

    it('calls appendMessage with type "status"', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '🏠', label: 'Heading Home' });
      expect(appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'status' }),
      );
    });

    it('calls io.emit("incoming-message") with type "status"', () => {
      const { socket, io } = setup();
      socket.receive('set-status', { emoji: '✅', label: 'All Good' });
      expect(io.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'status' }),
      );
    });
  });

  // ── location-ping ─────────────────────────────────────────────────────────

  describe('location-ping event', () => {
    it('emits ack type "location" for valid coords', () => {
      const { socket } = setup();
      socket.receive('location-ping', { lat: 51.5, lng: -0.12, accuracy: 10 });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'location' }));
    });

    it('emits ack type "error" for lat > 90', () => {
      const { socket } = setup();
      socket.receive('location-ping', { lat: 91, lng: 0, accuracy: 5 });
      expectErrorAck(socket);
    });

    it('emits ack type "error" for lng > 180', () => {
      const { socket } = setup();
      socket.receive('location-ping', { lat: 0, lng: 181, accuracy: 5 });
      expectErrorAck(socket);
    });

    it('emits ack type "error" for negative accuracy', () => {
      const { socket } = setup();
      socket.receive('location-ping', { lat: 0, lng: 0, accuracy: -1 });
      expectErrorAck(socket);
    });

    it('calls playAlert("location")', () => {
      const { socket } = setup();
      socket.receive('location-ping', { lat: 0, lng: 0, accuracy: 5 });
      expect(playAlert).toHaveBeenCalledWith('location');
    });

    it('calls appendMessage with type "location"', () => {
      const { socket } = setup();
      socket.receive('location-ping', { lat: 51.5, lng: -0.12, accuracy: 10 });
      expect(appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'location' }),
      );
    });
  });

  // ── battery-low ───────────────────────────────────────────────────────────

  describe('battery-low event', () => {
    it('emits ack type "battery-low" for { level: 0.12 }', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 0.12 });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'battery-low' }));
    });

    it('accepts { level: null } (iOS fallback)', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: null });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'battery-low' }));
    });

    it('emits ack type "error" for level > 1', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 1.5 });
      expectErrorAck(socket);
    });

    it('emits ack type "error" for level < 0', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: -0.1 });
      expectErrorAck(socket);
    });

    it('emits ack type "error" when level field is absent', () => {
      const { socket } = setup();
      socket.receive('battery-low', {});
      expectErrorAck(socket);
    });

    it('calls playAlert("battery-low")', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 0.1 });
      expect(playAlert).toHaveBeenCalledWith('battery-low');
    });

    it('calls appendMessage with type "battery-low"', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 0.1 });
      expect(appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'battery-low' }),
      );
    });
  });

  // ── countdown-start ───────────────────────────────────────────────────────

  describe('countdown-start event', () => {
    it('emits ack type "countdown" for { minutes: 5 }', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 5 });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'countdown' }));
    });

    it('emits ack type "countdown" for { minutes: 30 }', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 30 });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'countdown' }));
    });

    it('emits ack type "error" for { minutes: 7 } (not a valid preset)', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 7 });
      expectErrorAck(socket);
    });

    it('emits ack type "error" for { minutes: 0 }', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 0 });
      expectErrorAck(socket);
    });

    it('calls playAlert("countdown")', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 10 });
      expect(playAlert).toHaveBeenCalledWith('countdown');
    });

    it('calls appendMessage with type "countdown"', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 15 });
      expect(appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'countdown' }),
      );
    });
  });

  // ── send-reply ────────────────────────────────────────────────────────────

  describe('send-reply event', () => {
    it('emits ack type "error" when socket.data.isAdmin is false', () => {
      const { socket } = setup({ isAdmin: false });
      socket.receive('send-reply', { text: 'hello' });
      expectErrorAck(socket);
    });

    it('callback receives { ok: false, error: "Unauthorized" } when not admin', () => {
      const { socket } = setup({ isAdmin: false });
      const cb = vi.fn();
      socket.receive('send-reply', { text: 'hello' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized' });
    });

    it('does NOT call appendMessage when isAdmin is false', () => {
      const { socket } = setup({ isAdmin: false });
      socket.receive('send-reply', { text: 'hello' });
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('emits ack type "reply" when socket.data.isAdmin is true', () => {
      const { socket } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: 'On my way!' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'reply' }));
    });

    it('does NOT call playAlert for type "reply"', () => {
      const { socket } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: 'hi' });
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('calls appendMessage with direction "out", type "reply"', () => {
      const { socket } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: 'hi' });
      expect(appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'out', type: 'reply' }),
      );
    });

    it('calls io.emit("incoming-message") with direction "out"', () => {
      const { socket, io } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: 'hi' });
      expect(io.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ direction: 'out', type: 'reply' }),
      );
    });

    it('emits ack type "error" for empty text (admin)', () => {
      const { socket } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: '' });
      expectErrorAck(socket);
    });

    it('emits ack type "error" for text > 500 chars (admin)', () => {
      const { socket } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: 'x'.repeat(501) });
      expectErrorAck(socket);
    });
  });

  // ── admin-mark-read ───────────────────────────────────────────────────────

  describe('admin-mark-read event', () => {
    it('calls io.emit("messages-read") when socket.data.isAdmin is true', () => {
      const { socket, io } = setup({ isAdmin: true });
      socket.receive('admin-mark-read');
      expect(io.emit).toHaveBeenCalledWith('messages-read', expect.objectContaining({ ts: expect.any(String) }));
    });

    it('does NOT call io.emit("messages-read") when socket.data.isAdmin is false', () => {
      const { socket, io } = setup({ isAdmin: false });
      socket.receive('admin-mark-read');
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('messages-read payload ts is an ISO string', () => {
      const { socket, io } = setup({ isAdmin: true });
      socket.receive('admin-mark-read');
      const [, payload] = io.emit.mock.calls[0];
      expect(() => new Date(payload.ts).toISOString()).not.toThrow();
    });
  });

  // ── disconnect ────────────────────────────────────────────────────────────

  describe('disconnect event', () => {
    it('logs the disconnect with socket id and reason', () => {
      const { socket } = setup();
      vi.clearAllMocks();
      socket.receive('disconnect', 'transport close');
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id, reason: 'transport close' }),
        expect.any(String),
      );
    });

    it('does not throw on disconnect (rate-limiter cleanup)', () => {
      const { socket } = setup();
      expect(() => socket.receive('disconnect', 'transport close')).not.toThrow();
    });
  });

  // ── error ─────────────────────────────────────────────────────────────────

  describe('error event', () => {
    it('logs socket errors', () => {
      const { socket } = setup();
      const err = new Error('socket blew up');
      socket.receive('error', err);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id, err }),
        expect.any(String),
      );
    });
  });

  // ── rate-limiting ─────────────────────────────────────────────────────────

  describe('buzz-dad rate limit', () => {
    it('returns error ack on 6th buzz within 10s', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('buzz-dad');
      vi.clearAllMocks();
      socket.receive('buzz-dad');
      expectErrorAck(socket);
    });
  });
});
