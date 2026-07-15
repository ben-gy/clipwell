# Tool Plan: Clipwell

## Overview
- **Name:** Clipwell
- **Repo name:** clipwell
- **Tagline:** Trim audio into clips and ringtones in your browser — fade, normalise, export to MP3 or WAV. Nothing is uploaded.

## Problem It Solves
Someone has a song, a voice memo, a podcast episode or a lecture recording and needs just a slice
of it — the 30-second hook they want as a phone ringtone, the one quote they want to send a
colleague, the intro they want to drop from a recording before sharing it. Every "trim MP3 online"
or "ringtone maker" site on the web asks them to upload the whole file first — a private voice
memo, an unreleased demo, a confidential interview — to a stranger's server that then slaps a
watermark on the output or makes them sign up. Clipwell does the whole job in the browser: drop the
file, drag the two handles across the waveform to pick the region, add a fade in/out, normalise the
level, and export a clean MP3 or WAV. The audio never leaves the device.

## Why This Must Be Client-Side
- **Sensitive-data handling** — voice memos, interviews, unreleased music, medical/legal dictation.
  Uploading is the whole problem; local trimming removes it.
- **No-account friction / no watermark** — the online "ringtone makers" gate downloads behind
  sign-ups and stamp audio watermarks. A local tool has no reason to.
- **Speed & large files** — a 90-minute podcast is hundreds of MB; decoding and trimming it locally
  beats a round-trip upload, and works offline once loaded (PWA).

## Browser APIs / Libraries Used
| API / Library | What it does for us | Fallback if unsupported |
|---------------|----------------------|-------------------------|
| Web Audio API — `AudioContext.decodeAudioData` | Decodes any browser-supported format (MP3, M4A/AAC, WAV, OGG, FLAC, most video files) to raw PCM | Clear error if the browser can't decode the codec |
| Web Audio API — `OfflineAudioContext` | Renders the selected region with sample-accurate fade in/out + gain applied | N/A — core |
| Web Audio API — `AudioBufferSourceNode` + `GainNode` | Live preview playback of the selection with a moving playhead | Falls back to no preview; export still works |
| Canvas 2D | Draws the waveform, selection overlay, handles and playhead | N/A — core |
| Web Workers | MP3 (LAME) / WAV encoding off the main thread with progress | N/A — required for MP3 |
| `@breezystack/lamejs` | Pure-JS LAME MP3 encoder (no WASM, no COOP/COEP headers) | WAV export always available if MP3 encode fails |
| Web Share API (files) | Native share sheet for the exported clip (mobile) | Hidden when unsupported; download always works |
| Service Worker (PWA) | Offline app shell; proof there is no server | Tool still works online without it |

## Workflow (input → process → output)
1. User drops/picks an audio or video file (or pastes one from the clipboard).
2. Clipwell decodes it to PCM, draws the waveform, and shows two draggable region handles.
3. User drags the handles (or types exact times), toggles fade in/out and normalise, and previews
   the selection with a moving playhead.
4. User picks MP3 (128/192/320 kbps) or WAV and exports; a Web Worker encodes the rendered region.
5. User downloads or shares the clip. The bytes only ever existed in this tab.

## Non-Goals
- No multi-track editing, no effects rack, no recording (that's Screenwell's job).
- No cloud sync, no accounts, ever.
- No batch/multi-file trimming in v1 — one file at a time.
- No format transcode matrix beyond MP3/WAV out (v1).

## Target Audience
A podcaster or musician on a laptop pulling a shareable clip out of a private recording at 11pm, and
a phone user trying to make a ringtone from a song they own without uploading it to an ad-choked
"ringtone maker" — both value that the file never leaves the device and there's no watermark.

## Style Direction
**Tone:** confident, creative, a little warm — an audio tool, not a spreadsheet.
**Colour palette:** dark, near-black canvas with a warm amber accent — the language of waveform
editors (Audacity, DAWs) where a bright signal reads against a dark field.
**UI density:** balanced — a roomy waveform stage with a compact controls rail.
**Dark/light theme:** dark (audio-visual / creative convention).
**Reference tools for feel:** Audacity's selection model; mp3cut.net's waveform-drag UX (minus the
uploads and ads).

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite (no React needed — single workspace, imperative canvas).
- **Key libraries:** `@breezystack/lamejs` (MP3). WAV encoder hand-rolled (pure, tested).
- **Worker strategy:** single dedicated encoder worker (WAV + MP3), progress via postMessage,
  channel PCM transferred in.
- **Storage:** localStorage for last-used settings (format, bitrate, fades) only — never audio.

## Privacy & Trust Model
**Protected**
- The source file, its decoded PCM, the trimmed region and the exported clip never leave the device.
  There is no upload endpoint in the code.
- No accounts, no cookies for your data, no third-party fonts, no watermark.
- Works fully offline once loaded.

**Not protected**
- The exported clip is an ordinary, unencrypted audio file — store and send it as carefully as any
  sensitive recording.
- Clipwell can't stop you from sharing the clip yourself after export.
- Codec support for decoding depends on your browser (e.g. some browsers won't decode certain
  video containers) — an honest error is shown when a file can't be decoded.

**Trust surface**
- The static site bundle (hash-pinned by the GitHub Pages deploy) and the TLS chain to GitHub Pages.
- Your browser's native Web Audio decoder and the bundled LAME MP3 encoder (runs locally).
- A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting,
  no cross-site tracking; your audio is never sent to it.

## UX Required Surfaces
- Drop zone (drag-drop, tap-to-pick, paste-to-ingest) with accepted-formats caption.
- Waveform stage with draggable region handles + numeric start/end/duration fields.
- Determinate export progress with a percentage/throughput readout.
- Event log drawer (Dropwell pattern) with in-drawer × close + Escape.
- How-It-Works modal, Privacy (threat model) modal, About modal.
- Output delivery: download + Web Share; QR is N/A (no link output).
- Keyboard shortcuts: Space play/pause, Escape close, Enter export.
- Sticky footer with benrichardson.dev + sites.benrichardson.dev backlink.
