# Documentation Index

Buzz App is a real-time local-network messaging tool. A son sends buzzes, messages, location pings, and status updates from his phone to a Node.js server on the home network; his dad replies from a localhost-only admin panel. All messages are permanently logged. This directory contains technical documentation for developers and operators.

> **User guide:** See [`README.md`](../README.md) for installation, quick start, and features overview.
> **Contributors:** See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for development setup and coding conventions.

---

## Reference Docs

| Document | Purpose |
|----------|---------|
| [`api.md`](api.md) | Complete HTTP endpoint and Socket.IO event reference with payload schemas |
| [`architecture.md`](architecture.md) | System design, module responsibilities, data flow, startup and shutdown sequences |
| [`deployment.md`](deployment.md) | Installation, environment variables, service management, reverse proxy, troubleshooting |
| [`features.md`](features.md) | All user-facing features described from the son's and dad's perspective |
| [`security.md`](security.md) | Threat model, active protections, known limitations, production hardening checklist |
| [`testing.md`](testing.md) | Test strategy, structure, mocking patterns, writing new tests, CI considerations |

---

## Architecture Decision Records

Formally documented architectural choices explaining what was decided, why, and what the trade-offs are.

| ADR | Title | Status |
|-----|-------|--------|
| [README](adr/README.md) | Index and instructions for creating new ADRs | — |
| [0001](adr/0001-socket-io-over-raw-websockets.md) | Socket.IO over raw WebSockets | Accepted |
| [0002](adr/0002-jsonl-append-only-log.md) | JSONL append-only log over a database | Accepted |
| [0003](adr/0003-map-based-sliding-window-rate-limiting.md) | Map-based sliding-window rate limiting | Accepted |
| [0004](adr/0004-fire-and-forget-for-side-effects.md) | Fire-and-forget for messageLog and audioAlert | Accepted |
| [0005](adr/0005-two-layer-admin-auth.md) | Two-layer admin authentication | Accepted |
| [0006](adr/0006-vanilla-frontend-no-build-step.md) | Vanilla HTML/CSS/JS frontend — no build step | Accepted |

---

## Feature Documentation

| Document | Purpose |
|----------|---------|
| [`matrix-shutdown.md`](matrix-shutdown.md) | Complete reference for the matrix shutdown animation — the 6-phase cinematic sequence triggered when the server shuts down |

---

## Design Archives

These are pre-implementation design documents. The features they describe are now built.

| Document | Status |
|----------|--------|
| [`matrix-shutdown-plan.md`](matrix-shutdown-plan.md) | Original design specification for the matrix shutdown animation. The feature is now implemented in `public/matrix.js`. See [`matrix-shutdown.md`](matrix-shutdown.md) for the current as-implemented reference. |
| [`matrix-shutdown-audit.md`](matrix-shutdown-audit.md) | Pre-implementation audit of the design specification. Issues were addressed during development — `public/matrix.js` references resolved items by audit number (e.g. `// audit #3`, `// audit #42`). |

---

## Tech Debt

| Document | Purpose |
|----------|---------|
| [`tech-debt.md`](tech-debt.md) | Prioritised register of known code, architecture, security, and documentation debt |
