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

  it('calls logger.error with the error and request path', () => {
    const err = new Error('oops');
    errorHandler(err, req, res, next);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err, path: '/test' }),
      expect.any(String)
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
});
