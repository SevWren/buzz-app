# Technical Debt Register

Prioritised register of known code, architecture, security, and documentation debt in Buzz App.

**Scoring formula:** `(Impact + Risk) × (6 - Effort)` on a 1–5 scale per dimension. Higher score = more urgent.

Last updated: 2025-05-26

---

## Summary Table

| Score | Category | Item |
|-------|----------|------|
| 24 | Infrastructure | `data/messages.jsonl` grows indefinitely — no log rotation |
| 22 | Architecture | Matrix shutdown audit: verify all 45 issues are addressed in `matrix.js` |
| 20 | Code | `readRecentMessages(0)` returns ALL records due to JS `.slice(-0)` edge case |
| 20 | Code | `CORS_ORIGIN` has no `.trim()` — whitespace passes `.min(1)` validation |
| 18 | Security | CSP `'unsafe-inline'` in `style-src` required due to no build step |
| 15 | Architecture | No ADR for graceful shutdown sequence |
| 14 | Documentation | `public/matrix.js` audit cross-check incomplete |
| 12 | Code | IPv4-only address collection in `scripts/preflight.js` |
| 12 | Code | `MAX_SOCKET_CONNECTIONS` env var not validated for upper bound enforcement |
| 10 | Documentation | Test count in `docs/testing.md` may drift from actual suite |
| 6 | Documentation | `doc-maintenance` skill folder structure not adopted |

---

## Detailed Items

### Score 24 — `data/messages.jsonl` grows indefinitely

**Category:** Infrastructure
**Impact:** 3 — large files slow down `readRecentMessages` on admin panel load
**Risk:** 3 — in long-running deployments the file can become multi-GB
**Effort:** 2 — `logrotate` configuration or a cron archive script

The persistent message log is append-only with no automatic rotation. For occasional home use this is acceptable; for a family that uses the app daily for months, the file can grow significantly.

**Remediation:**
- Linux: configure `logrotate` with `copytruncate` option (see `docs/deployment.md` for an example)
- Any OS: a scheduled task (cron / Task Scheduler) that archives and truncates monthly
- Long-term: add a `--trim-log` CLI option or a log size cap to `messageLog.js`

---

### Score 22 — Matrix shutdown audit cross-check

**Category:** Architecture
**Impact:** 3 — unresolved issues in a complex ~750-line animation could produce visual bugs or runtime errors
**Risk:** 4 — the audit identified 11 CRITICAL issues in the design spec
**Effort:** 4 — requires reviewing all 45 audit items against the current `matrix.js` implementation

`docs/matrix-shutdown-audit.md` identified 45 issues (11 CRITICAL, 15 VISUAL, 6 PERF, 6 MATH, 9 AMBIGUOUS, 8 MISSING) in the pre-implementation design spec. The implementation in `public/matrix.js` references resolved items by number (e.g. `// audit #3`, `// audit #42`). Not all 45 items have confirmed comment references.

**Remediation:** Assign a developer to walk every item in `matrix-shutdown-audit.md` against the current `matrix.js` implementation and either confirm resolution or log a new specific debt item per unresolved finding.

---

### Score 20 — `readRecentMessages(0)` returns all records

**Category:** Code
**Impact:** 2 — callers expecting zero records get everything; admin history endpoint passes 100 so this is not triggered in production
**Risk:** 3 — could cause unexpected behaviour if a new caller passes 0 intending an empty result
**Effort:** 2 — one-line guard

`Array.prototype.slice(-0)` is equivalent to `slice(0)` in JavaScript — it returns the full array. `readRecentMessages(0)` therefore returns all records, not zero.

This is **intentional per current design** and documented in `CLAUDE.md` and `docs/testing.md`. However it is a footgun for future callers.

**Remediation options:**
- Add `if (limit === 0) return []` at the top of `readRecentMessages`
- Or add explicit JSDoc documenting the edge case and marking it as a known trap
- Decision: intentional behaviour — mark as "won't fix" and ensure documentation is sufficient

---

### Score 20 — `CORS_ORIGIN` no `.trim()` in Zod schema

**Category:** Code
**Impact:** 2 — whitespace-only `CORS_ORIGIN` value would pass `.min(1)` and silently allow all origins
**Risk:** 3 — easy misconfiguration, hard to debug (server starts successfully but CORS is wide open)
**Effort:** 2 — add `.trim()` to the schema

The `CORS_ORIGIN` Zod schema intentionally omits `.trim()` (noted in `CLAUDE.md`). The reasoning is that a value with whitespace is almost certainly a typo and should fail validation — but a whitespace-only string like `"   "` passes `.min(1)` without `.trim()`.

**Remediation:** This is marked intentional in `CLAUDE.md`. The fix would change the validation contract. Decision: document explicitly as a known footgun, add a test case for whitespace-only `CORS_ORIGIN`.

---

### Score 18 — CSP `'unsafe-inline'` in `style-src`

**Category:** Security
**Impact:** 3 — `'unsafe-inline'` allows inline style injection if an attacker can introduce a `<style>` block
**Risk:** 3 — low likelihood in this app (no user-supplied HTML), but weakens the CSP
**Effort:** 4 — removing it requires either extracting all inline styles or adding per-element nonces (which requires server-side rendering)

`index.html` and `admin.html` contain `<style>` blocks that cannot be served externally without a CSS build step. This forces `'unsafe-inline'` in `style-src`. See [ADR-0006](adr/0006-vanilla-frontend-no-build-step.md) for the trade-off.

**Remediation paths:**
- Move all styles to external `.css` files (straightforward, no build step needed)
- Add a build step (Vite/esbuild) that extracts and hashes styles for nonce-based CSP
- Accept as an acceptable risk for a localhost admin tool

---

### Score 15 — No ADR for graceful shutdown sequence

**Category:** Architecture
**Impact:** 3 — the shutdown sequence has non-obvious ordering constraints (broadcast before disconnect, 300 ms delay, 10 s force-kill) that future contributors may break
**Risk:** 2 — the sequence is documented in `docs/architecture.md` but the rationale for each step is not formalised
**Effort:** 2 — write a single ADR

**Remediation:** Create `docs/adr/0007-graceful-shutdown-sequence.md` documenting the broadcast → delay → disconnect → close → force-kill order and the reasoning behind the 300 ms window.

---

### Score 14 — Matrix shutdown audit items not all confirmed resolved

**Category:** Documentation
**Impact:** 3 — a CRITICAL unresolved issue in a complex animation would be a visible bug
**Risk:** 2 — the implementation appears complete; many audit items have `// audit #N` comments
**Effort:** 3 — requires careful comparison of 45 items against current code

Refer to Score 22 item above. This debt item is the documentation aspect (keeping the audit doc accurate as a historical record of what was fixed vs. what is still pending).

---

### Score 12 — IPv4-only address collection in `scripts/preflight.js`

**Category:** Code
**Impact:** 2 — users on IPv6-only networks see no LAN address in the startup banner
**Risk:** 2 — IPv6-only home networks are uncommon but increasing
**Effort:** 2 — add IPv6 filter alongside existing IPv4 filter

`scripts/preflight.js` filters `os.networkInterfaces()` for `family === 'IPv4'` only. IPv6 LAN addresses are not displayed in the startup banner.

**Remediation:** Add a second filter for `family === 'IPv6'` and `!internal` and display both families, or display the first non-loopback address regardless of family.

---

### Score 12 — `MAX_SOCKET_CONNECTIONS` upper bound not enforced in code

**Category:** Code
**Impact:** 2 — setting a very large value provides no protection
**Risk:** 2 — a misconfigured value could be confusing
**Effort:** 2 — already documented in `docs/deployment.md`; code-level validation is straightforward

The Zod schema for `MAX_SOCKET_CONNECTIONS` validates the range 1–1000. This is documented in `docs/deployment.md`. No additional action required — this item is largely resolved by documentation.

**Status:** Resolved by documentation. Downgrade to "monitor only".

---

### Score 10 — Test count in `docs/testing.md` may drift

**Category:** Documentation
**Impact:** 1 — stale count is cosmetic
**Risk:** 1 — no functional impact
**Effort:** 2 — a CI step asserting count, or simply removing the hardcoded number

The document references a specific test count that will become stale as tests are added. `docs/testing.md` now includes a note to run `npm test` for the current count, but the hardcoded number remains.

**Remediation:** Remove the specific count from the document, or add a CI step that asserts the count matches a stored value.

---

### Score 6 — `doc-maintenance` skill folder structure not adopted

**Category:** Documentation
**Impact:** 1 — navigation could be cleaner with subdirectory organisation
**Risk:** 1 — flat structure is functional
**Effort:** 5 — migrating all existing docs to subdirectories requires updating every cross-reference link

The `doc-maintenance` skill prescribes a subdirectory structure (`docs/architecture/`, `docs/development/`, `docs/testing/`, `docs/security/`, `docs/api/`, etc.). This project uses a flat `docs/` layout.

**Status:** Intentional for a single-developer LAN app. The flat layout is simpler and cross-references are shorter. Revisit if the docs directory grows beyond ~15 files.

---

## Intentional / Won't Fix

| Item | Reason |
|------|--------|
| `readRecentMessages(0)` returns all records | Documented behaviour; callers should not pass `0`. Adding a guard changes semantics. |
| `CORS_ORIGIN` no `.trim()` | Intentional: whitespace in a CORS origin is a typo; the server should exit, not silently trim |
| `'unsafe-inline'` in `style-src` CSP | No build step; would require significant refactoring. Acceptable for localhost admin tool. |
| Flat `docs/` structure | Simpler for small project; not worth the migration cost |
