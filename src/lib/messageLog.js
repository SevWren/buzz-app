import { appendFile, readFile, mkdir, stat, rename } from 'node:fs/promises';
import { dirname, join }               from 'node:path';
import { fileURLToPath }               from 'node:url';
import { randomUUID }                  from 'node:crypto';
import { logger }                      from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const LOG_PATH   = join(__dirname, '..', '..', 'data', 'messages.jsonl');
const DATA_DIR   = join(__dirname, '..', '..', 'data');

// BUG-15: memoize the mkdir call so it only hits the OS once per process lifetime.
// mkdir with recursive:true is a no-op if the dir exists, but it is still a syscall.
let dataDirReady = false;
async function ensureDataDir() {
  if (dataDirReady) return;
  await mkdir(DATA_DIR, { recursive: true });
  dataDirReady = true;
}

// BUG-17: rotate the log when it exceeds 10 MB to prevent unbounded disk growth.
// Keeps one archive (.jsonl.1); next write starts a fresh log automatically.
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB
async function maybeRotate() {
  try {
    const { size } = await stat(LOG_PATH);
    if (size > MAX_LOG_BYTES) {
      await rename(LOG_PATH, LOG_PATH + '.1');
    }
  } catch {
    // ENOENT (file not yet created) or stat failure — nothing to rotate
  }
}

/**
 * Append a message record to data/messages.jsonl.
 * Creates the data/ directory if it does not exist.
 * Never throws — a log failure must not crash the server.
 *
 * @param {{ direction: 'in'|'out', type: string, socketId: string, payload: object }} record
 * @returns {Promise<void>}
 */
export async function appendMessage(record) {
  // Validate and coerce all fields to their expected types before persisting.
  // socket.js always passes correct types, but defensive coercion prevents
  // accidental non-string values from corrupting the JSONL log or bypassing
  // any downstream parsing that depends on field types.
  if (!record || typeof record !== 'object') return;

  // Cap field lengths to prevent excessively long strings from being persisted.
  // All legitimate values are well under these limits; truncation only affects
  // accidental misuse or malformed calls from future code changes.
  const MAX_FIELD_LEN = 128;
  const direction = typeof record.direction === 'string'
    ? record.direction.slice(0, MAX_FIELD_LEN) : '';
  const type      = typeof record.type      === 'string'
    ? record.type.slice(0, MAX_FIELD_LEN)      : '';
  const socketId  = typeof record.socketId  === 'string'
    ? record.socketId.slice(0, MAX_FIELD_LEN)  : '';
  // BUG-31: cap payload size to prevent oversized objects from writing unbounded JSONL entries.
  // 4 KB is well above any legitimate payload (largest: 500-char message ≈ 520 bytes).
  const MAX_PAYLOAD_BYTES = 4096;
  let rawPayload =
    record.payload !== null && typeof record.payload === 'object'
      ? record.payload
      : {};
  const payload = JSON.stringify(rawPayload).length <= MAX_PAYLOAD_BYTES ? rawPayload : {};

  const line =
    JSON.stringify({
      id:        randomUUID(),
      ts:        new Date().toISOString(),
      direction,
      type,
      socketId,
      payload,
    }) + '\n';
  try {
    await ensureDataDir();
    await appendFile(LOG_PATH, line, 'utf8');
    await maybeRotate(); // BUG-17: rotate after write if file exceeds 10 MB
  } catch (err) {
    // Log only code and message — never the full err object, which can contain
    // file-system paths from Node.js stack traces.
    logger.error({ errCode: err?.code, errMessage: err?.message }, 'messageLog: append failed');
  }
}

/**
 * Return the most recent `limit` records from the log, oldest-first.
 * Returns [] if the file does not exist or any error occurs.
 *
 * @param {number} [limit=100]
 * @returns {Promise<object[]>}
 */
export async function readRecentMessages(limit = 100) {
  if (limit === 0) return []; // BUG-03: slice(-0) === slice(0) returns all records
  try {
    const raw    = await readFile(LOG_PATH, 'utf8');
    const lines  = raw.split('\n').filter(l => l.trim() !== '');
    const recent = lines.slice(-limit);
    const parsed = [];
    for (const line of recent) {
      try {
        const record = JSON.parse(line);
        // Validate required fields — skip records where the log entry is corrupted
        // or was written by a different version. This prevents malformed/injected
        // log entries from reaching the admin panel as arbitrary objects.
        if (
          record !== null &&
          typeof record === 'object' &&
          typeof record.id        === 'string' &&
          typeof record.ts        === 'string' &&
          typeof record.direction === 'string' &&
          typeof record.type      === 'string' &&
          typeof record.socketId  === 'string' &&
          record.payload !== undefined
        ) {
          parsed.push(record);
        }
      } catch {
        // Skip malformed lines
      }
    }
    return parsed; // oldest-first (file is append-order)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Log only code and message — never the full err object (see append comment).
      logger.warn({ errCode: err?.code, errMessage: err?.message }, 'messageLog: read failed');
    }
    return [];
  }
}
