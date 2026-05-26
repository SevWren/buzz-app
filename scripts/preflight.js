/**
 * Preflight checks — runs automatically before `npm run dev` and `npm start`
 * via the predev / prestart npm lifecycle hooks.
 *
 * Intentionally uses ONLY Node.js built-ins so it is safe to run even before
 * `npm install` has completed (e.g. from start.bat on first launch).
 */

import { existsSync, copyFileSync, readFileSync } from 'fs';
import { networkInterfaces } from 'os';

// ── 1. Ensure .env exists ─────────────────────────────────────────────────────
if (!existsSync('.env')) {
  if (existsSync('.env.example')) {
    copyFileSync('.env.example', '.env');
    console.log('  ✓  Created .env from .env.example');
    console.log('     Edit .env any time to change PORT, LOG_LEVEL, etc.\n');
  }
}

// ── 2. Read PORT from .env without pulling in dotenv ─────────────────────────
function readEnvValue(filePath, key) {
  if (!existsSync(filePath)) return undefined;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
    if (match && match[1] === key) {
      const raw = match[2];
      // BUG-28: only strip matched quote pairs (e.g. "val" or 'val'), not mismatched ones
      return (/^(['"])(.*)\1$/.test(raw)) ? raw.slice(1, -1) : raw.trim();
    }
  }
  return undefined;
}

const port = readEnvValue('.env', 'PORT') ?? process.env.PORT ?? '3000';

// ── 3. Collect every non-loopback IPv4 address (LAN access) ──────────────────
const lanIPs = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n?.family === 'IPv4' && !n.internal)
  .map((n) => n.address);

// ── 4. Print startup banner ───────────────────────────────────────────────────
const bar = '─'.repeat(46);
console.log(`\n  ${bar}`);
console.log(`   Buzz App`);
console.log(`  ${bar}`);
console.log(`   Local    →  http://localhost:${port}`);
console.log(`   Admin    →  http://localhost:${port}/admin  ← Dad's reply panel`);
for (const ip of lanIPs) {
  console.log(`   Network  →  http://${ip}:${port}   ← phone / other devices`);
}
console.log(`  ${bar}`);
console.log(`   Press Ctrl+C to stop`);
console.log(`  ${bar}\n`);
