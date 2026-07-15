import { describe, expect, it } from 'vitest';
import { encodeWav, floatToInt16 } from '../src/wav';

function ascii(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('floatToInt16', () => {
  it('maps 0 to 0', () => {
    expect(floatToInt16(0)).toBe(0);
  });
  it('maps full scale to the int16 extremes', () => {
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
  });
  it('clamps values beyond [-1, 1]', () => {
    expect(floatToInt16(2)).toBe(32767);
    expect(floatToInt16(-9)).toBe(-32768);
  });
  it('quantises a mid value', () => {
    expect(floatToInt16(0.5)).toBe(Math.round(0.5 * 0x7fff));
  });
});

describe('encodeWav', () => {
  it('writes a canonical 44-byte header for mono', () => {
    const buf = encodeWav([new Float32Array([0, 0.5, -0.5])], 44100);
    const view = new DataView(buf);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it('reports the correct data + RIFF sizes', () => {
    const frames = 10;
    const buf = encodeWav([new Float32Array(frames)], 8000);
    const view = new DataView(buf);
    const dataSize = frames * 1 * 2;
    expect(view.getUint32(40, true)).toBe(dataSize);
    expect(view.getUint32(4, true)).toBe(36 + dataSize);
    expect(buf.byteLength).toBe(44 + dataSize);
  });

  it('interleaves stereo channels frame by frame', () => {
    const left = new Float32Array([1, 0]);
    const right = new Float32Array([-1, 0]);
    const buf = encodeWav([left, right], 44100);
    const view = new DataView(buf);
    expect(view.getUint16(22, true)).toBe(2); // stereo
    expect(view.getUint16(32, true)).toBe(4); // block align = 2ch * 2 bytes
    // First frame: L then R.
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it('round-trips sample values through the data chunk', () => {
    const samples = new Float32Array([0, 0.25, -0.75, 1]);
    const buf = encodeWav([samples], 22050);
    const view = new DataView(buf);
    for (let i = 0; i < samples.length; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(floatToInt16(samples[i]));
    }
  });

  it('produces just a header for empty input', () => {
    const buf = encodeWav([new Float32Array(0)], 44100);
    expect(buf.byteLength).toBe(44);
    expect(new DataView(buf).getUint32(40, true)).toBe(0);
  });

  it('computes byte rate from sample rate and block align', () => {
    const buf = encodeWav([new Float32Array(4), new Float32Array(4)], 48000);
    const view = new DataView(buf);
    // byteRate = sampleRate * numChannels * bytesPerSample
    expect(view.getUint32(28, true)).toBe(48000 * 2 * 2);
  });
});
