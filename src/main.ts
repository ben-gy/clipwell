/**
 * Clipwell — in-browser audio trimmer & ringtone maker.
 * Bootstraps the UI, owns the decode → select → render → encode lifecycle,
 * and keeps the heavy work in Web Audio + a dedicated encoder worker.
 */

import './styles/main.css';
import type { Clip, EncodeResponse, ExportSettings, OutputFormat, Region, SourceInfo } from './types';
import {
  audioSupported,
  contextTime,
  decodeFile,
  extractChannels,
  playRegion,
  renderRegion,
  type PreviewHandle,
} from './audio';
import { clampRegion } from './dsp';
import {
  baseName,
  buildFilename,
  formatBytes,
  formatClock,
  formatDuration,
  mimeForFormat,
} from './format';
import { Waveform } from './waveform';
import { categoryLogger, emit, mountEventDrawer } from './eventlog';
import { closeModal, initModals, isModalOpen, openModal, toast } from './ui';
import { initGlossary } from './glossary';

const SETTINGS_KEY = 'clipwell.settings.v1';
const DEFAULT_SETTINGS: ExportSettings = {
  format: 'mp3',
  bitrate: 192,
  fadeIn: false,
  fadeOut: false,
  normalize: false,
};

const log = {
  system: categoryLogger('system'),
  decode: categoryLogger('decode'),
  edit: categoryLogger('edit'),
  render: categoryLogger('render'),
  encode: categoryLogger('encode'),
  output: categoryLogger('output'),
};

let settings: ExportSettings = loadSettings();
let sourceBuffer: AudioBuffer | null = null;
let sourceInfo: SourceInfo | null = null;
let region: Region = { start: 0, end: 0 };
let clip: Clip | null = null;
let wave: Waveform | null = null;
let preview: PreviewHandle | null = null;
let playRaf = 0;
let busy = false;

let worker: Worker | null = null;

/* ------------------------------------------------------------- settings */

function loadSettings(): ExportSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------------- render */

function render(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#12121a"/>
          <g fill="#ffab2e">
            <rect x="5" y="14" width="2.4" height="4" rx="1.2"/>
            <rect x="9" y="10" width="2.4" height="12" rx="1.2"/>
            <rect x="13" y="6" width="2.4" height="20" rx="1.2"/>
            <rect x="17" y="11" width="2.4" height="10" rx="1.2"/>
            <rect x="21" y="8" width="2.4" height="16" rx="1.2"/>
            <rect x="25" y="13" width="2.4" height="6" rx="1.2"/>
          </g>
        </svg>
        <span class="brand-name">clip<span class="accent">well</span></span>
      </a>
      <nav class="topnav">
        <button type="button" data-modal="how">How it works</button>
        <button type="button" data-modal="threat">Privacy</button>
        <button type="button" data-modal="about">About</button>
        <button type="button" id="toggle-drawer" class="drawer-toggle" aria-pressed="false">Event log</button>
      </nav>
    </header>

    <button type="button" class="trust-banner" data-modal="threat" title="What is and isn't protected">
      <span class="lock">&#128274;</span> Runs entirely in your browser. Your audio is never uploaded.
    </button>

    <main class="main-content">
      <div class="workspace">
        <!-- Drop / pick -->
        <section class="dropzone" id="dropzone" tabindex="0" role="button"
          aria-label="Choose an audio or video file to trim">
          <svg viewBox="0 0 64 64" class="dz-icon" aria-hidden="true">
            <g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
              <line x1="10" y1="32" x2="10" y2="32"/>
              <line x1="16" y1="26" x2="16" y2="38"/>
              <line x1="22" y1="18" x2="22" y2="46"/>
              <line x1="28" y1="10" x2="28" y2="54"/>
              <line x1="34" y1="22" x2="34" y2="42"/>
              <line x1="40" y1="14" x2="40" y2="50"/>
              <line x1="46" y1="24" x2="46" y2="40"/>
              <line x1="52" y1="28" x2="52" y2="36"/>
            </g>
          </svg>
          <p class="dz-title">Drop an audio file to trim</p>
          <p class="dz-sub">or <span class="dz-link">choose a file</span> · paste with <kbd>${modKey()}</kbd>+<kbd>V</kbd></p>
          <p class="dz-formats">MP3 · M4A / AAC · WAV · OGG · FLAC · and most video files. Nothing leaves your device.</p>
          <input type="file" id="file-input" accept="audio/*,video/*" hidden />
        </section>

        <!-- Editor -->
        <section class="editor" id="editor" hidden>
          <div class="source-bar">
            <div class="source-meta" id="source-meta"></div>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-change">Change file</button>
          </div>

          <div class="wave-wrap">
            <canvas id="wave" class="wave" aria-label="Audio waveform — drag the handles to select a region"></canvas>
          </div>

          <div class="transport">
            <button type="button" class="btn btn-play" id="btn-play" aria-label="Play selection">
              <span class="play-ico" id="play-ico"></span>
              <span id="play-label">Play</span>
            </button>
            <div class="transport-times">
              <span class="t-now" id="t-now">0:00.0</span>
              <span class="t-sep">/</span>
              <span class="t-len" id="t-len">0:00.0</span>
              <span class="t-tag">selection</span>
            </div>
          </div>

          <div class="panels">
            <section class="panel">
              <h2 class="panel-title">Selection</h2>
              <div class="field-row">
                <label for="in-start">Start</label>
                <input type="number" id="in-start" min="0" step="0.05" inputmode="decimal" />
                <span class="unit">s</span>
              </div>
              <div class="field-row">
                <label for="in-end">End</label>
                <input type="number" id="in-end" min="0" step="0.05" inputmode="decimal" />
                <span class="unit">s</span>
              </div>
              <div class="field-row static">
                <label>Length</label>
                <span class="field-static" id="len-static">0:00.0</span>
              </div>
              <div class="quick-row">
                <button type="button" class="chip" id="chip-all">Whole file</button>
                <button type="button" class="chip" id="chip-30">First 30s</button>
              </div>
            </section>

            <section class="panel">
              <h2 class="panel-title">Shape &amp; output</h2>
              <label class="opt-row"><span><span class="opt-name">Fade in</span><span class="opt-desc">Ease up from silence</span></span>
                <input type="checkbox" id="opt-fadein" /></label>
              <label class="opt-row"><span><span class="opt-name">Fade out</span><span class="opt-desc">Ease down to silence</span></span>
                <input type="checkbox" id="opt-fadeout" /></label>
              <label class="opt-row"><span><span class="opt-name">Normalise</span><span class="opt-desc">Lift to a healthy level</span></span>
                <input type="checkbox" id="opt-normalize" /></label>
              <div class="field-row">
                <label for="sel-format">Format</label>
                <select id="sel-format">
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV (lossless)</option>
                </select>
              </div>
              <div class="field-row" id="bitrate-row">
                <label for="sel-bitrate">Bitrate</label>
                <select id="sel-bitrate">
                  <option value="128">128 kbps</option>
                  <option value="192">192 kbps</option>
                  <option value="256">256 kbps</option>
                  <option value="320">320 kbps</option>
                </select>
              </div>
            </section>
          </div>

          <div class="export-area">
            <button type="button" class="btn btn-primary btn-export" id="btn-export">Export clip</button>
            <div class="progress" id="progress" hidden>
              <div class="progress-bar"><span id="progress-fill"></span></div>
              <span class="progress-pct" id="progress-pct">0%</span>
            </div>
            <div class="result" id="result" hidden>
              <div class="result-meta" id="result-meta"></div>
              <div class="result-actions">
                <button type="button" class="btn btn-primary btn-sm" id="btn-download">Download</button>
                <button type="button" class="btn btn-ghost btn-sm" id="btn-share" hidden>Share</button>
              </div>
            </div>
            <div class="error-box" id="error-box" hidden>
              <p id="error-msg"></p>
              <button type="button" class="btn btn-ghost btn-sm" id="btn-retry">Try again</button>
            </div>
          </div>
          <p class="kbd-hint">Shortcuts: <kbd>Space</kbd> play/pause · <kbd>Enter</kbd> export · <kbd>Esc</kbd> close</p>
        </section>
      </div>
    </main>

    <aside class="drawer" id="drawer" hidden><div id="drawer-mount"></div></aside>

    <footer class="site-footer">
      Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
      · <a href="https://sites.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a>
    </footer>
  `;

  app.querySelectorAll('[data-modal]').forEach((el) =>
    el.addEventListener('click', () => openModal((el as HTMLElement).dataset.modal!)),
  );

  wireDropzone();
  wireEditor();
  document.getElementById('toggle-drawer')!.addEventListener('click', toggleDrawer);
}

function modKey(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
}

/* ------------------------------------------------------------- dropzone */

function wireDropzone(): void {
  const dz = document.getElementById('dropzone')!;
  const input = document.getElementById('file-input') as HTMLInputElement;

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void ingest(f);
    input.value = '';
  });

  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      stop(e);
      dz.classList.add('drag');
    }),
  );
  ['dragleave', 'dragend'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      stop(e);
      dz.classList.remove('drag');
    }),
  );
  dz.addEventListener('drop', (e) => {
    stop(e);
    dz.classList.remove('drag');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void ingest(f);
  });

  document.getElementById('btn-change')!.addEventListener('click', () => input.click());
}

/* --------------------------------------------------------------- ingest */

async function ingest(file: File): Promise<void> {
  if (busy) return;
  if (!audioSupported()) {
    showError('This browser does not support the Web Audio API needed to decode audio.');
    return;
  }
  stopPreview();
  clearResult();
  busy = true;
  setStatus('Decoding…');
  log.decode(`Reading “${file.name}” (${formatBytes(file.size)})`, 'info');
  try {
    const buffer = await decodeFile(file);
    sourceBuffer = buffer;
    sourceInfo = {
      name: file.name,
      size: file.size,
      type: file.type || 'audio',
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    };
    region = clampRegion(0, buffer.duration, buffer.duration);
    log.decode(
      `Decoded ${formatDuration(buffer.duration)} · ${buffer.sampleRate.toLocaleString()} Hz · ${buffer.numberOfChannels === 1 ? 'mono' : buffer.numberOfChannels + ' ch'}`,
      'ok',
    );
    showEditor();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.decode(`Could not decode: ${msg}`, 'err');
    showError(
      `Couldn't decode “${file.name}”. Your browser may not support this file's audio codec — try MP3, M4A, WAV or OGG.`,
    );
  } finally {
    busy = false;
    setStatus('');
  }
}

/* --------------------------------------------------------------- editor */

function showEditor(): void {
  if (!sourceBuffer || !sourceInfo) return;
  document.getElementById('dropzone')!.hidden = true;
  document.getElementById('editor')!.hidden = false;
  hide('error-box');

  document.getElementById('source-meta')!.innerHTML =
    `<span class="sm-name" title="${escapeAttr(sourceInfo.name)}">${escapeHtml(sourceInfo.name)}</span>` +
    `<span class="sm-detail">${formatDuration(sourceInfo.duration)} · ${sourceInfo.sampleRate.toLocaleString()} Hz · ${sourceInfo.channels === 1 ? 'mono' : sourceInfo.channels + ' ch'} · ${formatBytes(sourceInfo.size)}</span>`;

  const canvas = document.getElementById('wave') as HTMLCanvasElement;
  wave?.destroy();
  wave = new Waveform(canvas, {
    onRegionChange: (r, committed) => {
      region = r;
      syncRegionInputs();
      if (committed) {
        clearResult();
        log.edit(`Selection ${formatClock(r.start)} → ${formatClock(r.end)} (${formatDuration(r.end - r.start)})`, 'info');
      }
    },
  });
  wave.setBuffer(extractChannels(sourceBuffer), sourceInfo.duration, region);

  applySettingsToControls();
  syncRegionInputs();
  updateFormatUi();
}

function syncRegionInputs(): void {
  const start = document.getElementById('in-start') as HTMLInputElement;
  const end = document.getElementById('in-end') as HTMLInputElement;
  if (document.activeElement !== start) start.value = region.start.toFixed(2);
  if (document.activeElement !== end) end.value = region.end.toFixed(2);
  const len = region.end - region.start;
  setText('len-static', formatClock(len));
  setText('t-len', formatClock(len));
  if (sourceInfo) {
    start.max = sourceInfo.duration.toFixed(2);
    end.max = sourceInfo.duration.toFixed(2);
  }
}

function commitRegionFromInputs(): void {
  if (!sourceInfo) return;
  const start = parseFloat((document.getElementById('in-start') as HTMLInputElement).value);
  const end = parseFloat((document.getElementById('in-end') as HTMLInputElement).value);
  region = clampRegion(
    isFinite(start) ? start : region.start,
    isFinite(end) ? end : region.end,
    sourceInfo.duration,
  );
  wave?.setRegion(region);
  syncRegionInputs();
  clearResult();
}

function wireEditor(): void {
  (document.getElementById('in-start') as HTMLInputElement).addEventListener('change', commitRegionFromInputs);
  (document.getElementById('in-end') as HTMLInputElement).addEventListener('change', commitRegionFromInputs);

  document.getElementById('chip-all')!.addEventListener('click', () => {
    if (!sourceInfo) return;
    region = clampRegion(0, sourceInfo.duration, sourceInfo.duration);
    wave?.setRegion(region);
    syncRegionInputs();
    clearResult();
  });
  document.getElementById('chip-30')!.addEventListener('click', () => {
    if (!sourceInfo) return;
    region = clampRegion(0, Math.min(30, sourceInfo.duration), sourceInfo.duration);
    wave?.setRegion(region);
    syncRegionInputs();
    clearResult();
  });

  bindCheck('opt-fadein', (v) => (settings.fadeIn = v));
  bindCheck('opt-fadeout', (v) => (settings.fadeOut = v));
  bindCheck('opt-normalize', (v) => (settings.normalize = v));

  (document.getElementById('sel-format') as HTMLSelectElement).addEventListener('change', (e) => {
    settings.format = (e.target as HTMLSelectElement).value as OutputFormat;
    saveSettings();
    updateFormatUi();
    clearResult();
  });
  (document.getElementById('sel-bitrate') as HTMLSelectElement).addEventListener('change', (e) => {
    settings.bitrate = Number((e.target as HTMLSelectElement).value);
    saveSettings();
    clearResult();
  });

  document.getElementById('btn-play')!.addEventListener('click', togglePreview);
  document.getElementById('btn-export')!.addEventListener('click', () => void doExport());
  document.getElementById('btn-download')!.addEventListener('click', downloadClip);
  document.getElementById('btn-share')!.addEventListener('click', () => void shareClip());
  document.getElementById('btn-retry')!.addEventListener('click', () => {
    hide('error-box');
    void doExport();
  });
}

function bindCheck(id: string, set: (v: boolean) => void): void {
  document.getElementById(id)!.addEventListener('change', (e) => {
    set((e.target as HTMLInputElement).checked);
    saveSettings();
    clearResult();
  });
}

function applySettingsToControls(): void {
  (document.getElementById('opt-fadein') as HTMLInputElement).checked = settings.fadeIn;
  (document.getElementById('opt-fadeout') as HTMLInputElement).checked = settings.fadeOut;
  (document.getElementById('opt-normalize') as HTMLInputElement).checked = settings.normalize;
  (document.getElementById('sel-format') as HTMLSelectElement).value = settings.format;
  (document.getElementById('sel-bitrate') as HTMLSelectElement).value = String(settings.bitrate);
}

function updateFormatUi(): void {
  document.getElementById('bitrate-row')!.hidden = settings.format !== 'mp3';
}

/* -------------------------------------------------------------- preview */

function togglePreview(): void {
  if (preview) stopPreview();
  else startPreview();
}

function startPreview(): void {
  if (!sourceBuffer) return;
  const len = region.end - region.start;
  if (len <= 0.02) return;
  preview = playRegion(sourceBuffer, region, () => stopPreview());
  setPlaying(true);
  const started = preview.startedAt;
  const tick = () => {
    if (!preview) return;
    const elapsed = contextTime() - started;
    const t = region.start + elapsed;
    if (t >= region.end) {
      stopPreview();
      return;
    }
    wave?.setPlayhead(t);
    setText('t-now', formatClock(elapsed));
    playRaf = requestAnimationFrame(tick);
  };
  playRaf = requestAnimationFrame(tick);
  log.edit('Previewing selection', 'info');
}

function stopPreview(): void {
  if (preview) {
    preview.stop();
    preview = null;
  }
  if (playRaf) cancelAnimationFrame(playRaf);
  playRaf = 0;
  wave?.setPlayhead(null);
  setText('t-now', '0:00.0');
  setPlaying(false);
}

function setPlaying(on: boolean): void {
  const ico = document.getElementById('play-ico');
  const label = document.getElementById('play-label');
  const btn = document.getElementById('btn-play');
  if (ico) ico.classList.toggle('is-playing', on);
  if (label) label.textContent = on ? 'Stop' : 'Play';
  if (btn) btn.setAttribute('aria-label', on ? 'Stop preview' : 'Play selection');
}

/* --------------------------------------------------------------- export */

async function doExport(): Promise<void> {
  if (!sourceBuffer || !sourceInfo || busy) return;
  const len = region.end - region.start;
  if (len <= 0.02) {
    showError('The selection is too short to export. Drag the handles to make it longer.');
    return;
  }
  stopPreview();
  clearResult();
  busy = true;
  hide('error-box');
  setExportBusy(true);
  showProgress(0);

  try {
    log.render(`Rendering ${formatDuration(len)} region…`, 'info');
    const rendered = await renderRegion(sourceBuffer, region, settings);
    const channels = extractChannels(rendered);
    log.encode(
      `Encoding ${settings.format.toUpperCase()}${settings.format === 'mp3' ? ' @ ' + settings.bitrate + ' kbps' : ''}…`,
      'info',
    );
    const { buffer, mimeType } = await encode(settings, rendered.sampleRate, channels);
    const blob = new Blob([buffer], { type: mimeType || mimeForFormat(settings.format) });
    const url = URL.createObjectURL(blob);
    clip = {
      blob,
      url,
      filename: buildFilename(sourceInfo.name, settings.format),
      mimeType: blob.type,
      format: settings.format,
      durationSec: len,
    };
    log.output(`Clip ready — ${clip.filename} (${formatBytes(blob.size)})`, 'ok');
    showResult(clip);
    toast('Clip ready — nothing was uploaded.', 'ok');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.encode(`Export failed: ${msg}`, 'err');
    if (settings.format === 'mp3') {
      showError(`MP3 export failed (${msg}). Try WAV — it's lossless and always available.`);
    } else {
      showError(`Export failed: ${msg}`);
    }
  } finally {
    busy = false;
    setExportBusy(false);
    hide('progress');
  }
}

function encode(
  s: ExportSettings,
  sampleRate: number,
  channels: Float32Array[],
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const w = ensureWorker();
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<EncodeResponse>) => {
      const m = e.data;
      if (m.type === 'progress') showProgress(m.ratio);
      else if (m.type === 'done') {
        w.removeEventListener('message', onMsg);
        resolve({ buffer: m.buffer, mimeType: m.mimeType });
      } else if (m.type === 'error') {
        w.removeEventListener('message', onMsg);
        reject(new Error(m.message));
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage(
      { type: 'encode', format: s.format, bitrate: s.bitrate, sampleRate, channels },
      channels.map((c) => c.buffer),
    );
  });
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./encoder-worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

function setExportBusy(on: boolean): void {
  const btn = document.getElementById('btn-export') as HTMLButtonElement;
  btn.disabled = on;
  btn.textContent = on ? 'Exporting…' : 'Export clip';
}

function showProgress(ratio: number): void {
  const box = document.getElementById('progress')!;
  box.hidden = false;
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  (document.getElementById('progress-fill') as HTMLElement).style.width = `${pct}%`;
  setText('progress-pct', `${pct}%`);
}

function showResult(c: Clip): void {
  const box = document.getElementById('result')!;
  box.hidden = false;
  setText(
    'result-meta',
    `${c.format.toUpperCase()} · ${formatDuration(c.durationSec)} · ${formatBytes(c.blob.size)}`,
  );
  const shareBtn = document.getElementById('btn-share') as HTMLButtonElement;
  shareBtn.hidden = !canShare(c);
}

function clearResult(): void {
  if (clip) {
    URL.revokeObjectURL(clip.url);
    clip = null;
  }
  hide('result');
}

/* --------------------------------------------------------------- output */

function downloadClip(): void {
  if (!clip) return;
  const a = document.createElement('a');
  a.href = clip.url;
  a.download = clip.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  log.output(`Downloaded ${clip.filename}`, 'ok');
}

function canShare(c: Clip): boolean {
  try {
    const file = new File([c.blob], c.filename, { type: c.mimeType });
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

async function shareClip(): Promise<void> {
  if (!clip) return;
  try {
    const file = new File([clip.blob], clip.filename, { type: clip.mimeType });
    await navigator.share({ files: [file], title: baseName(clip.filename) });
    log.output('Shared via the system share sheet', 'ok');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    toast('Sharing was not completed.', 'err');
  }
}

/* ------------------------------------------------------------- feedback */

function showError(message: string): void {
  // Show inline if the editor is up; otherwise fall back to a toast on the dropzone.
  const editorVisible = !document.getElementById('editor')?.hidden;
  if (editorVisible) {
    const box = document.getElementById('error-box');
    if (box) {
      box.hidden = false;
      setText('error-msg', message);
    }
  }
  toast(message, 'err');
}

function setStatus(_msg: string): void {
  /* reserved for future status surface; events carry the detail */
}

/* --------------------------------------------------------------- drawer */

let drawerMounted = false;
function toggleDrawer(): void {
  const drawer = document.getElementById('drawer')!;
  if (drawer.hidden) openDrawer();
  else closeDrawer();
}
function openDrawer(): void {
  const drawer = document.getElementById('drawer')!;
  const btn = document.getElementById('toggle-drawer')!;
  drawer.hidden = false;
  btn.setAttribute('aria-pressed', 'true');
  btn.classList.add('on');
  if (!drawerMounted) {
    mountEventDrawer(document.getElementById('drawer-mount')!, closeDrawer);
    drawerMounted = true;
  }
}
function closeDrawer(): void {
  const drawer = document.getElementById('drawer')!;
  const btn = document.getElementById('toggle-drawer')!;
  drawer.hidden = true;
  btn.setAttribute('aria-pressed', 'false');
  btn.classList.remove('on');
}
function isDrawerOpen(): boolean {
  return !document.getElementById('drawer')!.hidden;
}

/* ------------------------------------------------------------ shortcuts */

function initShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isModalOpen()) closeModal();
      else if (isDrawerOpen()) closeDrawer();
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (typing || isModalOpen()) return;
    if (document.getElementById('editor')?.hidden) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePreview();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void doExport();
    }
  });

  // Paste a file to ingest.
  document.addEventListener('paste', (e) => {
    const f = e.clipboardData?.files?.[0];
    if (f && (f.type.startsWith('audio/') || f.type.startsWith('video/'))) {
      e.preventDefault();
      void ingest(f);
    }
  });
}

/* --------------------------------------------------------------- helpers */

function hide(id: string): void {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}
function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/* ------------------------------------------------------------ bootstrap */

function registerServiceWorker(): void {
  if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline support is best-effort */
      });
    });
  }
}

function main(): void {
  render();
  initModals();
  initGlossary();
  initShortcuts();
  if (!audioSupported()) {
    log.system('Web Audio API unavailable — this browser can’t decode audio.', 'err');
    toast('This browser lacks the Web Audio API needed to trim audio.', 'err');
  }
  emit('system', 'ok', 'Clipwell ready — no server, nothing uploaded');
  registerServiceWorker();
}

main();
