/**
 * Unit tests for src/routes/health.js
 *
 * Mounts the router on a minimal Express app and fires HTTP requests
 * with supertest — no real network port is opened.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRouter from '../../src/routes/health.js';

let app;

beforeAll(() => {
  app = express();
  app.use('/api', healthRouter);
});

describe('GET /api/health', () => {
  it('responds with HTTP 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('responds with JSON content-type', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  // ── Response shape ────────────────────────────────────────────────────────

  it('body.status is "ok"', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('ok');
  });

  it('body.uptime is a non-negative number', async () => {
    const res = await request(app).get('/api/health');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('body.timestamp is a valid ISO 8601 string', async () => {
    const res = await request(app).get('/api/health');
    const parsed = new Date(res.body.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.toISOString()).toBe(res.body.timestamp);
  });

  it('body.timestamp is recent (within the last 5 seconds)', async () => {
    const before = Date.now();
    const res = await request(app).get('/api/health');
    const after = Date.now();
    const ts = new Date(res.body.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('body contains exactly the expected keys', async () => {
    const res = await request(app).get('/api/health');
    expect(Object.keys(res.body).sort()).toEqual(['status', 'timestamp', 'uptime'].sort());
  });

  // ── Consecutive calls ─────────────────────────────────────────────────────

  it('uptime increases (or stays equal) between consecutive calls', async () => {
    const first = await request(app).get('/api/health');
    const second = await request(app).get('/api/health');
    expect(second.body.uptime).toBeGreaterThanOrEqual(first.body.uptime);
  });

  // ── Cache-Control header ──────────────────────────────────────────────────
  // Source: res.set('Cache-Control', 'no-store') in health.js:8

  it('sets Cache-Control: no-store header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  // ── Content-Type charset ──────────────────────────────────────────────────

  it('Content-Type includes charset=utf-8', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-type']).toMatch(/charset=utf-8/i);
  });

  // ── uptime precision ──────────────────────────────────────────────────────
  // Source: Math.floor(process.uptime()) — always a finite, non-negative integer

  it('body.uptime is a finite non-negative integer (Math.floor guarantees integer)', async () => {
    const res = await request(app).get('/api/health');
    expect(Number.isFinite(res.body.uptime)).toBe(true);
    expect(Number.isInteger(res.body.uptime)).toBe(true);
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});
