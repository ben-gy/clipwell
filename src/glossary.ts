/** Jargon → plain-English definitions for click-to-define tooltips. */
export const GLOSSARY: Record<string, string> = {
  'web audio':
    'A browser API for decoding and processing sound. Clipwell uses it to turn your file into raw audio, apply fades, and render the trimmed clip — all locally, nothing uploaded.',
  decodeaudiodata:
    'The Web Audio call that turns a compressed file (MP3, M4A, WAV…) into raw PCM samples your browser can work with. It runs natively, inside this tab.',
  offlineaudiocontext:
    'A Web Audio engine that renders audio as fast as your CPU allows instead of in real time. Clipwell uses it to bounce the selected region — with fades and gain baked in — to a fresh buffer.',
  pcm:
    'Pulse-code modulation: raw, uncompressed audio as a stream of amplitude numbers. It is what a WAV file stores and what the encoder turns into MP3.',
  waveform:
    'The picture of the sound: height shows how loud each moment is. Drag the two handles across it to choose the part you want to keep.',
  normalize:
    'Raises the whole clip so its loudest moment sits just below the maximum (about -1 dBFS) — a quiet recording becomes a healthy, even level without clipping.',
  fade:
    'A smooth ramp in volume. A fade-in lifts the start from silence; a fade-out lowers the end to silence, so the clip does not begin or end with a click.',
  'sample rate':
    'How many audio samples are stored per second (e.g. 44,100 Hz for CD quality). Clipwell keeps the source rate so the clip sounds identical to the original.',
  bitrate:
    'How many kilobits per second an MP3 spends on the audio. Higher (320 kbps) is closer to the original; lower (128 kbps) makes a smaller file. WAV is uncompressed, so it has no bitrate.',
  mp3:
    'A compact, near-universal compressed audio format. Clipwell encodes it locally with a pure-JavaScript LAME encoder — the audio never leaves your device.',
  wav:
    'An uncompressed audio file that stores raw PCM exactly. Bigger than MP3 but lossless — good when you want the cleanest possible clip.',
  lame:
    'The long-standing open-source MP3 encoder. Clipwell runs a JavaScript port of it in a background thread, so encoding happens on your machine with no server.',
  pwa: 'Progressive Web App — once loaded, Clipwell is cached by a service worker and keeps working with the network off. Offline is proof nothing is uploaded.',
};

let tooltipEl: HTMLElement | null = null;

/** Wire up click-to-define behaviour for any `.glossary-link[data-term]`. */
export function initGlossary(): void {
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement)?.closest('.glossary-link') as HTMLElement | null;
    if (target) {
      e.preventDefault();
      const term = (target.dataset.term || target.textContent || '').toLowerCase().trim();
      const def = GLOSSARY[term];
      if (def) showTooltip(target, def);
      return;
    }
    if (tooltipEl && !(e.target as HTMLElement)?.closest('.glossary-tip')) hideTooltip();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTooltip();
  });
  window.addEventListener('scroll', hideTooltip, true);
}

function showTooltip(anchor: HTMLElement, text: string): void {
  hideTooltip();
  const tip = document.createElement('div');
  tip.className = 'glossary-tip';
  tip.textContent = text;
  document.body.appendChild(tip);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + 8;
  let left = r.left;
  const maxLeft = window.innerWidth - tip.offsetWidth - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
  tooltipEl = tip;
}

function hideTooltip(): void {
  tooltipEl?.remove();
  tooltipEl = null;
}
