/**
 * Integration tests for Socket.IO event handling.
 *
 * Spins up a real HTTP + Socket.IO server on a random port (`:0`), connects
 * real socket.io-client instances, fires events, and asserts on what the
 * server emits back. This validates the full event pipeline including Zod
 * validation and Socket.IO transport — nothing is mocked.
 *
 * Server lifecycle: created once per describe block (beforeAll / afterAll).
 * Client lifecycle: fresh connection per test (beforeEach / afterEach) to
 * guarantee test isolation.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import { registerSocketHandlers } from '../../src/handlers/socket.js';

// Mock out I/O side-effects so tests don't write files or play audio
vi.mock('../../src/lib/messageLog.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/lib/audioAlert.js', () => ({
  playAlert: vi.fn(),
}));

// ── Server factory ────────────────────────────────────────────────────────────

function buildSocketServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  // Mirror the io.use() middleware from server.js — sets isAdmin for localhost
  io.use((socket, next) => {
    const raw        = socket.handshake.address;
    const normalized = raw.replace('::ffff:', '');
    socket.data.isAdmin =
      normalized === '127.0.0.1' ||
      normalized === '::1'       ||
      normalized === 'localhost';
    next();
  });

  registerSocketHandlers(io);
  return { httpServer, io };
}

/** Resolves once the client is connected (or rejects on connect_error). */
function waitForConnect(client) {
  return new Promise((resolve, reject) => {
    client.once('connect',       resolve);
    client.once('connect_error', reject);
  });
}

/** Resolves with the next 'ack' event payload emitted by the server. */
function nextAck(client) {
  return new Promise((resolve) => client.once('ack', resolve));
}

/** Resolves with the next 'incoming-message' payload received by the client. */
function nextIncoming(client) {
  return new Promise((resolve) => client.once('incoming-message', resolve));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Socket.IO integration', () => {
  let httpServer, io, port, client;

  beforeAll(async () => {
    ({ httpServer, io } = buildSocketServer());
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterAll(async () => {
    io.disconnectSockets(true);
    await new Promise((resolve) => httpServer.close(resolve));
  });

  beforeEach(async () => {
    client = Client(`http://localhost:${port}`, {
      forceNew:   true,
      transports: ['websocket'],
    });
    await waitForConnect(client);
  });

  afterEach(() => {
    if (client.connected) client.disconnect();
  });

  // ── Connection ────────────────────────────────────────────────────────────

  describe('connection lifecycle', () => {
    it('client connects successfully', () => {
      expect(client.connected).toBe(true);
    });

    it('client receives a unique socket id', () => {
      expect(typeof client.id).toBe('string');
      expect(client.id.length).toBeGreaterThan(0);
    });
  });

  // ── buzz-dad ──────────────────────────────────────────────────────────────

  describe('buzz-dad event', () => {
    it('ack has type "buzz" and exact success message', async () => {
      const ackPromise = nextAck(client);
      client.emit('buzz-dad');
      const ack = await ackPromise;
      expect(ack.type).toBe('buzz');
      expect(ack.message).toBe('Buzz received — Dad has been alerted!');
    });

    it('ack has type "buzz"', async () => {
      const ackPromise = nextAck(client);
      client.emit('buzz-dad');
      const ack = await ackPromise;
      expect(ack.type).toBe('buzz');
    });

    it('ack includes a non-empty message', async () => {
      const ackPromise = nextAck(client);
      client.emit('buzz-dad');
      const ack = await ackPromise;
      expect(typeof ack.message).toBe('string');
      expect(ack.message.length).toBeGreaterThan(0);
    });

    it('server broadcasts incoming-message with type "buzz"', async () => {
      const incomingPromise = nextIncoming(client);
      client.emit('buzz-dad');
      const msg = await incomingPromise;
      expect(msg.type).toBe('buzz');
      expect(msg.direction).toBe('in');
    });
  });

  // ── send-message ──────────────────────────────────────────────────────────

  describe('send-message event — valid input', () => {
    it('ack has type "message" and echoes text in message field', async () => {
      const ackPromise = nextAck(client);
      client.emit('send-message', { text: 'Hello, server!' });
      const ack = await ackPromise;
      expect(ack.type).toBe('message');
      expect(ack.message).toContain('Hello, server!');
    });

    it('ack has type "message"', async () => {
      const ackPromise = nextAck(client);
      client.emit('send-message', { text: 'Hello, server!' });
      const ack = await ackPromise;
      expect(ack.type).toBe('message');
    });

    it('ack message echoes the sent text', async () => {
      const ackPromise = nextAck(client);
      client.emit('send-message', { text: 'echo this' });
      const ack = await ackPromise;
      expect(ack.message).toContain('echo this');
    });

    it('server trims whitespace before echoing', async () => {
      const ackPromise = nextAck(client);
      client.emit('send-message', { text: '  trimmed  ' });
      const ack = await ackPromise;
      expect(ack.message).toContain('trimmed');
      expect(ack.message).not.toMatch(/  trimmed  /);
    });

    it('callback is called with { ok: true }', async () => {
      const result = await new Promise((resolve) => {
        client.emit('send-message', { text: 'callback test' }, resolve);
      });
      expect(result.ok).toBe(true);
    });

    it('accepts a message at the 500-character boundary', async () => {
      const ackPromise = nextAck(client);
      client.emit('send-message', { text: 'b'.repeat(500) });
      const ack = await ackPromise;
      expect(ack.type).toBe('message');
    });
  });

  describe('send-message event — validation failures', () => {
    const sendAndGetAck = (data) => {
      const p = nextAck(client);
      client.emit('send-message', data);
      return p;
    };

    it('rejects an empty string — ack type is "error"', async () => {
      const ack = await sendAndGetAck({ text: '' });
      expect(ack.type).toBe('error');
    });

    it('rejects a message longer than 500 characters', async () => {
      const ack = await sendAndGetAck({ text: 'c'.repeat(501) });
      expect(ack.type).toBe('error');
    });

    it('rejects when the text field is missing', async () => {
      const ack = await sendAndGetAck({});
      expect(ack.type).toBe('error');
    });

    it('rejects when text is not a string', async () => {
      const ack = await sendAndGetAck({ text: 999 });
      expect(ack.type).toBe('error');
    });

    it('callback is called with { ok: false, error: string } on validation failure', async () => {
      const result = await new Promise((resolve) => {
        client.emit('send-message', { text: '' }, resolve);
      });
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    });
  });

  describe('send-message — broadcast', () => {
    it('send-message broadcasts incoming-message to all connected clients', async () => {
      const client2 = Client(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'] });
      try {
        await waitForConnect(client2);
        const incomingOnClient2 = nextIncoming(client2);
        client.emit('send-message', { text: 'broadcast check' });
        const msg = await incomingOnClient2;
        expect(msg.type).toBe('message');
        expect(msg.direction).toBe('in');
        expect(msg.payload.text).toBe('broadcast check');
      } finally {
        client2.disconnect();
      }
    });
  });

  // ── quick-need ────────────────────────────────────────────────────────────

  describe('quick-need event', () => {
    it('server responds with ack type "quick-need" for need "Pickup"', async () => {
      const ackPromise = nextAck(client);
      client.emit('quick-need', { need: 'Pickup' });
      const ack = await ackPromise;
      expect(ack.type).toBe('quick-need');
    });

    it('server responds with ack type "error" for invalid need "Dinner"', async () => {
      const ackPromise = nextAck(client);
      client.emit('quick-need', { need: 'Dinner' });
      const ack = await ackPromise;
      expect(ack.type).toBe('error');
    });

    it('callback returns { ok: true } for valid need', async () => {
      const result = await new Promise((resolve) => {
        client.emit('quick-need', { need: 'Help' }, resolve);
      });
      expect(result.ok).toBe(true);
    });

    it('callback returns { ok: false, error: string } for invalid need', async () => {
      const result = await new Promise((resolve) => {
        client.emit('quick-need', { need: 'Dinner' }, resolve);
      });
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    });

    it('server broadcasts incoming-message to all connected clients', async () => {
      const client2 = Client(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'] });
      try {
        await waitForConnect(client2);
        const incomingOnClient2 = nextIncoming(client2);
        client.emit('quick-need', { need: 'Food' });
        const msg = await incomingOnClient2;
        expect(msg.type).toBe('quick-need');
        expect(msg.payload.need).toBe('Food');
      } finally {
        client2.disconnect();
      }
    });
  });

  // ── set-status ────────────────────────────────────────────────────────────

  describe('set-status event', () => {
    it('server responds with ack type "status" for valid data', async () => {
      const ackPromise = nextAck(client);
      client.emit('set-status', { emoji: '😴', label: 'Tired' });
      const ack = await ackPromise;
      expect(ack.type).toBe('status');
    });

    it('server rejects unknown emoji with ack type "error"', async () => {
      const ackPromise = nextAck(client);
      client.emit('set-status', { emoji: '🐱', label: 'Tired' });
      const ack = await ackPromise;
      expect(ack.type).toBe('error');
    });

    it('callback returns { ok: true } for valid set-status', async () => {
      const result = await new Promise((resolve) => {
        client.emit('set-status', { emoji: '😴', label: 'Tired' }, resolve);
      });
      expect(result).toStrictEqual({ ok: true });
    });
  });

  // ── location-ping ─────────────────────────────────────────────────────────

  describe('location-ping event', () => {
    it('server responds with ack type "location" for valid coords', async () => {
      const ackPromise = nextAck(client);
      client.emit('location-ping', { lat: 51.5, lng: -0.12, accuracy: 10 });
      const ack = await ackPromise;
      expect(ack.type).toBe('location');
    });

    it('server rejects out-of-range lat', async () => {
      const ackPromise = nextAck(client);
      client.emit('location-ping', { lat: 91, lng: 0, accuracy: 5 });
      const ack = await ackPromise;
      expect(ack.type).toBe('error');
    });

    it('callback returns { ok: true } for valid coords', async () => {
      const result = await new Promise((resolve) => {
        client.emit('location-ping', { lat: 51.5, lng: -0.12, accuracy: 10 }, resolve);
      });
      expect(result).toStrictEqual({ ok: true });
    });

    it('ack message is "Location sent to Dad."', async () => {
      const ackPromise = nextAck(client);
      client.emit('location-ping', { lat: 51.5, lng: -0.12, accuracy: 10 });
      const ack = await ackPromise;
      expect(ack.message).toBe('Location sent to Dad.');
    });
  });

  // ── battery-low ───────────────────────────────────────────────────────────

  describe('battery-low event', () => {
    it('server responds with ack type "battery-low" for level 0.15', async () => {
      const ackPromise = nextAck(client);
      client.emit('battery-low', { level: 0.15 });
      const ack = await ackPromise;
      expect(ack.type).toBe('battery-low');
    });

    it('server accepts level null (iOS fallback)', async () => {
      const ackPromise = nextAck(client);
      client.emit('battery-low', { level: null });
      const ack = await ackPromise;
      expect(ack.type).toBe('battery-low');
    });

    it('ack message shows "unknown" when level is null', async () => {
      const ackPromise = nextAck(client);
      client.emit('battery-low', { level: null });
      const ack = await ackPromise;
      expect(ack.message).toBe('Battery alert sent (unknown).');
    });

    it('ack message shows percentage for numeric level (0.5 → "50%")', async () => {
      const ackPromise = nextAck(client);
      client.emit('battery-low', { level: 0.5 });
      const ack = await ackPromise;
      expect(ack.message).toBe('Battery alert sent (50%).');
    });

    it('callback returns { ok: true } for valid battery level', async () => {
      const result = await new Promise((resolve) => {
        client.emit('battery-low', { level: 0.2 }, resolve);
      });
      expect(result).toStrictEqual({ ok: true });
    });
  });

  // ── countdown-start ───────────────────────────────────────────────────────

  describe('countdown-start event', () => {
    it('server responds with ack type "countdown" for minutes 10', async () => {
      const ackPromise = nextAck(client);
      client.emit('countdown-start', { minutes: 10 });
      const ack = await ackPromise;
      expect(ack.type).toBe('countdown');
    });

    it('server responds with ack type "countdown" for minutes 5', async () => {
      const ackPromise = nextAck(client);
      client.emit('countdown-start', { minutes: 5 });
      const ack = await ackPromise;
      expect(ack.type).toBe('countdown');
    });

    it('server responds with ack type "countdown" for minutes 15', async () => {
      const ackPromise = nextAck(client);
      client.emit('countdown-start', { minutes: 15 });
      const ack = await ackPromise;
      expect(ack.type).toBe('countdown');
    });

    it('server responds with ack type "countdown" for minutes 30', async () => {
      const ackPromise = nextAck(client);
      client.emit('countdown-start', { minutes: 30 });
      const ack = await ackPromise;
      expect(ack.type).toBe('countdown');
    });

    it('server rejects minutes 8 (not a valid preset)', async () => {
      const ackPromise = nextAck(client);
      client.emit('countdown-start', { minutes: 8 });
      const ack = await ackPromise;
      expect(ack.type).toBe('error');
    });

    it('callback returns { ok: true } for valid minutes', async () => {
      const result = await new Promise((resolve) => {
        client.emit('countdown-start', { minutes: 15 }, resolve);
      });
      expect(result).toStrictEqual({ ok: true });
    });

    it('callback returns { ok: false, error } for invalid minutes', async () => {
      const result = await new Promise((resolve) => {
        client.emit('countdown-start', { minutes: 8 }, resolve);
      });
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    });
  });

  // ── send-reply ────────────────────────────────────────────────────────────

  describe('send-reply event', () => {
    it('localhost socket can send-reply and receives ack type "reply"', async () => {
      // Connecting from localhost → isAdmin = true (set by io.use middleware)
      const ackPromise = nextAck(client);
      client.emit('send-reply', { text: 'On my way!' });
      const ack = await ackPromise;
      expect(ack.type).toBe('reply');
    });

    it('send-reply broadcasts incoming-message with direction "out" to all sockets', async () => {
      const client2 = Client(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'] });
      try {
        await waitForConnect(client2);
        const incomingOnClient2 = nextIncoming(client2);
        client.emit('send-reply', { text: 'Hello from Dad' });
        const msg = await incomingOnClient2;
        expect(msg.direction).toBe('out');
        expect(msg.type).toBe('reply');
        expect(msg.payload.text).toBe('Hello from Dad');
      } finally {
        client2.disconnect();
      }
    });
  });

  // ── admin-mark-read ───────────────────────────────────────────────────────

  describe('admin-mark-read event', () => {
    it('server emits messages-read with valid ISO ts to all connected clients', async () => {
      const client2 = Client(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'] });
      try {
        await waitForConnect(client2);
        const readOnClient2 = new Promise((resolve) => client2.once('messages-read', resolve));
        client.emit('admin-mark-read');
        const payload = await readOnClient2;
        expect(typeof payload.ts).toBe('string');
        expect(() => new Date(payload.ts).toISOString()).not.toThrow();
        expect(new Date(payload.ts).toISOString()).toBe(payload.ts);
      } finally {
        client2.disconnect();
      }
    });

    it('messages-read payload ts is a valid ISO 8601 string', async () => {
      const readPromise = new Promise((resolve) => client.once('messages-read', resolve));
      client.emit('admin-mark-read');
      const payload = await readPromise;
      expect(typeof payload.ts).toBe('string');
      // Round-trip through Date must be lossless — confirms it is proper ISO 8601
      expect(new Date(payload.ts).toISOString()).toBe(payload.ts);
    });
  });

  // ── Multiple clients ──────────────────────────────────────────────────────

  describe('multiple simultaneous clients', () => {
    it('each client only receives its own ack', async () => {
      const client2 = Client(`http://localhost:${port}`, {
        forceNew:   true,
        transports: ['websocket'],
      });

      try {
        await waitForConnect(client2);

        const client1Ack = nextAck(client);
        const client2Ack = nextAck(client2);

        client.emit('send-message',  { text: 'from client 1' });
        client2.emit('send-message', { text: 'from client 2' });

        const [ack1, ack2] = await Promise.all([client1Ack, client2Ack]);

        expect(ack1.message).toContain('from client 1');
        expect(ack2.message).toContain('from client 2');
        expect(ack1.message).not.toContain('from client 2');
        expect(ack2.message).not.toContain('from client 1');
      } finally {
        client2.disconnect();
      }
    });
  });

  // ── Admin authorization — non-admin socket ────────────────────────────────

  describe('admin authorization — non-admin socket', () => {
    let nonAdminServer, nonAdminIo, nonAdminPort;

    beforeAll(async () => {
      // Build a second server that always sets isAdmin = false
      const app2 = express();
      const http2 = createServer(app2);
      nonAdminIo = new Server(http2, { cors: { origin: '*' } });
      nonAdminIo.use((socket, next) => {
        socket.data.isAdmin = false;
        next();
      });
      registerSocketHandlers(nonAdminIo);
      await new Promise((resolve) => http2.listen(0, resolve));
      nonAdminPort = http2.address().port;
      nonAdminServer = http2;
    });

    afterAll(async () => {
      nonAdminIo.disconnectSockets(true);
      await new Promise((resolve) => nonAdminServer.close(resolve));
    });

    it('send-reply returns { ok: false, error: "Unauthorized" } for non-admin socket', async () => {
      const c = Client(`http://localhost:${nonAdminPort}`, { forceNew: true, transports: ['websocket'] });
      try {
        await waitForConnect(c);
        const response = await new Promise((resolve) => {
          c.emit('send-reply', { text: 'hello' }, resolve);
        });
        expect(response).toStrictEqual({ ok: false, error: 'Unauthorized' });
      } finally {
        c.disconnect();
      }
    });

    it('admin-mark-read returns { ok: false, error: "Unauthorized" } for non-admin socket', async () => {
      const c = Client(`http://localhost:${nonAdminPort}`, { forceNew: true, transports: ['websocket'] });
      try {
        await waitForConnect(c);
        const response = await new Promise((resolve) => {
          c.emit('admin-mark-read', undefined, resolve);
        });
        expect(response).toStrictEqual({ ok: false, error: 'Unauthorized' });
      } finally {
        c.disconnect();
      }
    });
  });

  // ── Rate-limit isolation across reconnects ────────────────────────────────

  describe('rate-limit isolation', () => {
    it('new socket connection starts with fresh rate-limit counter', async () => {
      // Exhaust buzz-dad limit (5 per 10s) on the current client — await each ack
      // sequentially so we don't mis-attribute acks to the wrong emission.
      for (let i = 0; i < 5; i++) {
        const ackP = nextAck(client);
        client.emit('buzz-dad');
        const ack = await ackP;
        expect(ack.type).toBe('buzz');
      }

      // 6th emission on the same socket must be rate-limited
      const blockedP = nextAck(client);
      client.emit('buzz-dad');
      const blockedAck = await blockedP;
      expect(blockedAck.type).toBe('error');

      // A fresh socket has a different socketId → clean rate-limit bucket
      const freshClient = Client(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'] });
      try {
        await waitForConnect(freshClient);
        const ackPromise = nextAck(freshClient);
        freshClient.emit('buzz-dad');
        const ack = await ackPromise;
        expect(ack.type).toBe('buzz');
      } finally {
        freshClient.disconnect();
      }
    });
  });
});
