import { describe, it, expect, vi, beforeEach } from 'vitest';

// play-sound's player object exposes .play(), not .sound()
// The mock must match the real API so production code and test use the same method name.
const mockPlay = vi.fn();

vi.mock('play-sound', () => ({
  default: vi.fn(() => ({ play: mockPlay })),
}));
vi.mock('../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn() },
}));

import { logger } from '../../src/lib/logger.js';

async function getPlayAlert() {
  vi.resetModules();
  const mod = await import('../../src/lib/audioAlert.js');
  return mod.playAlert;
}

describe('playAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls player.play for type "buzz"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('buzz');
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it('plays buzz_chat_1.mp3 for type "buzz"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('buzz');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_1\.mp3$/);
  });

  it('plays buzz_chat_1.mp3 for type "message"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('message');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_1\.mp3$/);
  });

  it('plays buzz_chat_2.mp3 for quick-need "Pickup"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Pickup');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_2\.mp3$/);
  });

  it('plays buzz_chat_2.mp3 for quick-need "Food"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Food');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_2\.mp3$/);
  });

  it('plays buzz_chat_3.mp3 for quick-need "Money"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Money');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_3\.mp3$/);
  });

  it('plays buzz_chat_4.mp3 for quick-need "Call Me"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Call Me');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_4\.mp3$/);
  });

  it('plays buzz_chat_5.mp3 for quick-need "Help"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'Help');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_5\.mp3$/);
  });

  it('plays buzz_chat_6.mp3 for type "status"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('status');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_6\.mp3$/);
  });

  it('plays buzz_chat_3.mp3 for type "location"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('location');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_3\.mp3$/);
  });

  it('plays buzz_chat_5.mp3 for type "battery-low"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('battery-low');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_5\.mp3$/);
  });

  it('plays buzz_chat_6.mp3 for type "countdown"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('countdown');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/buzz_chat_6\.mp3$/);
  });

  it('does NOT call player.sound for type "reply"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('reply');
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('does NOT call player.sound for unknown type', async () => {
    const playAlert = await getPlayAlert();
    playAlert('unknown-event');
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('calls logger.warn when player.play callback receives an error, does not throw', async () => {
    const playAlert = await getPlayAlert();
    // Simulate play-sound calling back with an error
    mockPlay.mockImplementationOnce((_path, cb) => cb(new Error('no player')));
    expect(() => playAlert('buzz')).not.toThrow();
    // Source: logger.warn({ err, type, file }, 'audioAlert: playback failed — ...')
    // BUG-29 fix: logger.warn now uses { errMessage, errCode } instead of raw { err }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errMessage: 'no player',
        type:       'buzz',
        file:       'buzz_chat_1.mp3',
      }),
      'audioAlert: playback failed — install afplay (macOS), aplay/mpg123 (Linux), or mplayer (Windows)',
    );
  });

  // ── Path includes assets/ directory segment ───────────────────────────────

  it('played file path includes the assets/ directory segment for "buzz"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('buzz');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/[/\\]assets[/\\]buzz_chat_1\.mp3$/);
  });

  it('played file path includes the assets/ directory segment for "status"', async () => {
    const playAlert = await getPlayAlert();
    playAlert('status');
    const [path] = mockPlay.mock.calls[0];
    expect(path).toMatch(/[/\\]assets[/\\]buzz_chat_6\.mp3$/);
  });

  // ── Null / undefined / empty type ─────────────────────────────────────────
  // Source: AUDIO_MAP[null/undefined/''] === undefined → !file → return early

  it('does not throw and does not play for type null', async () => {
    const playAlert = await getPlayAlert();
    expect(() => playAlert(null)).not.toThrow();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('does not throw and does not play for type undefined', async () => {
    const playAlert = await getPlayAlert();
    expect(() => playAlert(undefined)).not.toThrow();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('does not throw and does not play for empty string type', async () => {
    const playAlert = await getPlayAlert();
    expect(() => playAlert('')).not.toThrow();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  // ── quick-need with missing/invalid subtype ───────────────────────────────
  // Source: AUDIO_MAP has no top-level 'quick-need' key — only 'quick-need:Pickup' etc.
  // So fallback AUDIO_MAP['quick-need'] is also undefined → silent

  it('does not play for quick-need with unknown subtype (no fallback key in AUDIO_MAP)', async () => {
    const playAlert = await getPlayAlert();
    playAlert('quick-need', 'InvalidSubtype');
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('does not play for quick-need with null subtype (key becomes "quick-need", no map entry)', async () => {
    // null is falsy → key = 'quick-need' → AUDIO_MAP['quick-need'] === undefined → silent
    const playAlert = await getPlayAlert();
    playAlert('quick-need', null);
    expect(mockPlay).not.toHaveBeenCalled();
  });

  // ── Case sensitivity ──────────────────────────────────────────────────────

  it('does not play for wrong-case type "Buzz" (AUDIO_MAP keys are lowercase)', async () => {
    const playAlert = await getPlayAlert();
    playAlert('Buzz');
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
