/**
 * Minimal 16-bit PCM WAV encoder. Pure and fully unit-tested.
 * Interleaves the given channels and writes a canonical RIFF/WAVE header.
 */

const BYTES_PER_SAMPLE = 2; // 16-bit

/** Clamp a float sample to [-1, 1] then quantise to a signed 16-bit int. */
export function floatToInt16(sample: number): number {
  let s = sample;
  if (s > 1) s = 1;
  else if (s < -1) s = -1;
  // Asymmetric range of int16: negative side reaches -32768, positive +32767.
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

/**
 * Encode Float32 channel data to a WAV ArrayBuffer.
 * @param channels one Float32Array per channel (all the same length)
 * @param sampleRate samples per second
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const numFrames = channels.length ? channels[0].length : 0;
  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // file size minus first 8 bytes
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true); // bits per sample

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, floatToInt16(channels[c][i]), true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
