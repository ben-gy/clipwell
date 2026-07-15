import { describe, expect, it } from 'vitest';
import {
  clampRegion,
  computePeaks,
  fadeLength,
  gainToDb,
  mergePeaks,
  normalizeGain,
  regionPeak,
  secondsToSamples,
} from '../src/dsp';

describe('computePeaks', () => {
  it('produces the requested number of buckets', () => {
    const ch = new Float32Array([0, 0.5, -0.5, 1, -1, 0.2, -0.2, 0.9]);
    const peaks = computePeaks(ch, 4);
    expect(peaks).toHaveLength(4);
  });

  it('captures min and max within each bucket', () => {
    const ch = new Float32Array([0.2, -0.8, 0.9, -0.1]);
    const peaks = computePeaks(ch, 2);
    expect(peaks[0].max).toBeCloseTo(0.2);
    expect(peaks[0].min).toBeCloseTo(-0.8);
    expect(peaks[1].max).toBeCloseTo(0.9);
    expect(peaks[1].min).toBeCloseTo(-0.1);
  });

  it('returns flat peaks for an empty channel', () => {
    const peaks = computePeaks(new Float32Array(0), 3);
    expect(peaks).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 },
      { min: 0, max: 0 },
    ]);
  });

  it('handles more buckets than samples without gaps', () => {
    const ch = new Float32Array([0.5, -0.5]);
    const peaks = computePeaks(ch, 6);
    expect(peaks).toHaveLength(6);
    for (const p of peaks) {
      expect(Number.isFinite(p.min)).toBe(true);
      expect(Number.isFinite(p.max)).toBe(true);
    }
  });

  it('returns [] for non-positive bucket counts', () => {
    expect(computePeaks(new Float32Array([1]), 0)).toEqual([]);
  });
});

describe('mergePeaks', () => {
  it('returns the single channel unchanged', () => {
    const a = [{ min: -0.3, max: 0.4 }];
    expect(mergePeaks([a])).toBe(a);
  });

  it('takes the widest envelope across channels', () => {
    const l = [{ min: -0.2, max: 0.9 }];
    const r = [{ min: -0.7, max: 0.3 }];
    expect(mergePeaks([l, r])).toEqual([{ min: -0.7, max: 0.9 }]);
  });

  it('returns [] for no channels', () => {
    expect(mergePeaks([])).toEqual([]);
  });
});

describe('regionPeak', () => {
  it('finds the loudest absolute sample in range across channels', () => {
    const l = new Float32Array([0.1, -0.9, 0.3]);
    const r = new Float32Array([0.5, 0.2, -0.4]);
    expect(regionPeak([l, r], 0, 3)).toBeCloseTo(0.9);
  });

  it('respects the sample window', () => {
    const ch = new Float32Array([1, 0.1, 0.1, 1]);
    expect(regionPeak([ch], 1, 3)).toBeCloseTo(0.1);
  });

  it('returns 0 for an empty window', () => {
    expect(regionPeak([new Float32Array([1, 1])], 2, 2)).toBe(0);
  });
});

describe('normalizeGain', () => {
  it('lifts a quiet peak toward the target', () => {
    // peak 0.5 to -1 dBFS (~0.891) → gain ~1.782
    expect(normalizeGain(0.5, -1)).toBeCloseTo(0.8912509 / 0.5, 4);
  });

  it('attenuates when the peak already exceeds the target', () => {
    expect(normalizeGain(1, -6)).toBeLessThan(1);
  });

  it('returns 1 for silence or invalid peaks', () => {
    expect(normalizeGain(0)).toBe(1);
    expect(normalizeGain(-0.2)).toBe(1);
    expect(normalizeGain(NaN)).toBe(1);
    expect(normalizeGain(Infinity)).toBe(1);
  });
});

describe('gainToDb', () => {
  it('maps unity gain to 0 dB', () => {
    expect(gainToDb(1)).toBeCloseTo(0);
  });
  it('maps half gain to about -6 dB', () => {
    expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 3);
  });
  it('maps zero gain to -Infinity', () => {
    expect(gainToDb(0)).toBe(-Infinity);
  });
});

describe('clampRegion', () => {
  it('keeps a valid region intact', () => {
    expect(clampRegion(1, 3, 10)).toEqual({ start: 1, end: 3 });
  });
  it('swaps a reversed region', () => {
    expect(clampRegion(5, 2, 10)).toEqual({ start: 2, end: 5 });
  });
  it('clamps to the duration', () => {
    expect(clampRegion(-2, 99, 8)).toEqual({ start: 0, end: 8 });
  });
  it('enforces a minimum length', () => {
    const r = clampRegion(4, 4, 10, 0.05);
    expect(r.end - r.start).toBeCloseTo(0.05, 5);
  });
  it('grows backwards when at the far edge', () => {
    const r = clampRegion(10, 10, 10, 0.05);
    expect(r.end).toBeCloseTo(10);
    expect(r.start).toBeCloseTo(9.95, 5);
  });
});

describe('secondsToSamples', () => {
  it('rounds seconds to a sample index', () => {
    expect(secondsToSamples(1, 44100)).toBe(44100);
    expect(secondsToSamples(0.5, 48000)).toBe(24000);
  });
  it('clamps negatives to 0 and respects the max', () => {
    expect(secondsToSamples(-1, 44100)).toBe(0);
    expect(secondsToSamples(10, 44100, 100)).toBe(100);
  });
});

describe('fadeLength', () => {
  it('passes short fades through', () => {
    expect(fadeLength(10, 0.8)).toBeCloseTo(0.8);
  });
  it('caps a fade to half the region', () => {
    expect(fadeLength(1, 0.8)).toBeCloseTo(0.5);
  });
  it('is zero for an empty region', () => {
    expect(fadeLength(0, 0.8)).toBe(0);
  });
});
