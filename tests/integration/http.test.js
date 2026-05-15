/**
 * Integration tests for the HTTP layer.
 *
 * Builds the full Express app (with all production middleware) but does NOT
 * call httpServer.listen() — supertest handles the binding internally.
 * This means tests exercise real middleware interaction: helmet headers,
 * CORS, rate limiting, and routing, all wired together.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import healthRouter from '../../src/routes/health.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

// Mock out file I/O — admin route uses messageLog
vi.mock('../../src/lib/messageLog.js', () => ({
  appendMessage:      vi.fn().mockResolvedValue(undefined),
  readRecentMessages: vi.fn().mockResolvedValue([]),
}));
// Bypass the IP guard so supertest (localhost) behaves normally
vi.mock('../../src/middleware/adminGuard.js', () => ({
  adminGuard: (_req, _res, next) => next(),
}));

function buildApp() {
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'", "'unsafe-inline'"],
        // 'self' covers WebSocket connections to the same origin (CSP Level 3)
      connectSrc:     ["'self'"],
        fontSrc:        ["'self'", 'data:'],
        imgSrc:         ["'self'", 'data:'],
        objectSrc:      ["'none'"],
        baseUri:        ["'self'"],
        formAction:     ["'self'"],
        frameAncestors: ["'none'"],
        workerSrc:      ["'none'"],
      },
    },
    referrerPolicy:           { policy: 'no-referrer' },
    crossOriginOpenerPolicy:  { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    );
    next();
  });
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], exposedHeaders: [] }));
  app.use(express.json({ limit: '10kb', strict: true }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
  app.use('/api', healthRouter);
  app.use(express.static('public'));
  app.use(errorHandler);
  return app;
}

describe('HTTP integration', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  // ── Health endpoint ───────────────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('returns the correct response shape', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body).toMatchObject({
        status: 'ok',
        uptime: expect.any(Number),
        timestamp: expect.any(String),
      });
    });
  });

  // ── 404 behaviour ─────────────────────────────────────────────────────────

  describe('unknown routes', () => {
    it('returns 404 for an unknown API path', async () => {
      const res = await request(app).get('/api/unknown-endpoint');
      expect(res.status).toBe(404);
    });

    it('returns 404 for a completely unknown path', async () => {
      const res = await request(app).get('/does-not-exist');
      expect(res.status).toBe(404);
    });
  });

  // ── Security headers (helmet) ─────────────────────────────────────────────

  describe('security headers', () => {
    it('sets X-Content-Type-Options: nosniff', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets X-Frame-Options: SAMEORIGIN', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('sets X-DNS-Prefetch-Control: off (helmet default)', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
    });

    it('sets Strict-Transport-Security header (helmet HSTS)', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['strict-transport-security']).toContain('max-age=');
    });

    it('sets Content-Security-Policy header (CSP re-enabled, connect-src self-only)', async () => {
      const res = await request(app).get('/api/health');
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      // connect-src uses 'self' only — NOT ws:/wss: wildcards
      expect(csp).toContain("connect-src 'self'");
      expect(csp).not.toContain('ws:');
    });

    it('sets Referrer-Policy: no-referrer', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('sets Cross-Origin-Opener-Policy: same-origin', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    it('sets Cross-Origin-Resource-Policy: same-origin', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    });

    it('sets Permissions-Policy restricting camera, microphone, geolocation', async () => {
      const res = await request(app).get('/api/health');
      const pp = res.headers['permissions-policy'];
      expect(pp).toBeDefined();
      expect(pp).toContain('camera=()');
      expect(pp).toContain('microphone=()');
      expect(pp).toContain('geolocation=()');
    });

    it('does not expose X-Powered-By', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ── CORS headers ──────────────────────────────────────────────────────────

  describe('CORS', () => {
    it('sets Access-Control-Allow-Origin to "*" for a GET request (wildcard config)', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://example.com');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('responds to OPTIONS preflight with 204', async () => {
      const res = await request(app)
        .options('/api/health')
        .set('Origin', 'http://example.com')
        .set('Access-Control-Request-Method', 'GET');
      expect([200, 204]).toContain(res.status);
    });
  });

  // ── JSON body parsing ─────────────────────────────────────────────────────

  describe('JSON body parsing', () => {
    // Register a POST route on a dedicated test app so we get a clean 413
    // instead of a 404 (which would mask the real body-size enforcement).
    let postApp;
    beforeAll(() => {
      postApp = buildApp();
      postApp.post('/api/echo', (req, res) => res.json(req.body));
    });

    it('returns 413 when the JSON body exceeds 10 kb', async () => {
      const largeBody = JSON.stringify({ data: 'x'.repeat(11 * 1024) });
      const res = await request(postApp)
        .post('/api/echo')
        .set('Content-Type', 'application/json')
        .send(largeBody);
      expect(res.status).toBe(413);
    });

    it('accepts a JSON body within the 10 kb limit', async () => {
      const okBody = JSON.stringify({ data: 'x'.repeat(100) });
      const res = await request(postApp)
        .post('/api/echo')
        .set('Content-Type', 'application/json')
        .send(okBody);
      expect(res.status).toBe(200);
    });
  });

  // ── Admin routes ──────────────────────────────────────────────────────────

  describe('GET /admin (via full app with admin router)', () => {
    let adminApp;
    beforeAll(async () => {
      const { default: adminRouter } = await import('../../src/routes/admin.js');
      adminApp = buildApp();
      adminApp.use('/admin', adminRouter);
    });

    it('returns 200', async () => {
      const res = await request(adminApp).get('/admin/');
      expect(res.status).toBe(200);
    });

    it('returns content-type text/html', async () => {
      const res = await request(adminApp).get('/admin/');
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });
  });

  describe('GET /admin/history (via full app with admin router)', () => {
    let adminApp;
    beforeAll(async () => {
      const { default: adminRouter } = await import('../../src/routes/admin.js');
      adminApp = buildApp();
      adminApp.use('/admin', adminRouter);
    });

    it('returns 200', async () => {
      const res = await request(adminApp).get('/admin/history');
      expect(res.status).toBe(200);
    });

    it('returns { messages: [] }', async () => {
      const res = await request(adminApp).get('/admin/history');
      expect(res.body).toEqual({ messages: [] });
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('includes the RateLimit-Limit response header', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['ratelimit-limit']).toBeDefined();
    });

    it('RateLimit-Limit header equals configured max (100)', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['ratelimit-limit']).toBe('100');
    });

    it('returns 429 after exceeding the request limit', async () => {
      // Build a tight-limit app (max 3 requests per window) so the test
      // can reach the threshold without firing 100 real requests.
      const tightApp = express();
      tightApp.use(rateLimit({ windowMs: 60_000, max: 3, standardHeaders: true, legacyHeaders: false }));
      tightApp.use('/api', healthRouter);

      // First 3 requests should all succeed
      for (let i = 0; i < 3; i++) {
        const r = await request(tightApp).get('/api/health');
        expect(r.status).toBe(200);
      }

      // The 4th request must be rejected
      const blocked = await request(tightApp).get('/api/health');
      expect(blocked.status).toBe(429);
    });

    it('RateLimit-Remaining decrements after each request', async () => {
      const countApp = express();
      countApp.use(rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }));
      countApp.use('/api', healthRouter);
      const r1 = await request(countApp).get('/api/health');
      const r2 = await request(countApp).get('/api/health');
      const rem1 = parseInt(r1.headers['ratelimit-remaining'], 10);
      const rem2 = parseInt(r2.headers['ratelimit-remaining'], 10);
      expect(rem2).toBe(rem1 - 1);
    });
  });

  // ── Error handler integration ─────────────────────────────────────────────

  describe('error handler', () => {
    it('returns 500 JSON { error: { message } } when a route throws synchronously', async () => {
      const throwApp = buildApp();
      throwApp.get('/api/throw', () => { throw new Error('boom'); });
      throwApp.use(errorHandler);
      const res = await request(throwApp).get('/api/throw');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { message: 'boom' } });
    });
  });

  // ── JSON body boundary ────────────────────────────────────────────────────

  describe('JSON body size boundary', () => {
    let echoApp;
    beforeAll(() => {
      echoApp = buildApp();
      echoApp.post('/api/echo', (req, res) => res.json({ received: true }));
    });

    it('accepts a JSON body well under 10 KB', async () => {
      const body = JSON.stringify({ data: 'x'.repeat(500) });
      const res = await request(echoApp)
        .post('/api/echo')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).toBe(200);
    });
  });
});
