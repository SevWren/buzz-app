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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import { registerSocketHandlers } from '../../src/handlers/socket.js';

// ── Server factory ────────────────────────────────────────────────────────────

function buildSocketServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  registerSocketHandlers(io);
  return { httpServer, io };
}

/** Resolves once the client is connected (or rejects on connect_error). */
function waitForConnect(client) {
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

/** Resolves with the next 'ack' event payload emitted by the server. */
function nextAck(client) {
  return new Promise((resolve) => client.once('ack', resolve));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Socket.IO integration', () => {
  let httpServer, io, port, client;

  beforeAll(async () => {
    ({ httpServer, io } = buildSocketServer());
    // Port 0 → OS assigns a free port automatically (no conflicts between runs)
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterAll(async () => {
    // Disconnect all remaining Socket.IO connections, then close HTTP server
    io.disconnectSockets(true);
    await new Promise((resolve) => httpServer.close(resolve));
  });

  beforeEach(async () => {
    client = Client(`http://localhost:${port}`, {
      forceNew: true,          // brand new connection for each test
      transports: ['websocket'], // skip polling for speed
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
    it('server responds with an ack', async () => {
      const ackPromise = nextAck(client);
      client.emit('buzz-dad');
      const ack = await ackPromise;
      expect(ack).toBeDefined();
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
  });

  // ── send-message — happy path ─────────────────────────────────────────────

  describe('send-message event — valid input', () => {
    it('server responds with an ack', async () => {
      const ackPromise = nextAck(client);
      client.emit('send-message', { text: 'Hello, server!' });
      const ack = await ackPromise;
      expect(ack).toBeDefined();
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

  // ── send-message — validation failures ───────────────────────────────────

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

    it('error ack includes a readable message', async () => {
      const ack = await sendAndGetAck({ text: '' });
      expect(typeof ack.message).toBe('string');
      expect(ack.message.length).toBeGreaterThan(0);
    });

    it('callback is called with { ok: false } on validation failure', async () => {
      const result = await new Promise((resolve) => {
        client.emit('send-message', { text: '' }, resolve);
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ── Multiple clients ──────────────────────────────────────────────────────

  describe('multiple simultaneous clients', () => {
    it('each client only receives its own ack', async () => {
      const client2 = Client(`http://localhost:${port}`, {
        forceNew: true,
        transports: ['websocket'],
      });

      try {
        await waitForConnect(client2);

        const client1Ack = nextAck(client);
        const client2Ack = nextAck(client2);

        client.emit('send-message', { text: 'from client 1' });
        client2.emit('send-message', { text: 'from client 2' });

        const [ack1, ack2] = await Promise.all([client1Ack, client2Ack]);

        expect(ack1.message).toContain('from client 1');
        expect(ack2.message).toContain('from client 2');
        // Cross-contamination check
        expect(ack1.message).not.toContain('from client 2');
        expect(ack2.message).not.toContain('from client 1');
      } finally {
        client2.disconnect();
      }
    });
  });
});
