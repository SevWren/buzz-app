/**
 * Unit tests for src/config/index.js
 *
 * Two complementary strategies:
 *
 * 1. Schema tests — import `envSchema` directly and call `.safeParse()`.
 *    Covers invalid inputs (bad PORT, out-of-range, wrong NODE_ENV …) without
 *    triggering the process.exit(1) that fires on startup validation failure.
 *
 * 2. Config integration tests — mock dotenv, vi.resetModules(), then
 *    dynamically import config to get a fresh evaluation per test.
 *    Covers that valid env vars are wired through to the exported `config`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Prevent dotenv from reading the .env file during unit tests.
// vi.mock is hoisted above imports by Vitest's transformer.
vi.mock('dotenv/config', () => ({}));

const TESTED_KEYS = ['PORT', 'NODE_ENV', 'LOG_LEVEL', 'CORS_ORIGIN'];

describe('src/config/index.js', () => {
  const saved = {};

  beforeEach(() => {
    // Reset the module registry so each test imports a fresh config module
    vi.resetModules();

    // Save then clear the env vars we will be manipulating
    for (const key of TESTED_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env vars
    for (const key of TESTED_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  // ── port ─────────────────────────────────────────────────────────────────

  it('port defaults to 3000 when PORT is not set', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.port).toBe(3000);
  });

  it('reads PORT from the environment', async () => {
    process.env.PORT = '8080';
    const { config } = await import('../../src/config/index.js');
    expect(config.port).toBe(8080);
  });

  it('coerces PORT to a Number (not a string)', async () => {
    process.env.PORT = '4500';
    const { config } = await import('../../src/config/index.js');
    expect(typeof config.port).toBe('number');
  });

  // ── nodeEnv ───────────────────────────────────────────────────────────────

  it('nodeEnv defaults to "development"', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.nodeEnv).toBe('development');
  });

  it('reads NODE_ENV from the environment', async () => {
    process.env.NODE_ENV = 'production';
    const { config } = await import('../../src/config/index.js');
    expect(config.nodeEnv).toBe('production');
  });

  // ── logLevel ──────────────────────────────────────────────────────────────

  it('logLevel defaults to "info"', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.logLevel).toBe('info');
  });

  it('reads LOG_LEVEL from the environment', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { config } = await import('../../src/config/index.js');
    expect(config.logLevel).toBe('debug');
  });

  // ── cors ──────────────────────────────────────────────────────────────────

  it('cors.origin defaults to wildcard "*"', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.cors.origin).toBe('*');
  });

  it('reads CORS_ORIGIN from the environment', async () => {
    process.env.CORS_ORIGIN = 'http://192.168.1.50:3000';
    const { config } = await import('../../src/config/index.js');
    expect(config.cors.origin).toBe('http://192.168.1.50:3000');
  });

  // ── rateLimit ─────────────────────────────────────────────────────────────

  it('rateLimit.windowMs equals 15 minutes in milliseconds', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.rateLimit.windowMs).toBe(15 * 60 * 1000);
  });

  it('rateLimit.max defaults to 100', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.rateLimit.max).toBe(100);
  });
});

// ── Zod schema validation (envSchema) ────────────────────────────────────────
// These tests exercise the validation logic directly, without triggering the
// process.exit(1) that config.js calls when the real process starts with bad env.

describe('envSchema validation', () => {
  let envSchema;

  beforeEach(async () => {
    vi.resetModules();
    ({ envSchema } = await import('../../src/config/index.js'));
  });

  // ── PORT ──────────────────────────────────────────────────────────────────

  it('rejects PORT=0 (ports must be >= 1)', () => {
    const result = envSchema.safeParse({ PORT: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects PORT=65536 (above max valid TCP port)', () => {
    const result = envSchema.safeParse({ PORT: '65536' });
    expect(result.success).toBe(false);
  });

  it('rejects PORT="abc" (non-numeric string)', () => {
    const result = envSchema.safeParse({ PORT: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects PORT="" (empty string)', () => {
    const result = envSchema.safeParse({ PORT: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a floating-point PORT', () => {
    const result = envSchema.safeParse({ PORT: '3000.5' });
    expect(result.success).toBe(false);
  });

  it('accepts PORT=1 (minimum valid port)', () => {
    const result = envSchema.safeParse({ PORT: '1' });
    expect(result.success).toBe(true);
    expect(result.data.PORT).toBe(1);
  });

  it('accepts PORT=65535 (maximum valid port)', () => {
    const result = envSchema.safeParse({ PORT: '65535' });
    expect(result.success).toBe(true);
    expect(result.data.PORT).toBe(65535);
  });

  // ── NODE_ENV ──────────────────────────────────────────────────────────────

  it('rejects NODE_ENV="staging" (not in allowed set)', () => {
    const result = envSchema.safeParse({ NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
  });

  it('rejects NODE_ENV="PRODUCTION" (case-sensitive)', () => {
    const result = envSchema.safeParse({ NODE_ENV: 'PRODUCTION' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid NODE_ENV values', () => {
    for (const env of ['development', 'test', 'production']) {
      expect(envSchema.safeParse({ NODE_ENV: env }).success).toBe(true);
    }
  });

  // ── LOG_LEVEL ─────────────────────────────────────────────────────────────

  it('rejects LOG_LEVEL="verbose" (not a pino level)', () => {
    const result = envSchema.safeParse({ LOG_LEVEL: 'verbose' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid LOG_LEVEL values', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']) {
      expect(envSchema.safeParse({ LOG_LEVEL: level }).success).toBe(true);
    }
  });

  // ── CORS_ORIGIN ───────────────────────────────────────────────────────────

  it('rejects CORS_ORIGIN="" (empty string)', () => {
    const result = envSchema.safeParse({ CORS_ORIGIN: '' });
    expect(result.success).toBe(false);
  });

  // ── Defaults ──────────────────────────────────────────────────────────────

  it('applies all defaults when no env vars are set', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data.PORT).toBe(3000);
    expect(result.data.NODE_ENV).toBe('development');
    expect(result.data.LOG_LEVEL).toBe('info');
    expect(result.data.CORS_ORIGIN).toBe('*');
  });

  // ── CORS_ORIGIN whitespace behavior ───────────────────────────────────────
  // Source: z.string().min(1) with NO .trim() — whitespace-only strings pass

  // ── MAX_SOCKET_CONNECTIONS ────────────────────────────────────────────────

  it('accepts MAX_SOCKET_CONNECTIONS=50 (default)', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data.MAX_SOCKET_CONNECTIONS).toBe(50);
  });

  it('accepts MAX_SOCKET_CONNECTIONS=1 (minimum)', () => {
    const result = envSchema.safeParse({ MAX_SOCKET_CONNECTIONS: '1' });
    expect(result.success).toBe(true);
  });

  it('rejects MAX_SOCKET_CONNECTIONS=0', () => {
    expect(envSchema.safeParse({ MAX_SOCKET_CONNECTIONS: '0' }).success).toBe(false);
  });

  it('rejects MAX_SOCKET_CONNECTIONS=1001', () => {
    expect(envSchema.safeParse({ MAX_SOCKET_CONNECTIONS: '1001' }).success).toBe(false);
  });

  // ── CORS_ORIGIN URL validation ─────────────────────────────────────────────

  it('accepts CORS_ORIGIN="*" (wildcard)', () => {
    expect(envSchema.safeParse({ CORS_ORIGIN: '*' }).success).toBe(true);
  });

  it('accepts CORS_ORIGIN as valid http origin', () => {
    expect(envSchema.safeParse({ CORS_ORIGIN: 'http://192.168.1.50:3000' }).success).toBe(true);
  });

  it('accepts CORS_ORIGIN as valid https origin', () => {
    expect(envSchema.safeParse({ CORS_ORIGIN: 'https://example.com' }).success).toBe(true);
  });

  it('rejects CORS_ORIGIN as a bare hostname (no scheme)', () => {
    expect(envSchema.safeParse({ CORS_ORIGIN: 'localhost:3000' }).success).toBe(false);
  });

  it('rejects CORS_ORIGIN as a single character that is not "*"', () => {
    expect(envSchema.safeParse({ CORS_ORIGIN: 'x' }).success).toBe(false);
  });

  it('rejects CORS_ORIGIN of only whitespace (URL validation now enforced)', () => {
    // The refine() check requires '*' or a valid http/https origin.
    // Whitespace-only strings match neither, so they are rejected.
    const result = envSchema.safeParse({ CORS_ORIGIN: '   ' });
    expect(result.success).toBe(false);
  });

  // ── PORT float variants ───────────────────────────────────────────────────

  it('rejects PORT="1.5" (float string — .int() rejects after coercion)', () => {
    const result = envSchema.safeParse({ PORT: '1.5' });
    expect(result.success).toBe(false);
  });
});

// ── Config object shape ───────────────────────────────────────────────────────

describe('config object shape', () => {
  beforeEach(() => vi.resetModules());

  it('has exactly the expected top-level keys', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(Object.keys(config).sort()).toEqual(
      ['cors', 'logLevel', 'maxSocketConnections', 'nodeEnv', 'port', 'rateLimit'].sort(),
    );
  });

  it('cors has exactly an origin key', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(Object.keys(config.cors)).toEqual(['origin']);
  });

  it('rateLimit has exactly windowMs and max keys', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(Object.keys(config.rateLimit).sort()).toEqual(['max', 'windowMs'].sort());
  });
});
