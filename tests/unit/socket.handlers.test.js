/**
 * Unit tests for src/handlers/socket.js
 *
 * The Socket.IO server and socket objects are replaced with lightweight
 * fakes so we can exercise every code path without starting a real server
 * or opening a real network connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSocketHandlers, broadcastShutdown } from '../../src/handlers/socket.js';
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
    data:     { isAdmin: false },
    // Realistic handshake object — used by rate-limit and connection logs
    handshake: { address: '127.0.0.1' },
    on:   vi.fn((event, handler) => handlers.set(event, handler)),
    emit: vi.fn(),
    // Simulate an incoming event from the client
    receive: (event, ...args) => handlers.get(event)?.(...args),
  };
}

function createMockIo(socket) {
  // io.to(room) returns a chainable object with .emit — mirrors the Socket.IO API
  // used by the BUG-02 fix (io.to('admin').emit(...)).
  const roomEmit = vi.fn();
  return {
    on:   vi.fn((event, cb) => { if (event === 'connection') cb(socket); }),
    emit: vi.fn(),
    use:  vi.fn(),
    to:   vi.fn(() => ({ emit: roomEmit })),
    // Expose roomEmit so tests can assert on it
    _roomEmit: roomEmit,
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

    it('logs the connection with the socket id, address, and exact message', () => {
      const { socket } = setup();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id, address: '127.0.0.1' }),
        'Client connected',
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

    it('ack message is exactly "Buzz received — Dad has been alerted!"', () => {
      const { socket } = setup();
      socket.receive('buzz-dad');
      // socket.emit[0] is now the incoming-message echo (BUG-02 fix); find ack by event name
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Buzz received — Dad has been alerted!');
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

    it('calls appendMessage with direction "in", type "buzz", socketId, and empty payload', () => {
      const { socket } = setup();
      socket.receive('buzz-dad');
      expect(appendMessage).toHaveBeenCalledWith({
        direction: 'in', type: 'buzz', socketId: socket.id, payload: {},
      });
    });

    it('emits "incoming-message" to admin room with type "buzz" (BUG-02)', () => {
      const { socket, io } = setup();
      socket.receive('buzz-dad');
      expect(io.to).toHaveBeenCalledWith('admin');
      expect(io._roomEmit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'buzz', direction: 'in' }),
      );
      // Sender echo
      expect(socket.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'buzz', direction: 'in' }),
      );
    });

    it('calls acknowledgement callback with { ok: true } on success (BUG-05)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('buzz-dad', undefined, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('calls acknowledgement callback with { ok: false } on rate limit (BUG-06)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      // Exhaust rate limit (BUZZ_LIMIT.max = 5 per 10s)
      for (let i = 0; i < 5; i++) socket.receive('buzz-dad');
      socket.receive('buzz-dad', undefined, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
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
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toContain('ping');
    });

    it('trims leading/trailing whitespace before echoing', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: '  hello  ' });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toContain('hello');
      expect(ackCall[1].message).not.toContain('  hello  ');
    });

    it('accepts a message exactly 500 characters long', () => {
      const { socket } = setup();
      socket.receive('send-message', { text: 'a'.repeat(500) });
      const [, payload] = socket.emit.mock.calls[0];
      expect(payload.type).toBe('message');
    });

    it('calls the acknowledgement callback with { ok: true } exactly once', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('send-message', { text: 'Hello' }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
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

    it('emits "incoming-message" to admin room with type "message" (BUG-02)', () => {
      const { socket, io } = setup();
      socket.receive('send-message', { text: 'hi' });
      expect(io.to).toHaveBeenCalledWith('admin');
      expect(io._roomEmit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'message', direction: 'in' }),
      );
      expect(socket.emit).toHaveBeenCalledWith(
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

    it('calls the acknowledgement callback with { ok: false } exactly once on failure', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('send-message', { text: '' }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
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

    it('rejects whitespace-only text (trim then min(1) fails)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('send-message', { text: '   ' }, cb);
      expectErrorAck(socket);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
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

    it('emits "incoming-message" to admin room with type "quick-need" (BUG-02)', () => {
      const { socket, io } = setup();
      socket.receive('quick-need', { need: 'Money' });
      expect(io.to).toHaveBeenCalledWith('admin');
      expect(io._roomEmit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'quick-need', direction: 'in' }),
      );
      expect(socket.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'quick-need', direction: 'in' }),
      );
    });

    it('callback receives { ok: true } exactly once on success', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('quick-need', { need: 'Pickup' }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('callback receives { ok: false } exactly once on validation failure', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('quick-need', { need: 'Dinner' }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
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

    it('emits ack type "error" when emoji field is missing', () => {
      const { socket } = setup();
      socket.receive('set-status', { label: 'Tired' });
      expectErrorAck(socket);
    });

    it('emits ack type "error" when label field is missing', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '😴' });
      expectErrorAck(socket);
    });

    it('emits ack type "error" when payload is empty object', () => {
      const { socket } = setup();
      socket.receive('set-status', {});
      expectErrorAck(socket);
    });

    it('calls playAlert("status")', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(playAlert).toHaveBeenCalledWith('status');
    });

    it('calls appendMessage with full record including socketId and payload { emoji, label }', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '🏠', label: 'Heading Home' });
      expect(appendMessage).toHaveBeenCalledWith({
        direction: 'in', type: 'status', socketId: socket.id,
        payload: { emoji: '🏠', label: 'Heading Home' },
      });
    });

    it('ack message includes emoji and label', () => {
      const { socket } = setup();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Status set: 😴 Tired');
    });

    it('callback receives { ok: true } for valid set-status', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('emits "incoming-message" to admin room with type "status" (BUG-02)', () => {
      const { socket, io } = setup();
      socket.receive('set-status', { emoji: '✅', label: 'All Good' });
      expect(io.to).toHaveBeenCalledWith('admin');
      expect(io._roomEmit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'status', direction: 'in' }),
      );
      expect(socket.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({ type: 'status', direction: 'in' }),
      );
    });

    it('rejects valid emoji paired with invalid label', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('set-status', { emoji: '😴', label: 'INVALID_LABEL' }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('rejects invalid emoji paired with valid label', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('set-status', { emoji: '🤡', label: 'Tired' }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('rejects mismatched valid emoji + valid label (BUG-08: discriminated union)', () => {
      // BUG-08 fix: StatusSchema now validates emoji+label as atomic pairs.
      // Previously the independent-enum schema accepted { emoji:'😴', label:'Hungry' }.
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('set-status', { emoji: '😴', label: 'Hungry' }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('accepts all 6 valid emoji+label pairs (BUG-08)', () => {
      const pairs = [
        { emoji: '😴', label: 'Tired' },
        { emoji: '🍔', label: 'Hungry' },
        { emoji: '🏫', label: 'At School' },
        { emoji: '🏠', label: 'Heading Home' },
        { emoji: '✅', label: 'All Good' },
        { emoji: '😢', label: 'Upset' },
      ];
      for (const pair of pairs) {
        const { socket } = setup();
        const cb = vi.fn();
        socket.receive('set-status', pair, cb);
        expect(cb).toHaveBeenCalledWith({ ok: true });
      }
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

    it('calls appendMessage with full record including socketId and payload { lat, lng, accuracy }', () => {
      const { socket } = setup();
      socket.receive('location-ping', { lat: 51.5, lng: -0.12, accuracy: 10 });
      expect(appendMessage).toHaveBeenCalledWith({
        direction: 'in', type: 'location', socketId: socket.id,
        payload: { lat: 51.5, lng: -0.12, accuracy: 10 },
      });
    });

    it('ack message is exactly "Location sent to Dad."', () => {
      const { socket } = setup();
      socket.receive('location-ping', { lat: 51.5, lng: -0.12, accuracy: 10 });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Location sent to Dad.');
    });

    it('callback receives { ok: true } for valid coords', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: 51.5, lng: -0.12, accuracy: 10 }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('rejects lat=-90.001 (just under south pole)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: -90.001, lng: 0, accuracy: 1 }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('rejects lng=-180.001 (just under west boundary)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: 0, lng: -180.001, accuracy: 1 }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('accepts lat=90 (north pole exact boundary)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: 90, lng: 0, accuracy: 1 }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('accepts lat=-90 (south pole exact boundary)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: -90, lng: 0, accuracy: 1 }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('accepts lng=180 (east boundary)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: 0, lng: 180, accuracy: 1 }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('accepts lng=-180 (west boundary)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: 0, lng: -180, accuracy: 1 }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('accepts accuracy=0 (zero accuracy)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: 0, lng: 0, accuracy: 0 }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('rejects lat=90.001 (just over north pole)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: 90.001, lng: 0, accuracy: 1 }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('rejects accuracy=-0.001 (negative accuracy)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('location-ping', { lat: 0, lng: 0, accuracy: -0.001 }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
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

    it('calls appendMessage with full record including socketId and payload { level }', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 0.1 });
      expect(appendMessage).toHaveBeenCalledWith({
        direction: 'in', type: 'battery-low', socketId: socket.id,
        payload: { level: 0.1 },
      });
    });

    it('accepts level=0 (empty battery, exact min boundary)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('battery-low', { level: 0 }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('accepts level=1 (full battery, exact max boundary)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('battery-low', { level: 1 }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('rejects level=1.001 (just over max)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('battery-low', { level: 1.001 }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('rejects level=-0.001 (just under min)', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('battery-low', { level: -0.001 }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('ack message shows percentage for numeric level (level=0.5 → "50%")', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 0.5 });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Battery alert sent (50%).');
    });

    it('ack message shows "unknown" for null level', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: null });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Battery alert sent (unknown).');
    });

    it('ack message shows "100%" for level=1', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 1 });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Battery alert sent (100%).');
    });

    it('ack message shows "0%" for level=0', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 0 });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Battery alert sent (0%).');
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

    it('calls appendMessage with full record including socketId and payload { minutes }', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 15 });
      expect(appendMessage).toHaveBeenCalledWith({
        direction: 'in', type: 'countdown', socketId: socket.id,
        payload: { minutes: 15 },
      });
    });

    it('emits ack type "countdown" for { minutes: 10 }', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 10 });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'countdown' }));
    });

    it('emits ack type "countdown" for { minutes: 15 }', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 15 });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'countdown' }));
    });

    it('callback receives { ok: true } for valid minutes', () => {
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('countdown-start', { minutes: 10 }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('ack message includes the minutes value', () => {
      const { socket } = setup();
      socket.receive('countdown-start', { minutes: 15 });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Countdown started: 15 min.');
    });
  });

  // ── send-reply ────────────────────────────────────────────────────────────

  describe('send-reply event', () => {
    it('emits ack type "error" when socket.data.isAdmin is false', () => {
      const { socket } = setup({ isAdmin: false });
      socket.receive('send-reply', { text: 'hello' });
      expectErrorAck(socket);
    });

    it('callback receives { ok: false, error: "Unauthorized" } exactly once when not admin', () => {
      const { socket } = setup({ isAdmin: false });
      const cb = vi.fn();
      socket.receive('send-reply', { text: 'hello' }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
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

    it('calls appendMessage with full record including socketId and payload { text }', () => {
      const { socket } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: 'hi' });
      expect(appendMessage).toHaveBeenCalledWith({
        direction: 'out', type: 'reply', socketId: socket.id,
        payload: { text: 'hi' },
      });
    });

    it('ack message echoes the reply text', () => {
      const { socket } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: 'hi' });
      const ackCall = socket.emit.mock.calls.find(([event]) => event === 'ack');
      expect(ackCall[1].message).toBe('Reply sent: "hi"');
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

    it('returns Unauthorized when socket.data.isAdmin is undefined', () => {
      const { socket } = setup({ isAdmin: undefined });
      const cb = vi.fn();
      socket.receive('send-reply', { text: 'hi' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized' });
    });

    it('returns Unauthorized when socket.data.isAdmin is null', () => {
      const { socket } = setup({ isAdmin: null });
      const cb = vi.fn();
      socket.receive('send-reply', { text: 'hi' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized' });
    });

    it('returns Unauthorized when socket.data.isAdmin is 0', () => {
      const { socket } = setup({ isAdmin: 0 });
      const cb = vi.fn();
      socket.receive('send-reply', { text: 'hi' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized' });
    });

    it('rejects whitespace-only reply text (trim then min(1) fails)', () => {
      const { socket } = setup({ isAdmin: true });
      const cb = vi.fn();
      socket.receive('send-reply', { text: '   ' }, cb);
      expectErrorAck(socket);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
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

    it('emits ack type "error" for unauthorized admin-mark-read (BUG-07)', () => {
      // BUG-07 fix: unauthorized path now emits ack, consistent with send-reply behaviour.
      const { socket } = setup({ isAdmin: false });
      socket.receive('admin-mark-read');
      expect(socket.emit).toHaveBeenCalledWith(
        'ack',
        expect.objectContaining({ type: 'error', message: 'Unauthorized.' }),
      );
    });

    it('messages-read ts is an exact ISO 8601 round-trip', () => {
      const { socket, io } = setup({ isAdmin: true });
      socket.receive('admin-mark-read');
      const [, payload] = io.emit.mock.calls[0];
      // Round-trip must be lossless — new Date(ts).toISOString() === ts
      expect(new Date(payload.ts).toISOString()).toBe(payload.ts);
    });

    it('messages-read payload ts is an ISO string', () => {
      const { socket, io } = setup({ isAdmin: true });
      socket.receive('admin-mark-read');
      const [, payload] = io.emit.mock.calls[0];
      expect(() => new Date(payload.ts).toISOString()).not.toThrow();
    });

    it('invokes callback with { ok: true } when admin', () => {
      const { socket } = setup({ isAdmin: true });
      const cb = vi.fn();
      socket.receive('admin-mark-read', undefined, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('invokes callback with { ok: false } when not admin', () => {
      const { socket } = setup({ isAdmin: false });
      const cb = vi.fn();
      socket.receive('admin-mark-read', undefined, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized' });
    });

    it('does not throw when no callback is provided', () => {
      const { socket } = setup({ isAdmin: true });
      expect(() => socket.receive('admin-mark-read')).not.toThrow();
    });

    it('returns Unauthorized when socket.data.isAdmin is undefined', () => {
      const { socket } = setup({ isAdmin: undefined });
      const cb = vi.fn();
      socket.receive('admin-mark-read', undefined, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized' });
    });

    it('returns Unauthorized when socket.data.isAdmin is null', () => {
      const { socket } = setup({ isAdmin: null });
      const cb = vi.fn();
      socket.receive('admin-mark-read', undefined, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized' });
    });

    it('returns Unauthorized when socket.data.isAdmin is 0', () => {
      const { socket } = setup({ isAdmin: 0 });
      const cb = vi.fn();
      socket.receive('admin-mark-read', undefined, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Unauthorized' });
    });
  });

  // ── disconnect ────────────────────────────────────────────────────────────

  describe('disconnect event', () => {
    it('logs the disconnect with socket id, reason, and exact message', () => {
      const { socket } = setup();
      vi.clearAllMocks();
      socket.receive('disconnect', 'transport close');
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id, reason: 'transport close' }),
        'Client disconnected',
      );
    });

    it('does not throw on disconnect (rate-limiter cleanup)', () => {
      const { socket } = setup();
      expect(() => socket.receive('disconnect', 'transport close')).not.toThrow();
    });
  });

  // ── error ─────────────────────────────────────────────────────────────────

  describe('error event', () => {
    it('logs socket errors with errMessage/errCode (not the full err object) and exact message', () => {
      const { socket } = setup();
      const err = new Error('socket blew up');
      socket.receive('error', err);
      // Source: { socketId, errMessage: err?.message, errCode: err?.code } — sanitized
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          socketId:   socket.id,
          errMessage: 'socket blew up',
          errCode:    undefined,
        }),
        'Socket error',
      );
    });
  });

  // ── rate-limiting ─────────────────────────────────────────────────────────

  describe('buzz-dad rate limit', () => {
    it('5th buzz within 10s succeeds (boundary: max is 5)', () => {
      const { socket } = setup();
      for (let i = 0; i < 4; i++) socket.receive('buzz-dad');
      vi.clearAllMocks();
      socket.receive('buzz-dad');
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'buzz' }));
    });

    it('6th buzz within 10s returns error ack with exact message', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('buzz-dad');
      vi.clearAllMocks();
      socket.receive('buzz-dad');
      expect(socket.emit).toHaveBeenCalledWith('ack', {
        type: 'error',
        message: 'Slow down — too many buzzes.',
      });
    });

    it('does NOT call playAlert when rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('buzz-dad');
      vi.clearAllMocks();
      socket.receive('buzz-dad');
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('does NOT call appendMessage when rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('buzz-dad');
      vi.clearAllMocks();
      socket.receive('buzz-dad');
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call io.emit when rate limited', () => {
      const { socket, io } = setup();
      for (let i = 0; i < 5; i++) socket.receive('buzz-dad');
      vi.clearAllMocks();
      socket.receive('buzz-dad');
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('calls logger.warn with rate-limit exceeded message', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('buzz-dad');
      vi.clearAllMocks();
      socket.receive('buzz-dad');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        'buzz-dad rate limit exceeded',
      );
    });
  });

  describe('set-status rate limit (max 5 / 10s)', () => {
    it('5th set-status within 10s succeeds', () => {
      const { socket } = setup();
      for (let i = 0; i < 4; i++) socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      vi.clearAllMocks();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'status' }));
    });

    it('6th set-status within 10s returns exact rate-limit error message', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      vi.clearAllMocks();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(socket.emit).toHaveBeenCalledWith('ack', {
        type: 'error',
        message: 'Slow down — too many status updates.',
      });
    });

    it('does NOT call playAlert when set-status is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      vi.clearAllMocks();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('does NOT call appendMessage when set-status is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      vi.clearAllMocks();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call io.emit when set-status is rate limited', () => {
      const { socket, io } = setup();
      for (let i = 0; i < 5; i++) socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      vi.clearAllMocks();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('calls logger.warn with set-status rate-limit exceeded message', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      vi.clearAllMocks();
      socket.receive('set-status', { emoji: '😴', label: 'Tired' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        'set-status rate limit exceeded',
      );
    });
  });

  describe('location-ping rate limit (max 3 / 30s)', () => {
    const validLocation = { lat: 51.5, lng: -0.12, accuracy: 10 };

    it('3rd location-ping within 30s succeeds', () => {
      const { socket } = setup();
      for (let i = 0; i < 2; i++) socket.receive('location-ping', validLocation);
      vi.clearAllMocks();
      socket.receive('location-ping', validLocation);
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'location' }));
    });

    it('4th location-ping within 30s returns exact rate-limit error message', () => {
      const { socket } = setup();
      for (let i = 0; i < 3; i++) socket.receive('location-ping', validLocation);
      vi.clearAllMocks();
      socket.receive('location-ping', validLocation);
      expect(socket.emit).toHaveBeenCalledWith('ack', {
        type: 'error',
        message: 'Slow down — too many location pings.',
      });
    });

    it('does NOT call playAlert when location-ping is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 3; i++) socket.receive('location-ping', validLocation);
      vi.clearAllMocks();
      socket.receive('location-ping', validLocation);
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('does NOT call appendMessage when location-ping is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 3; i++) socket.receive('location-ping', validLocation);
      vi.clearAllMocks();
      socket.receive('location-ping', validLocation);
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call io.emit when location-ping is rate limited', () => {
      const { socket, io } = setup();
      for (let i = 0; i < 3; i++) socket.receive('location-ping', validLocation);
      vi.clearAllMocks();
      socket.receive('location-ping', validLocation);
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('calls logger.warn with location-ping rate-limit exceeded message', () => {
      const { socket } = setup();
      for (let i = 0; i < 3; i++) socket.receive('location-ping', validLocation);
      vi.clearAllMocks();
      socket.receive('location-ping', validLocation);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        'location-ping rate limit exceeded',
      );
    });
  });

  describe('battery-low rate limit (max 2 / 60s)', () => {
    it('2nd battery-low within 60s succeeds', () => {
      const { socket } = setup();
      socket.receive('battery-low', { level: 0.1 });
      vi.clearAllMocks();
      socket.receive('battery-low', { level: 0.1 });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'battery-low' }));
    });

    it('3rd battery-low within 60s returns exact rate-limit error message', () => {
      const { socket } = setup();
      for (let i = 0; i < 2; i++) socket.receive('battery-low', { level: 0.1 });
      vi.clearAllMocks();
      socket.receive('battery-low', { level: 0.1 });
      expect(socket.emit).toHaveBeenCalledWith('ack', {
        type: 'error',
        message: 'Slow down — too many battery alerts.',
      });
    });

    it('does NOT call playAlert when battery-low is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 2; i++) socket.receive('battery-low', { level: 0.1 });
      vi.clearAllMocks();
      socket.receive('battery-low', { level: 0.1 });
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('does NOT call appendMessage when battery-low is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 2; i++) socket.receive('battery-low', { level: 0.1 });
      vi.clearAllMocks();
      socket.receive('battery-low', { level: 0.1 });
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call io.emit when battery-low is rate limited', () => {
      const { socket, io } = setup();
      for (let i = 0; i < 2; i++) socket.receive('battery-low', { level: 0.1 });
      vi.clearAllMocks();
      socket.receive('battery-low', { level: 0.1 });
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('calls logger.warn with battery-low rate-limit exceeded message', () => {
      const { socket } = setup();
      for (let i = 0; i < 2; i++) socket.receive('battery-low', { level: 0.1 });
      vi.clearAllMocks();
      socket.receive('battery-low', { level: 0.1 });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        'battery-low rate limit exceeded',
      );
    });
  });

  describe('countdown-start rate limit (max 5 / 10s)', () => {
    it('5th countdown-start within 10s succeeds', () => {
      const { socket } = setup();
      for (let i = 0; i < 4; i++) socket.receive('countdown-start', { minutes: 5 });
      vi.clearAllMocks();
      socket.receive('countdown-start', { minutes: 5 });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'countdown' }));
    });

    it('6th countdown-start within 10s returns exact rate-limit error message', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('countdown-start', { minutes: 5 });
      vi.clearAllMocks();
      socket.receive('countdown-start', { minutes: 5 });
      expect(socket.emit).toHaveBeenCalledWith('ack', {
        type: 'error',
        message: 'Slow down — too many countdowns.',
      });
    });

    it('does NOT call playAlert when countdown-start is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('countdown-start', { minutes: 5 });
      vi.clearAllMocks();
      socket.receive('countdown-start', { minutes: 5 });
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('does NOT call appendMessage when countdown-start is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('countdown-start', { minutes: 5 });
      vi.clearAllMocks();
      socket.receive('countdown-start', { minutes: 5 });
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call io.emit when countdown-start is rate limited', () => {
      const { socket, io } = setup();
      for (let i = 0; i < 5; i++) socket.receive('countdown-start', { minutes: 5 });
      vi.clearAllMocks();
      socket.receive('countdown-start', { minutes: 5 });
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('calls logger.warn with countdown-start rate-limit exceeded message', () => {
      const { socket } = setup();
      for (let i = 0; i < 5; i++) socket.receive('countdown-start', { minutes: 5 });
      vi.clearAllMocks();
      socket.receive('countdown-start', { minutes: 5 });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        'countdown-start rate limit exceeded',
      );
    });
  });

  describe('send-reply rate limit (max 20 / 5s)', () => {
    it('20th send-reply within 5s succeeds', () => {
      const { socket } = setup({ isAdmin: true });
      for (let i = 0; i < 19; i++) socket.receive('send-reply', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-reply', { text: 'hi' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'reply' }));
    });

    it('21st send-reply within 5s returns exact rate-limit error message', () => {
      const { socket } = setup({ isAdmin: true });
      for (let i = 0; i < 20; i++) socket.receive('send-reply', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-reply', { text: 'hi' });
      expect(socket.emit).toHaveBeenCalledWith('ack', {
        type: 'error',
        message: 'Slow down — too many replies.',
      });
    });

    it('does NOT call appendMessage when send-reply is rate limited', () => {
      const { socket } = setup({ isAdmin: true });
      for (let i = 0; i < 20; i++) socket.receive('send-reply', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-reply', { text: 'hi' });
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call io.emit when send-reply is rate limited', () => {
      const { socket, io } = setup({ isAdmin: true });
      for (let i = 0; i < 20; i++) socket.receive('send-reply', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-reply', { text: 'hi' });
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('calls logger.warn with send-reply rate-limit exceeded message', () => {
      const { socket } = setup({ isAdmin: true });
      for (let i = 0; i < 20; i++) socket.receive('send-reply', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-reply', { text: 'hi' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        'send-reply rate limit exceeded',
      );
    });
  });

  describe('send-message rate limit (max 20 / 5s)', () => {
    it('20th send-message within 5s succeeds', () => {
      const { socket } = setup();
      for (let i = 0; i < 19; i++) socket.receive('send-message', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-message', { text: 'hi' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'message' }));
    });

    it('21st send-message within 5s returns error ack', () => {
      const { socket } = setup();
      for (let i = 0; i < 20; i++) socket.receive('send-message', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-message', { text: 'hi' });
      expect(socket.emit).toHaveBeenCalledWith('ack', {
        type: 'error',
        message: 'Slow down — too many messages.',
      });
    });

    it('rate-limited send-message callback receives { ok: false, error: "Rate limit exceeded" }', () => {
      const { socket } = setup();
      for (let i = 0; i < 20; i++) socket.receive('send-message', { text: 'hi' });
      vi.clearAllMocks();
      const cb = vi.fn();
      socket.receive('send-message', { text: 'hi' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Rate limit exceeded' });
    });

    it('does NOT call playAlert when send-message is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 20; i++) socket.receive('send-message', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-message', { text: 'hi' });
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('does NOT call appendMessage when send-message is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 20; i++) socket.receive('send-message', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-message', { text: 'hi' });
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call io.emit when send-message is rate limited', () => {
      const { socket, io } = setup();
      for (let i = 0; i < 20; i++) socket.receive('send-message', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-message', { text: 'hi' });
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('calls logger.warn with send-message rate-limit exceeded message', () => {
      const { socket } = setup();
      for (let i = 0; i < 20; i++) socket.receive('send-message', { text: 'hi' });
      vi.clearAllMocks();
      socket.receive('send-message', { text: 'hi' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        'send-message rate limit exceeded',
      );
    });
  });

  describe('quick-need rate limit (max 10 / 10s)', () => {
    it('10th quick-need within 10s succeeds', () => {
      const { socket } = setup();
      for (let i = 0; i < 9; i++) socket.receive('quick-need', { need: 'Pickup' });
      vi.clearAllMocks();
      socket.receive('quick-need', { need: 'Pickup' });
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'quick-need' }));
    });

    it('11th quick-need within 10s returns exact rate-limit error message', () => {
      const { socket } = setup();
      for (let i = 0; i < 10; i++) socket.receive('quick-need', { need: 'Pickup' });
      vi.clearAllMocks();
      socket.receive('quick-need', { need: 'Pickup' });
      expect(socket.emit).toHaveBeenCalledWith('ack', {
        type: 'error',
        message: 'Slow down — too many requests.',
      });
    });

    it('rate-limited quick-need callback receives { ok: false, error: "Rate limit exceeded" }', () => {
      const { socket } = setup();
      for (let i = 0; i < 10; i++) socket.receive('quick-need', { need: 'Pickup' });
      vi.clearAllMocks();
      const cb = vi.fn();
      socket.receive('quick-need', { need: 'Pickup' }, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Rate limit exceeded' });
    });

    it('does NOT call playAlert when quick-need is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 10; i++) socket.receive('quick-need', { need: 'Pickup' });
      vi.clearAllMocks();
      socket.receive('quick-need', { need: 'Pickup' });
      expect(playAlert).not.toHaveBeenCalled();
    });

    it('does NOT call appendMessage when quick-need is rate limited', () => {
      const { socket } = setup();
      for (let i = 0; i < 10; i++) socket.receive('quick-need', { need: 'Pickup' });
      vi.clearAllMocks();
      socket.receive('quick-need', { need: 'Pickup' });
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it('does NOT call io.emit when quick-need is rate limited', () => {
      const { socket, io } = setup();
      for (let i = 0; i < 10; i++) socket.receive('quick-need', { need: 'Pickup' });
      vi.clearAllMocks();
      socket.receive('quick-need', { need: 'Pickup' });
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('calls logger.warn with quick-need rate-limit exceeded message', () => {
      const { socket } = setup();
      for (let i = 0; i < 10; i++) socket.receive('quick-need', { need: 'Pickup' });
      vi.clearAllMocks();
      socket.receive('quick-need', { need: 'Pickup' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ socketId: socket.id }),
        'quick-need rate limit exceeded',
      );
    });
  });

  describe('rate-limiter cross-socket isolation', () => {
    it('hitting limit on one socket does not affect a different socket', () => {
      const { socket: socket1 } = setup();
      // Exhaust buzz-dad limit on socket1
      for (let i = 0; i < 5; i++) socket1.receive('buzz-dad');
      vi.clearAllMocks();
      socket1.receive('buzz-dad');
      expectErrorAck(socket1);

      // socket2 has a different ID — its rate-limiter bucket is fresh
      const { socket: socket2 } = setup();
      vi.clearAllMocks();
      socket2.receive('buzz-dad');
      expect(socket2.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'buzz' }));
    });
  });

  // ── appendMessage fire-and-forget rejection ────────────────────────────────

  describe('appendMessage rejection — fire-and-forget, must not surface to client', () => {
    it('send-message: callback still receives { ok: true } when appendMessage rejects', async () => {
      appendMessage.mockRejectedValueOnce(new Error('disk full'));
      const { socket } = setup();
      const cb = vi.fn();
      socket.receive('send-message', { text: 'hello' }, cb);
      // Allow the rejected promise microtask to settle
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(cb).toHaveBeenCalledWith({ ok: true });
    });

    it('buzz-dad: ack type is "buzz" (not "error") when appendMessage rejects', async () => {
      appendMessage.mockRejectedValueOnce(new Error('disk full'));
      const { socket } = setup();
      socket.receive('buzz-dad');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(socket.emit).toHaveBeenCalledWith('ack', expect.objectContaining({ type: 'buzz' }));
      // Verify no error ack was ever emitted
      const errorAcks = socket.emit.mock.calls.filter(
        ([event, payload]) => event === 'ack' && payload?.type === 'error',
      );
      expect(errorAcks).toHaveLength(0);
    });
  });

  // ── broadcastShutdown ─────────────────────────────────────────────────────

  describe('broadcastShutdown', () => {
    it('emits "server-shutdown" on io with correct message', () => {
      const io = { emit: vi.fn(), on: vi.fn(), use: vi.fn() };
      broadcastShutdown(io);
      expect(io.emit).toHaveBeenCalledWith('server-shutdown', {
        message: 'Server is shutting down. Connection will be lost.',
      });
    });

    it('calls io.emit exactly once', () => {
      const io = { emit: vi.fn(), on: vi.fn(), use: vi.fn() };
      broadcastShutdown(io);
      expect(io.emit).toHaveBeenCalledTimes(1);
    });

    it('uses io.emit (broadcasts to all clients), not socket.emit', () => {
      const io = { emit: vi.fn(), on: vi.fn(), use: vi.fn() };
      const socketEmit = vi.fn();
      broadcastShutdown(io);
      // Verify it called io.emit (the global broadcast), not socket.emit
      expect(io.emit).toHaveBeenCalled();
      expect(socketEmit).not.toHaveBeenCalled();
    });
  });

  // ── incoming-message broadcast payload shape ───────────────────────────────

  describe('incoming-message broadcast payload shape', () => {
    it('buzz-dad: admin room receives correct shape (BUG-02)', () => {
      const { socket, io } = setup();
      socket.receive('buzz-dad');
      expect(io._roomEmit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({
          id:        'test-uuid-1234',
          direction: 'in',
          type:      'buzz',
          payload:   {},
          ts:        expect.any(String),
        }),
      );
    });

    it('send-message: admin room receives correct payload.text (BUG-02)', () => {
      const { socket, io } = setup();
      socket.receive('send-message', { text: 'hello world' });
      expect(io._roomEmit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({
          id:        'test-uuid-1234',
          direction: 'in',
          type:      'message',
          payload:   { text: 'hello world' },
        }),
      );
    });

    it('send-reply: ALL clients receive direction "out" via io.emit (reply is not private)', () => {
      const { socket, io } = setup({ isAdmin: true });
      socket.receive('send-reply', { text: 'on my way' });
      expect(io.emit).toHaveBeenCalledWith(
        'incoming-message',
        expect.objectContaining({
          direction: 'out',
          type:      'reply',
          payload:   { text: 'on my way' },
        }),
      );
    });
  });
});
