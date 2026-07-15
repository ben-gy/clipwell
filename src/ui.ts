/**
 * UI chrome — modal management and transient toasts.
 * Modal bodies live here and are shown lazily; the app wires openers by id.
 */

interface ModalDef {
  title: string;
  body: string;
}

/** A glossary-linked term. `label` is shown; `term` keys into GLOSSARY. */
function g(label: string, term = label): string {
  return `<span class="glossary-link" data-term="${term.toLowerCase()}" role="button" tabindex="0">${label}</span>`;
}

const MODALS: Record<string, ModalDef> = {
  how: {
    title: 'How Clipwell works',
    body: `
      <ol class="steps">
        <li><strong>You drop a file.</strong> Any audio (or video) your browser can play — MP3, M4A/AAC, WAV, OGG, FLAC. It is read straight into the tab; there is no upload and no server round-trip.</li>
        <li><strong>${g('Web Audio')} decodes it.</strong> ${g('decodeAudioData', 'decodeaudiodata')} turns the compressed file into raw ${g('PCM')} samples and Clipwell draws them as a ${g('waveform')}.</li>
        <li><strong>You pick the region.</strong> Drag the two handles across the waveform, or type exact times. Toggle a ${g('fade')} in/out and ${g('normalize')} the level, then preview the selection.</li>
        <li><strong>An ${g('OfflineAudioContext', 'offlineaudiocontext')} renders it.</strong> The selected slice is bounced to a fresh buffer with your fades and gain applied — sample-accurate, off any timeline.</li>
        <li><strong>A worker encodes and you save.</strong> A background thread writes an ${g('MP3')} (via ${g('LAME', 'lame')}) or a lossless ${g('WAV')}. Download or share it — the bytes only ever existed here.</li>
      </ol>
      <p class="modal-note">Loaded once, Clipwell keeps working offline as a ${g('PWA')} — the strongest proof there is no server involved.</p>
    `,
  },
  threat: {
    title: 'Privacy & threat model',
    body: `
      <div class="tm">
        <section>
          <h4 class="tm-good">Protected</h4>
          <ul>
            <li>Your source file, its decoded audio, the trimmed region and the exported clip never leave your device. There is no upload endpoint anywhere in the code.</li>
            <li>No account, no cookies for your data, no third-party fonts, no watermark, no tracking beyond an anonymous page-view count.</li>
            <li>Once loaded, the tool runs fully offline.</li>
          </ul>
        </section>
        <section>
          <h4 class="tm-warn">Not protected</h4>
          <ul>
            <li>The exported clip is an ordinary, unencrypted audio file. Store and send it as carefully as any sensitive recording.</li>
            <li>Clipwell can't stop you from sharing the clip yourself after you export it.</li>
            <li>Whether a particular file can be decoded depends on your browser's built-in codecs — an honest error is shown when one can't be read.</li>
          </ul>
        </section>
        <section>
          <h4 class="tm-info">Trust surface</h4>
          <ul>
            <li>The static site bundle (hash-pinned by the GitHub Pages deploy) and the TLS chain between you and GitHub Pages.</li>
            <li>Your browser's native Web Audio decoder and the bundled ${g('LAME', 'lame')} MP3 encoder, which runs locally in a worker.</li>
            <li>A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting, no cross-site tracking; your audio is never sent to it.</li>
          </ul>
        </section>
      </div>
    `,
  },
  about: {
    title: 'About Clipwell',
    body: `
      <p>Clipwell is a free, in-browser audio trimmer and ringtone maker. Cut a clip out of any recording — with fades and a clean, normalised level — and get an MP3 or WAV, without installing anything, creating an account, or uploading a single byte.</p>
      <p>It's part of a small collection of privacy-first browser tools. No file you touch here is ever sent to a server.</p>
      <ul class="about-links">
        <li><a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a> — who made this</li>
        <li><a href="https://sites.benrichardson.dev" target="_blank" rel="noopener">sites.benrichardson.dev</a> — the full directory of tools &amp; sites</li>
        <li><a href="https://github.com/ben-gy/clipwell" target="_blank" rel="noopener">Source on GitHub</a> — read exactly what it does</li>
      </ul>
      <p class="modal-note">No cookies for your data · no fingerprinting · no third-party fonts · anonymous, cookie-less page-view counts via Cloudflare Web Analytics.</p>
    `,
  },
};

let overlay: HTMLElement | null = null;

export function initModals(): void {
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h3 id="modal-title"></h3>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || (e.target as HTMLElement).closest('.modal-close')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) closeModal();
  });
}

export function openModal(id: keyof typeof MODALS | string): void {
  const def = MODALS[id];
  if (!def || !overlay) return;
  (overlay.querySelector('#modal-title') as HTMLElement).textContent = def.title;
  (overlay.querySelector('.modal-body') as HTMLElement).innerHTML = def.body;
  overlay.hidden = false;
  (overlay.querySelector('.modal-close') as HTMLElement)?.focus();
}

export function closeModal(): void {
  if (overlay) overlay.hidden = true;
}

export function isModalOpen(): boolean {
  return !!overlay && !overlay.hidden;
}

let toastTimer: number | null = null;
export function toast(message: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
  let el = document.querySelector('.toast') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), 3200);
}
