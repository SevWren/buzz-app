/**
 * Documentation accuracy tests.
 *
 * Each test asserts that a documented claim matches the live source code.
 * These tests follow the TDD red-green pattern used to fix issues #5–#14:
 * the test is written first (fails against the incorrect doc), then the doc
 * is fixed (test passes). This prevents the same accuracy bug from regressing.
 *
 * Tests are purely file-read — no server, no I/O side-effects.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..', '..');
const doc       = (path) => readFileSync(join(ROOT, path), 'utf8');

// ── Issue #5 — readRecentMessages(0) behaviour ────────────────────────────

describe('docs accuracy: readRecentMessages(0) returns []', () => {
  it('docs/testing.md does not describe limit=0 as returning all records', () => {
    const text = doc('docs/testing.md');
    expect(text).not.toMatch(/limit=0 returns all records/);
  });

  it('docs/tech-debt.md does not list readRecentMessages(0) as unfixed debt', () => {
    const text = doc('docs/tech-debt.md');
    expect(text).not.toMatch(/readRecentMessages\(0\) returns ALL records/);
    // Must not appear in the Won't Fix table as an open item
    expect(text).not.toMatch(/readRecentMessages\(0\) returns all records \| Documented behaviour/);
  });

  it('docs/adr/0002 does not describe limit=0 as an unfixed edge case', () => {
    const text = doc('docs/adr/0002-jsonl-append-only-log.md');
    expect(text).not.toMatch(/readRecentMessages\(0\) returns all records because/);
  });
});

// ── Issue #6 — log rotation is built-in ──────────────────────────────────

describe('docs accuracy: log auto-rotates at 10 MB', () => {
  it('docs/deployment.md does not say the file grows indefinitely without qualification', () => {
    const text = doc('docs/deployment.md');
    // The bare unqualified claim must be gone; rotation context is allowed
    expect(text).not.toMatch(/^The file grows indefinitely\./m);
  });

  it('docs/tech-debt.md does not list log rotation as missing', () => {
    const text = doc('docs/tech-debt.md');
    expect(text).not.toMatch(/grows indefinitely — no log rotation/);
  });

  it('docs/adr/0002 does not say log rotation must be configured externally', () => {
    const text = doc('docs/adr/0002-jsonl-append-only-log.md');
    expect(text).not.toMatch(/log rotation must be configured externally/);
  });

  it('docs/security.md does not say log grows indefinitely in production hardening', () => {
    const text = doc('docs/security.md');
    // Item 7 in production hardening should reflect built-in rotation
    expect(text).not.toMatch(/messages\.jsonl grows indefinitely/);
  });
});

// ── Issue #7 — geolocation maximumAge is 0 ───────────────────────────────

describe('docs accuracy: geolocation always returns fresh position', () => {
  it('docs/features.md does not claim a 30-second cached GPS fix', () => {
    const text = doc('docs/features.md');
    expect(text).not.toMatch(/30 seconds old/);
  });
});

// ── Issue #8 — StatusSchema is a discriminated union ─────────────────────

describe('docs accuracy: set-status validates atomic emoji+label pairs', () => {
  it('docs/security.md does not describe set-status as separate enums', () => {
    const text = doc('docs/security.md');
    expect(text).not.toMatch(/separate enums that must be from a fixed list/);
  });
});

// ── Issue #9 — contentSecurityPolicy:false does not exist ────────────────

describe('docs accuracy: CSP is active, not disabled', () => {
  it('docs/security.md does not instruct removing contentSecurityPolicy:false', () => {
    const text = doc('docs/security.md');
    expect(text).not.toMatch(/remove `contentSecurityPolicy: false`/);
  });
});

// ── Issue #10 — ADR-0003 rate limiter implementation ─────────────────────

describe('docs accuracy: ADR-0003 rate limiter is a fixed-window counter', () => {
  it('ADR-0003 does not describe a timestamp array', () => {
    const text = doc('docs/adr/0003-map-based-sliding-window-rate-limiting.md');
    expect(text).not.toMatch(/Map<socketId, timestamp\[\]>/);
    expect(text).not.toMatch(/Timestamp arrays grow/);
    expect(text).not.toMatch(/bounded by `maxCount` timestamps/);
  });

  it('ADR-0003 factory signature shows zero arguments', () => {
    const text = doc('docs/adr/0003-map-based-sliding-window-rate-limiting.md');
    expect(text).not.toMatch(/makeRateLimiter\(maxCount, windowMs\)/);
  });

  it('ADR-0003 rate limit table includes admin-mark-read (9 limiters total)', () => {
    const text = doc('docs/adr/0003-map-based-sliding-window-rate-limiting.md');
    expect(text).not.toMatch(/All 8 rate limiters/);
    expect(text).toMatch(/admin-mark-read/);
  });
});

// ── Issue #11 — ADR-0001 + ADR-0007 for admin room ───────────────────────

describe('docs accuracy: inbound events are admin-room scoped', () => {
  it('ADR-0001 does not claim inbound events broadcast to all clients simultaneously', () => {
    const text = doc('docs/adr/0001-socket-io-over-raw-websockets.md');
    expect(text).not.toMatch(/broadcast received events to all connected clients simultaneously/);
  });

  it('ADR-0001 does not say io.emit() broadcast is a first-class operation without qualification', () => {
    const text = doc('docs/adr/0001-socket-io-over-raw-websockets.md');
    expect(text).not.toMatch(/Broadcast to all clients \(`io\.emit`\) is a first-class operation/);
  });

  it('ADR-0007 exists documenting the admin-room scoping decision', () => {
    expect(existsSync(join(ROOT, 'docs/adr/0007-admin-room-scoping-for-inbound-events.md'))).toBe(true);
  });
});

// ── Issue #12 — CORS trailing-space passes validation ────────────────────

describe('docs accuracy: CORS_ORIGIN trailing-space passes validation', () => {
  it('docs/security.md does not claim trailing whitespace always fails validation', () => {
    const text = doc('docs/security.md');
    expect(text).not.toMatch(/trailing whitespace will fail validation/);
  });
});

// ── Issue #13 — dates, threshold, gitignore phrasing ─────────────────────

describe('docs accuracy: dates, thresholds, and .gitignore phrasing', () => {
  it('docs/adr/README.md uses 2026 not 2025 for ADR dates', () => {
    const text = doc('docs/adr/README.md');
    expect(text).not.toMatch(/2025-05-26/);
  });

  it('docs/tech-debt.md Last updated shows 2026', () => {
    const text = doc('docs/tech-debt.md');
    expect(text).not.toMatch(/Last updated: 2025-05-26/);
  });

  it('CONTRIBUTING.md coverage note mentions 75% branch threshold', () => {
    const text = doc('CONTRIBUTING.md');
    expect(text).not.toMatch(/\(80% thresholds enforced\)/);
  });

  it('docs/security.md gitignore phrasing is not inverted', () => {
    const text = doc('docs/security.md');
    expect(text).not.toMatch(/is excluded from \.gitignore/);
  });
});

// ── Issue #14 — transport coupling requirement ────────────────────────────

describe('docs accuracy: client transport must match server', () => {
  it('ADR-0001 documents the transport coupling requirement', () => {
    const text = doc('docs/adr/0001-socket-io-over-raw-websockets.md');
    expect(text).toMatch(/transport.*match|match.*transport/i);
  });
});
