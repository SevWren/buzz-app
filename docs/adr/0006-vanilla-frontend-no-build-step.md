# 0006 — Vanilla HTML/CSS/JS Frontend — No Build Step

## Status

Accepted

## Context

The app has two browser UIs: the son's phone page (`public/index.html` + `client.js`) and the admin panel (`public/admin.html` + `admin.js`). A choice must be made about the frontend toolchain.

The primary deployment target is a non-technical parent's Windows desktop. Setup must be as simple as double-clicking `start.bat`. Every additional build-time dependency (bundler, transpiler, CSS preprocessor) increases the chance that setup fails on someone's machine.

## Decision Drivers

- Setup must work by running `node src/server.js` with no pre-build step
- The UIs are not complex enough to benefit from a component framework (two pages, each with ~300 lines of UI logic)
- `textContent`-only DOM manipulation is the XSS prevention strategy — this is simpler without template engines
- Static files served directly by Express from `public/` with no build artifacts
- ES modules work natively in all target browsers (Chrome on Android, Chrome/Firefox/Safari on desktop)
- The matrix shutdown animation (`public/matrix.js`) is a complex standalone module that benefits from ES module imports but does not require bundling

## Considered Options

- **React + Vite** — component model, JSX, hot reload; requires `npm run build` before `npm start`; ~200 MB node_modules for the dev toolchain
- **Svelte** — minimal runtime; compile step required
- **Vanilla HTML/CSS/JS with ES modules** — native browser features only; served directly; no compilation
- **jQuery + script tags** — no module system; global namespace; less ergonomic for the event-driven model

## Decision Outcome

Chosen option: **Vanilla HTML/CSS/JS with native ES modules (`type="module"`)**

## Rationale

The UI requirements are well within the reach of vanilla JS. The event-driven model maps directly to Socket.IO event listeners and DOM event handlers. `import`/`export` gives the module isolation needed for `public/matrix.js` without a bundler.

The XSS prevention strategy (`textContent` exclusively, never `innerHTML` on untrusted data) is cleaner without a template engine — the code reads like what it is.

A build step would complicate the Windows deployment: `start.bat` would need to run `npm run build`, handle build errors, and manage output directories. Removing the build step removes an entire class of deployment failure.

The Content Security Policy (`style-src 'self' 'unsafe-inline'`) reflects a remaining limitation: `<style>` blocks exist in `index.html` and `admin.html` because there is no CSS extraction step. See `docs/tech-debt.md` for the tradeoff.

## Consequences

### Positive
- Server starts with `node src/server.js` — no build required
- `start.bat` can be double-clicked on a stock Windows machine without additional tooling
- No build artifacts to manage or commit
- No TypeScript compilation errors blocking a fix during an incident

### Negative
- No TypeScript — type errors surface at runtime, not at compile time
- No CSS preprocessing — styles are inline in HTML or in `<style>` blocks
- `'unsafe-inline'` in `style-src` CSP directive is required (see `docs/security.md`)

### Risks
- As the UI grows more complex, the lack of component isolation and type checking will become a bottleneck. The decision should be revisited if the UI expands significantly beyond its current scope

## Related Decisions

- [ADR-0001](0001-socket-io-over-raw-websockets.md) — the no-build constraint influenced the Socket.IO client choice (CDN-served or self-hosted via socket.io's own static route)
- [ADR-0005](0005-two-layer-admin-auth.md) — IP-based auth is appropriate here precisely because there is no server-side session
