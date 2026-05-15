import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn() },
}));

import { adminGuard } from '../../src/middleware/adminGuard.js';
import { logger }     from '../../src/lib/logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReq(ip) {
  return { ip, socket: { remoteAddress: ip } };
}

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('adminGuard middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls next() for req.ip "127.0.0.1"', () => {
    const next = vi.fn();
    adminGuard(makeReq('127.0.0.1'), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() for req.ip "::1"', () => {
    const next = vi.fn();
    adminGuard(makeReq('::1'), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() for req.ip "::ffff:127.0.0.1" (IPv4-mapped loopback)', () => {
    const next = vi.fn();
    adminGuard(makeReq('::ffff:127.0.0.1'), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 403 for req.ip "192.168.1.50"', () => {
    const res = makeRes();
    adminGuard(makeReq('192.168.1.50'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 for req.ip "10.0.0.1"', () => {
    const res = makeRes();
    adminGuard(makeReq('10.0.0.1'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does NOT call next() when IP is rejected', () => {
    const next = vi.fn();
    adminGuard(makeReq('192.168.1.50'), makeRes(), next);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls logger.warn with the denied IP', () => {
    adminGuard(makeReq('192.168.1.50'), makeRes(), vi.fn());
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '192.168.1.50' }),
      expect.any(String),
    );
  });

  it('res.json body has error field', () => {
    const res = makeRes();
    adminGuard(makeReq('192.168.1.50'), res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('falls back to req.socket.remoteAddress when req.ip is undefined', () => {
    const next = vi.fn();
    const req  = { ip: undefined, socket: { remoteAddress: '127.0.0.1' } };
    adminGuard(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 403 for empty string IP (treats as non-local)', () => {
    const res = makeRes();
    adminGuard({ ip: '', socket: { remoteAddress: '' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
