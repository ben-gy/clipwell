/**
 * Web Audio integration — decoding source files and rendering the trimmed
 * region (with fades + normalise) to a fresh AudioBuffer via OfflineAudioContext.
 * The heavy encode of that buffer happens in the worker; this stays fast/native.
 */

import type { ExportSettings, Region } from './types';
import { fadeLength, normalizeGain, regionPeak, secondsToSamples } from './dsp';

/** Requested fade length before it's capped to fit the region. */
const FADE_SEC = 0.8;

let ctx: AudioContext | null = null;

function audioContext(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

export function audioSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    (typeof window.AudioContext !== 'undefined' ||
      typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined') &&
    typeof OfflineAudioContext !== 'undefined'
  );
}

/** Decode any browser-supported audio/video file to an AudioBuffer. */
export async function decodeFile(file: File): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  const c = audioContext();
  // Resume in case the context started suspended (autoplay policy).
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      /* non-fatal */
    }
  }
  // decodeAudioData detaches the buffer; slice() keeps callers' data intact.
  return await c.decodeAudioData(bytes.slice(0));
}

/** Copy each channel out of an AudioBuffer as an owned Float32Array. */
export function extractChannels(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.push(new Float32Array(buffer.getChannelData(c)));
  }
  return out;
}

/**
 * Render the selected region of `source` to a new AudioBuffer, applying
 * optional fade in/out and peak normalisation. Returns exactly the region length.
 */
export async function renderRegion(
  source: AudioBuffer,
  region: Region,
  settings: ExportSettings,
): Promise<AudioBuffer> {
  const sampleRate = source.sampleRate;
  const regionSec = Math.max(0, region.end - region.start);
  const frameCount = Math.max(1, Math.round(regionSec * sampleRate));
  const channels = source.numberOfChannels;

  const offline = new OfflineAudioContext(channels, frameCount, sampleRate);
  const node = offline.createBufferSource();
  node.buffer = source;

  const gain = offline.createGain();

  // Base level: normalise lifts the region's peak to ~-1 dBFS.
  let base = 1;
  if (settings.normalize) {
    const startS = secondsToSamples(region.start, sampleRate, source.length);
    const endS = secondsToSamples(region.end, sampleRate, source.length);
    const chans = extractChannels(source);
    base = normalizeGain(regionPeak(chans, startS, endS), -1);
  }

  const fIn = settings.fadeIn ? fadeLength(regionSec, FADE_SEC) : 0;
  const fOut = settings.fadeOut ? fadeLength(regionSec, FADE_SEC) : 0;

  const t0 = 0;
  gain.gain.setValueAtTime(fIn > 0 ? 0.0001 : base, t0);
  if (fIn > 0) gain.gain.linearRampToValueAtTime(base, t0 + fIn);
  if (fOut > 0) {
    const outStart = Math.max(fIn, regionSec - fOut);
    gain.gain.setValueAtTime(base, t0 + outStart);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + regionSec);
  }

  node.connect(gain).connect(offline.destination);
  node.start(0, region.start, regionSec);

  return await offline.startRendering();
}

/** A one-shot preview player for the selection, driven by the shared AudioContext. */
export interface PreviewHandle {
  stop(): void;
  readonly startedAt: number;
  readonly regionStart: number;
}

export function playRegion(
  source: AudioBuffer,
  region: Region,
  onEnded: () => void,
): PreviewHandle {
  const c = audioContext();
  if (c.state === 'suspended') void c.resume();
  const node = c.createBufferSource();
  node.buffer = source;
  node.connect(c.destination);
  const regionSec = Math.max(0.02, region.end - region.start);
  node.onended = onEnded;
  node.start(0, region.start, regionSec);
  return {
    stop() {
      try {
        node.onended = null;
        node.stop();
      } catch {
        /* already stopped */
      }
    },
    startedAt: c.currentTime,
    regionStart: region.start,
  };
}

/** Current playback clock of the shared context (seconds); for playhead math. */
export function contextTime(): number {
  return ctx ? ctx.currentTime : 0;
}
