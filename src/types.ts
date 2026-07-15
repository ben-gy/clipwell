/** Shared type contracts across Clipwell. */

export type OutputFormat = 'mp3' | 'wav';

export interface ExportSettings {
  format: OutputFormat;
  /** MP3 bitrate in kbps; ignored for WAV. */
  bitrate: number;
  fadeIn: boolean;
  fadeOut: boolean;
  normalize: boolean;
}

/** A trimmed selection over the source, in seconds. */
export interface Region {
  start: number;
  end: number;
}

/** Metadata about a decoded source file. */
export interface SourceInfo {
  name: string;
  size: number;
  type: string;
  duration: number;
  sampleRate: number;
  channels: number;
}

/** The finished, encoded clip held in memory. */
export interface Clip {
  blob: Blob;
  url: string;
  filename: string;
  mimeType: string;
  format: OutputFormat;
  durationSec: number;
}

/* ---- Encoder worker message contracts ---- */

export interface EncodeRequest {
  type: 'encode';
  format: OutputFormat;
  bitrate: number;
  sampleRate: number;
  /** One Float32Array of PCM per channel, values in [-1, 1]. */
  channels: Float32Array[];
}

export type EncodeResponse =
  | { type: 'progress'; ratio: number }
  | { type: 'done'; buffer: ArrayBuffer; mimeType: string }
  | { type: 'error'; message: string };
