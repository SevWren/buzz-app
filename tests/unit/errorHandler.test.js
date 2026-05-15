/**
 * Unit tests for src/middleware/errorHandler.js
 *
 * The logger is mocked so tests don't produce output and so we can assert
 * that logging is called correctly without needing a real pino instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { logger } from '../../src/lib/logger.js';

vi.mock('../../src/lib/logger.js', () => ({
  logger: { error: vi.fn() },
}));
vi.mock('../../src/config/index.js', () => ({
  config: { nodeEnv: 'test' },
}));

describe('errorHandler middleware', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { path: '/test' };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  // ── HTTP status code selection ────────────────────────────────────────────

  it('responds with 500 for a generic Error', () => {
    errorHandler(new Error('something broke'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('uses err.status when provided', () => {
    const err = Object.assign(new Error('Not Found'), { status: 404 });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('falls back to err.statusCode when err.status is absent', () => {
    const err = Object.assign(new Error('Forbidden'), { statusCode: 403 });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('prefers err.status over err.statusCode', () => {
    const err = Object.assign(new Error('Conflict'), { status: 409, statusCode: 500 });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  // ── Response body ─────────────────────────────────────────────────────────

  it('includes the error message in the JSON body', () => {
    errorHandler(new Error('something broke'), req, res, next);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: 'something broke' },
    });
  });

  it('falls back to "Internal Server Error" when err has no message', () => {
    errorHandler({}, req, res, next);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: 'Internal Server Error' },
    });
  });

  // ── Logging ───────────────────────────────────────────────────────────────

  it('calls logger.error with the error, request path, and exact message', () => {
    const err = new Error('oops');
    errorHandler(err, req, res, next);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err, path: '/test' }),
      'Unhandled request error',
    );
  });

  it('logs every error, not just 5xx', () => {
    const err = Object.assign(new Error('Not Found'), { status: 404 });
    errorHandler(err, req, res, next);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  // ── Middleware contract ───────────────────────────────────────────────────

  it('does not call next() — the response is terminal', () => {
    errorHandler(new Error('test'), req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls res.status before res.json', () => {
    const callOrder = [];
    res.status.mockImplementation(() => { callOrder.push('status'); return res; });
    res.json.mockImplementation(() => { callOrder.push('json'); return res; });

    errorHandler(new Error('test'), req, res, next);

    expect(callOrder).toEqual(['status', 'json']);
  });

  // ── Valid status boundary values ──────────────────────────────────────────

  it('accepts err.status=400 (minimum valid 4xx boundary)', () => {
    errorHandler(Object.assign(new Error('Bad Request'), { status: 400 }), req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts err.status=599 (maximum valid 5xx boundary)', () => {
    errorHandler(Object.assign(new Error('Server Error'), { status: 599 }), req, res, next);
    expect(res.status).toHaveBeenCalledWith(599);
  });

  it('falls back to 500 for err.status=399 (just below 4xx range)', () => {
    // 399 < 400 → out of valid range
    errorHandler({ status: 399, message: 'x' }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('falls back to 500 for err.status=600 (just above 5xx range)', () => {
    // 600 > 599 → out of valid range
    errorHandler({ status: 600, message: 'x' }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // ── Bogus err.status values ───────────────────────────────────────────────
  // Source: Number.isInteger(raw) && raw >= 400 && raw <= 599

  it('falls back to 500 when err.status is NaN', () => {
    errorHandler({ status: NaN, message: 'x' }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('falls back to 500 when err.status is 999 (out of HTTP range)', () => {
    errorHandler({ status: 999, message: 'x' }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('falls back to 500 when err.status is -1', () => {
    errorHandler({ status: -1, message: 'x' }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('falls back to 500 when err.status is "404" (string, not integer)', () => {
    // Number.isInteger('404') === false
    errorHandler({ status: '404', message: 'Not Found' }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('falls back to 500 when err.status is 0', () => {
    // 0 < 400, so not in valid HTTP error range
    errorHandler({ status: 0, message: 'x' }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('falls back to 500 when err.status is 3.14 (float)', () => {
    // Number.isInteger(3.14) === false
    errorHandler({ status: 3.14, message: 'x' }, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // ── Non-object error types ────────────────────────────────────────────────

  it('handles null error gracefully — responds 500 without throwing', () => {
    // The null guard normalises null to new Error('Internal Server Error')
    expect(() => errorHandler(null, req, res, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { message: 'Internal Server Error' } });
  });

  it('handles string error without throwing', () => {
    // String 'oops' → new Error('oops') → message is 'oops'
    errorHandler('oops', req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { message: 'oops' } });
  });

  // ── Production 5xx message masking ────────────────────────────────────────

  describe('in production (NODE_ENV=production)', () => {
    // Re-import the handler with a production config mock for these tests
    let prodHandler;

    beforeEach(async () => {
      vi.resetModules();
      vi.doMock('../../src/config/index.js', () => ({
        config: { nodeEnv: 'production' },
      }));
      vi.doMock('../../src/lib/logger.js', () => ({
        logger: { error: vi.fn() },
      }));
      const mod = await import('../../src/middleware/errorHandler.js');
      prodHandler = mod.errorHandler;
    });

    it('masks 5xx message in production (returns "Internal Server Error")', () => {
      prodHandler(new Error('secret internal detail'), req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        error: { message: 'Internal Server Error' },
      });
    });

    it('reveals 4xx message in production (client error is not masked)', () => {
      const err = Object.assign(new Error('Not Found'), { status: 404 });
      prodHandler(err, req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        error: { message: 'Not Found' },
      });
    });
  });
});
