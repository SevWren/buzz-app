import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock before importing the module under test
vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  readFile:   vi.fn().mockResolvedValue(''),   // default: empty file (no records)
  mkdir:      vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { logger } from '../../src/lib/logger.js';

describe('appendMessage', () => {
  // clearAllMocks resets call history; getModule() calls resetModules() before
  // each import so the module under test always gets a fresh module instance
  // whose internal mock references match the top-level imported spy objects.
  beforeEach(() => vi.clearAllMocks());

  async function getModule() {
    vi.resetModules();
    return import('../../src/lib/messageLog.js');
  }

  it('calls mkdir with recursive: true before appendFile', async () => {
    const { appendMessage } = await getModule();
    await appendMessage({ direction: 'in', type: 'buzz', socketId: 'abc', payload: {} });
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('data'), { recursive: true });
    // mkdir must be called before appendFile
    const mkdirOrder = mkdir.mock.invocationCallOrder[0];
    const appendOrder = appendFile.mock.invocationCallOrder[0];
    expect(mkdirOrder).toBeLessThan(appendOrder);
  });

  it('calls appendFile with a string ending in \\n', async () => {
    const { appendMessage } = await getModule();
    await appendMessage({ direction: 'in', type: 'message', socketId: 'x', payload: { text: 'hi' } });
    const [, content] = appendFile.mock.calls[0];
    expect(typeof content).toBe('string');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('written line is valid JSON', async () => {
    const { appendMessage } = await getModule();
    await appendMessage({ direction: 'in', type: 'buzz', socketId: 'x', payload: {} });
    const [, content] = appendFile.mock.calls[0];
    expect(() => JSON.parse(content.trim())).not.toThrow();
  });

  it('written record id matches UUID v4 format', async () => {
    const { appendMessage } = await getModule();
    await appendMessage({ direction: 'in', type: 'buzz', socketId: 'x', payload: {} });
    const [, content] = appendFile.mock.calls[0];
    const record = JSON.parse(content.trim());
    expect(record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('written record ts is ISO 8601', async () => {
    const { appendMessage } = await getModule();
    await appendMessage({ direction: 'in', type: 'buzz', socketId: 'x', payload: {} });
    const [, content] = appendFile.mock.calls[0];
    const record = JSON.parse(content.trim());
    expect(() => new Date(record.ts).toISOString()).not.toThrow();
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('written record contains all input fields', async () => {
    const { appendMessage } = await getModule();
    await appendMessage({
      direction: 'out',
      type:      'reply',
      socketId:  'sock123',
      payload:   { text: 'hello' },
    });
    const [, content] = appendFile.mock.calls[0];
    const record = JSON.parse(content.trim());
    expect(record.direction).toBe('out');
    expect(record.type).toBe('reply');
    expect(record.socketId).toBe('sock123');
    expect(record.payload).toEqual({ text: 'hello' });
  });

  it('does not throw when appendFile rejects', async () => {
    appendFile.mockRejectedValueOnce(new Error('disk full'));
    const { appendMessage } = await getModule();
    await expect(appendMessage({ direction: 'in', type: 'buzz', socketId: 'x', payload: {} }))
      .resolves.toBeUndefined();
  });

  it('calls logger.error when appendFile rejects', async () => {
    appendFile.mockRejectedValueOnce(new Error('disk full'));
    const { appendMessage } = await getModule();
    await appendMessage({ direction: 'in', type: 'buzz', socketId: 'x', payload: {} });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('messageLog'),
    );
  });
});

describe('readRecentMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  async function getModule() {
    vi.resetModules();
    return import('../../src/lib/messageLog.js');
  }

  it('returns [] when readFile throws ENOENT', async () => {
    const err = Object.assign(new Error('no file'), { code: 'ENOENT' });
    readFile.mockRejectedValueOnce(err);
    const { readRecentMessages } = await getModule();
    await expect(readRecentMessages()).resolves.toEqual([]);
  });

  it('returns [] and calls logger.warn on non-ENOENT error', async () => {
    readFile.mockRejectedValueOnce(new Error('permission denied'));
    const { readRecentMessages } = await getModule();
    await expect(readRecentMessages()).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('parses valid JSONL and returns records oldest-first', async () => {
    const lines = [
      JSON.stringify({ id: '1', ts: 't1', direction: 'in', type: 'buzz', socketId: 'x', payload: {} }),
      JSON.stringify({ id: '2', ts: 't2', direction: 'out', type: 'reply', socketId: 'y', payload: { text: 'ok' } }),
    ].join('\n') + '\n';
    readFile.mockResolvedValueOnce(lines);
    const { readRecentMessages } = await getModule();
    const result = await readRecentMessages();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });

  it('skips blank lines', async () => {
    const lines = JSON.stringify({ id: '1', ts: 't', direction: 'in', type: 'buzz', socketId: 'x', payload: {} }) + '\n\n\n';
    readFile.mockResolvedValueOnce(lines);
    const { readRecentMessages } = await getModule();
    const result = await readRecentMessages();
    expect(result).toHaveLength(1);
  });

  it('skips lines that are not valid JSON', async () => {
    const lines = 'NOT_JSON\n' +
      JSON.stringify({ id: '1', ts: 't', direction: 'in', type: 'buzz', socketId: 'x', payload: {} }) + '\n';
    readFile.mockResolvedValueOnce(lines);
    const { readRecentMessages } = await getModule();
    const result = await readRecentMessages();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('returns only the last `limit` lines', async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ id: String(i), ts: 't', direction: 'in', type: 'buzz', socketId: 'x', payload: {} }),
    ).join('\n') + '\n';
    readFile.mockResolvedValueOnce(lines);
    const { readRecentMessages } = await getModule();
    const result = await readRecentMessages(3);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('7');
    expect(result[2].id).toBe('9');
  });
});
