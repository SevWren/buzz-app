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
      'Admin access denied from non-localhost IP',
    );
  });

  it('res.json body has exact error message', () => {
    const res = makeRes();
    adminGuard(makeReq('192.168.1.50'), res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(
      { error: 'Admin access is restricted to localhost only.' },
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

  // ── Both IP sources undefined ──────────────────────────────────────────────
  // Source: req.ip ?? req.socket?.remoteAddress ?? '' → '' → 403

  it('returns 403 when both req.ip and req.socket are undefined', () => {
    const res = makeRes();
    adminGuard({ ip: undefined, socket: undefined }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 when req.socket.remoteAddress is undefined and req.ip is undefined', () => {
    const res = makeRes();
    adminGuard({ ip: undefined, socket: { remoteAddress: undefined } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── Non-local IPv4-mapped addresses ───────────────────────────────────────
  // Source: ::ffff:10.0.0.1 → stripped to 10.0.0.1 → not local

  it('returns 403 for ::ffff:10.0.0.1 (non-local IPv4-mapped)', () => {
    const next = vi.fn();
    const res  = makeRes();
    adminGuard(makeReq('::ffff:10.0.0.1'), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for ::ffff:192.168.1.1 (non-local IPv4-mapped LAN)', () => {
    const res = makeRes();
    adminGuard(makeReq('::ffff:192.168.1.1'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── Whitespace in IP string ────────────────────────────────────────────────
  // Source: exact string comparison — ' 127.0.0.1' !== '127.0.0.1'

  it('returns 403 for " 127.0.0.1" (leading space)', () => {
    const res = makeRes();
    adminGuard(makeReq(' 127.0.0.1'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 for "127.0.0.1 " (trailing space)', () => {
    const res = makeRes();
    adminGuard(makeReq('127.0.0.1 '), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
