# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Buzz App. ADRs document significant design choices — what was decided, why, what alternatives were considered, and what the consequences are.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-socket-io-over-raw-websockets.md) | Socket.IO over raw WebSockets | Accepted | 2026-05-26 |
| [0002](0002-jsonl-append-only-log.md) | JSONL append-only log over a database | Accepted | 2026-05-26 |
| [0003](0003-map-based-sliding-window-rate-limiting.md) | Map-based sliding-window rate limiting | Accepted | 2026-05-26 |
| [0004](0004-fire-and-forget-for-side-effects.md) | Fire-and-forget for messageLog and audioAlert | Accepted | 2026-05-26 |
| [0005](0005-two-layer-admin-auth.md) | Two-layer admin authentication | Accepted | 2026-05-26 |
| [0006](0006-vanilla-frontend-no-build-step.md) | Vanilla HTML/CSS/JS frontend — no build step | Accepted | 2026-05-26 |
| [0007](0007-admin-room-scoping-for-inbound-events.md) | Admin room scoping for inbound Socket.IO events | Accepted | 2026-05-26 |

## Status lifecycle

`Proposed` → `Accepted` → `Deprecated` / `Superseded` / `Rejected`

## Creating a new ADR

1. Copy the template below into a new file numbered sequentially: `NNNN-short-title.md`
2. Fill in all sections — do not leave placeholders
3. Add a row to the index table above
4. Status starts as `Proposed`; update to `Accepted` once the team agrees

### Template

```markdown
# NNN — Title

## Status

Proposed

## Context

[What is the situation that led to this decision?]

## Decision Drivers

- [Driver 1]
- [Driver 2]

## Considered Options

- [Option A]
- [Option B]

## Decision Outcome

Chosen option: **[Option X]**

## Rationale

[Why was this option chosen?]

## Consequences

### Positive
- [Benefit 1]

### Negative
- [Drawback 1]

### Risks
- [Risk 1]

## Related Decisions

- [ADR-NNNN](NNNN-title.md) — [relationship]
```
