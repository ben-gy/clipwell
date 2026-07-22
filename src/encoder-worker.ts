/// <reference lib="webworker" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Encoder worker — turns rendered PCM channels into a WAV or MP3 file, off the
 * main thread, reporting progress. WAV is hand-rolled and instant; MP3 uses the
 * pure-JS LAME encoder (no WASM, no cross-origin-isolation headers needed).
 */

import type { EncodeRequest, EncodeResponse } from './types';
import { encodeWav, floatToInt16 } from './wav';

const post = (msg: EncodeResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const req = e.data;
  if (!req || req.type !== 'encode') return;
  try {
    if (req.format === 'wav') {
      const buffer = encodeWav(req.channels, req.sampleRate);
      post({ type: 'progress', ratio: 1 });
      post({ type: 'done', buffer, mimeType: 'audio/wav' }, [buffer]);
      return;
    }
    const buffer = await encodeMp3(req.channels, req.sampleRate, req.bitrate);
    post({ type: 'done', buffer, mimeType: 'audio/mpeg' }, [buffer]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Encoding failed.';
    post({ type: 'error', message });
  }
};

async function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  bitrate: number,
): Promise<ArrayBuffer> {
  const mod = (await import('@breezystack/lamejs')) as unknown as Record<string, unknown>;
  const lame = ((mod as { default?: unknown }).default ?? mod) as Record<string, unknown>;
  const Mp3Encoder = (lame.Mp3Encoder ?? (mod as Record<string, unknown>).Mp3Encoder) as
    | (new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderLike)
    | undefined;
  if (!Mp3Encoder) throw new Error('MP3 encoder unavailable — try WAV instead.');

  const stereo = channels.length >= 2;
  const numCh = stereo ? 2 : 1;
  const left = toInt16(channels[0]);
  const right = stereo ? toInt16(channels[1]) : left;
  const total = left.length;

  const encoder = new Mp3Encoder(numCh, sampleRate, bitrate);
  const BLOCK = 1152; // one MPEG frame worth of samples
  const parts: Uint8Array[] = [];
  let size = 0;
  let lastPost = 0;

  for (let i = 0; i < total; i += BLOCK) {
    const l = left.subarray(i, i + BLOCK);
    const chunk = stereo
      ? encoder.encodeBuffer(l, right.subarray(i, i + BLOCK))
      : encoder.encodeBuffer(l);
    if (chunk.length > 0) {
      parts.push(new Uint8Array(chunk));
      size += chunk.length;
    }
    const ratio = total > 0 ? i / total : 1;
    if (ratio - lastPost >= 0.05) {
      lastPost = ratio;
      post({ type: 'progress', ratio });
    }
  }
  const tail = encoder.flush();
  if (tail.length > 0) {
    parts.push(new Uint8Array(tail));
    size += tail.length;
  }
  post({ type: 'progress', ratio: 1 });

  const out = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out.buffer;
}

function toInt16(channel: Float32Array): Int16Array {
  const out = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i++) out[i] = floatToInt16(channel[i]);
  return out;
}

interface Mp3EncoderLike {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
}
