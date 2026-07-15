/**
 * Pure DSP helpers — no DOM, no Web Audio. Everything here is unit-tested.
 * PCM samples are Float32 in the range [-1, 1].
 */

import type { Region } from './types';

/** One min/max pair per horizontal pixel bucket of a waveform. */
export interface Peak {
  min: number;
  max: number;
}

/**
 * Reduce a channel to `buckets` min/max pairs for drawing.
 * A bucket with no samples (buckets > length) collapses to {0,0}.
 */
export function computePeaks(channel: Float32Array, buckets: number): Peak[] {
  const out: Peak[] = new Array(buckets);
  if (buckets <= 0) return [];
  const n = channel.length;
  if (n === 0) {
    for (let i = 0; i < buckets; i++) out[i] = { min: 0, max: 0 };
    return out;
  }
  const step = n / buckets;
  for (let i = 0; i < buckets; i++) {
    const startIdx = Math.floor(i * step);
    const endIdx = Math.min(n, Math.floor((i + 1) * step));
    let min = Infinity;
    let max = -Infinity;
    for (let j = startIdx; j < endIdx; j++) {
      const v = channel[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity) {
      // Empty bucket (fewer samples than buckets): reuse the nearest sample.
      const v = channel[Math.min(n - 1, startIdx)];
      min = Math.min(0, v);
      max = Math.max(0, v);
    }
    out[i] = { min, max };
  }
  return out;
}

/** Merge the per-channel peaks into a single mono-visual envelope (max abs). */
export function mergePeaks(perChannel: Peak[][]): Peak[] {
  if (perChannel.length === 0) return [];
  if (perChannel.length === 1) return perChannel[0];
  const buckets = perChannel[0].length;
  const out: Peak[] = new Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let min = 0;
    let max = 0;
    for (const ch of perChannel) {
      const p = ch[i];
      if (!p) continue;
      if (p.min < min) min = p.min;
      if (p.max > max) max = p.max;
    }
    out[i] = { min, max };
  }
  return out;
}

/** Peak absolute amplitude across all channels within a sample range [start, end). */
export function regionPeak(channels: Float32Array[], startSample: number, endSample: number): number {
  let peak = 0;
  const s = Math.max(0, startSample);
  for (const ch of channels) {
    const e = Math.min(ch.length, endSample);
    for (let i = s; i < e; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/**
 * Linear gain that lifts a signal whose loudest sample is `peak` up to `targetDb`
 * (dBFS, negative). Returns 1 for silence or non-positive peak (nothing to scale),
 * and never attenuates below 1 unless the peak already exceeds the target.
 */
export function normalizeGain(peak: number, targetDb = -1): number {
  if (!(peak > 0) || !isFinite(peak)) return 1;
  const target = Math.pow(10, targetDb / 20);
  const gain = target / peak;
  return isFinite(gain) && gain > 0 ? gain : 1;
}

/** Convert a linear gain to dBFS. */
export function gainToDb(gain: number): number {
  if (!(gain > 0)) return -Infinity;
  return 20 * Math.log10(gain);
}

/** Clamp a region to [0, duration] and guarantee start < end by at least `minLen`. */
export function clampRegion(start: number, end: number, duration: number, minLen = 0.05): Region {
  const dur = Math.max(0, duration);
  let s = Math.min(Math.max(0, start), dur);
  let e = Math.min(Math.max(0, end), dur);
  if (e < s) [s, e] = [e, s];
  if (e - s < minLen) {
    // Grow the region to minLen, preferring to push the end, then the start.
    e = Math.min(dur, s + minLen);
    if (e - s < minLen) s = Math.max(0, e - minLen);
  }
  return { start: s, end: e };
}

/** Seconds → integer sample index at a given rate, clamped to [0, maxSamples]. */
export function secondsToSamples(seconds: number, sampleRate: number, maxSamples = Infinity): number {
  const idx = Math.round(Math.max(0, seconds) * sampleRate);
  return Math.min(idx, maxSamples);
}

/** Effective fade length in seconds: capped so fade-in + fade-out never exceed the region. */
export function fadeLength(regionSec: number, requested: number): number {
  if (regionSec <= 0) return 0;
  return Math.max(0, Math.min(requested, regionSec / 2));
}
