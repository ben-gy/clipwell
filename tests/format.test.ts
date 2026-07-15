import { describe, expect, it } from 'vitest';
import {
  baseName,
  buildFilename,
  extForFormat,
  formatBytes,
  formatClock,
  formatDuration,
  mimeForFormat,
  sanitizeStem,
} from '../src/format';

describe('formatBytes', () => {
  it('handles bytes, KB, MB, GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
  it('drops decimals at or above 100 of a unit', () => {
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
  });
  it('guards against negatives and NaN', () => {
    expect(formatBytes(-10)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

describe('formatClock', () => {
  it('formats with a tenths place', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(65.3)).toBe('1:05.3');
  });
  it('adds hours when needed', () => {
    expect(formatClock(3723.4)).toBe('1:02:03.4');
  });
  it('clamps negatives to zero', () => {
    expect(formatClock(-5)).toBe('0:00.0');
  });
});

describe('formatDuration', () => {
  it('formats under an hour as M:SS', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(75)).toBe('1:15');
  });
  it('formats over an hour as H:MM:SS', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('extForFormat / mimeForFormat', () => {
  it('maps mp3', () => {
    expect(extForFormat('mp3')).toBe('mp3');
    expect(mimeForFormat('mp3')).toBe('audio/mpeg');
  });
  it('maps wav', () => {
    expect(extForFormat('wav')).toBe('wav');
    expect(mimeForFormat('wav')).toBe('audio/wav');
  });
});

describe('baseName', () => {
  it('strips path and extension', () => {
    expect(baseName('/music/song.final.mp3')).toBe('song.final');
    expect(baseName('clip.wav')).toBe('clip');
  });
  it('keeps dotfiles / extensionless names', () => {
    expect(baseName('memo')).toBe('memo');
  });
});

describe('sanitizeStem', () => {
  it('slugs spaces and strips unsafe characters', () => {
    expect(sanitizeStem('My Song (live)!')).toBe('My-Song-live');
  });
  it('falls back to "clip" when empty', () => {
    expect(sanitizeStem('***')).toBe('clip');
    expect(sanitizeStem('   ')).toBe('clip');
  });
  it('collapses repeated separators', () => {
    expect(sanitizeStem('a   b---c')).toBe('a-b-c');
  });
});

describe('buildFilename', () => {
  it('appends -clip and the format extension', () => {
    expect(buildFilename('Interview 01.m4a', 'mp3')).toBe('Interview-01-clip.mp3');
    expect(buildFilename('/tmp/song.wav', 'wav')).toBe('song-clip.wav');
  });
});
