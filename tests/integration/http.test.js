/**
 * Integration tests for the HTTP layer.
 *
 * Builds the full Express app (with all production middleware) but does NOT
 * call httpServer.listen() — supertest handles the binding internally.
 * This means tests exercise real middleware interaction: helmet headers,
 * CORS, rate limiting, and routing, all wired together.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import healthRouter from '../../src/routes/health.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '10kb' }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
  app.use('/api', healthRouter);
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

    it('sets X-Frame-Options', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-frame-options']).toBeDefined();
    });

    it('sets X-DNS-Prefetch-Control', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    });

    it('does not expose X-Powered-By', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ── CORS headers ──────────────────────────────────────────────────────────

  describe('CORS', () => {
    it('sets Access-Control-Allow-Origin for a GET request', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://example.com');
      expect(res.headers['access-control-allow-origin']).toBeDefined();
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

  // ── Rate limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('includes the RateLimit-Limit response header', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['ratelimit-limit']).toBeDefined();
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
  });
});
