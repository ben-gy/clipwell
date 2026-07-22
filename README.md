# clipwell

**Trim audio into clips and ringtones in your browser — fade, normalise, export MP3 or WAV. Nothing is uploaded.**

Live: https://clipwell.benrichardson.dev

---

## what it is

Clipwell cuts a slice out of any audio file — the 30-second hook you want as a ringtone, the one
quote you want to send a colleague, the intro you want gone before you share a recording — and does
the whole job in your browser. Drop a file, drag the two handles across the waveform to pick the
region, add a fade in/out, normalise the level, and export a clean MP3 or WAV.

Every "trim MP3 online" and "ringtone maker" site asks you to upload the file first. For a private
voice memo, an unreleased demo, a confidential interview or a lecture recording, uploading is exactly
the thing you don't want to do — and those sites often watermark the output or make you sign up.
Clipwell has no server to upload to: the audio is decoded, trimmed and encoded entirely on your
device, and it keeps working with the network switched off.

It's for podcasters and musicians pulling a shareable clip out of a private recording, and for anyone
making a ringtone from a song they own without handing it to a stranger's server.

## how it works

```
file ─▶ decodeAudioData ─▶ PCM waveform ─▶ [drag region + fade + normalise]
     ─▶ OfflineAudioContext render ─▶ encoder worker (LAME MP3 / WAV) ─▶ download / share
```

1. **Decode.** The dropped file is read into memory and `AudioContext.decodeAudioData` turns it into
   raw PCM. Clipwell draws the samples as a waveform on a canvas.
2. **Select.** You drag the two handles (or type exact times), toggle fade in/out and normalise, and
   preview the selection with a moving playhead — all driven by the Web Audio API.
3. **Render.** An `OfflineAudioContext` bounces just the selected region to a fresh buffer, applying
   sample-accurate fades and the normalisation gain.
4. **Encode.** A dedicated Web Worker encodes that buffer to MP3 (via a pure-JS LAME port) or a
   lossless 16-bit WAV, reporting progress, so the main thread never freezes.
5. **Save.** The finished clip is a `Blob` held in the tab. Download it or share it via the native
   share sheet. The bytes only ever existed here.

## browser APIs used

- **Web Audio — `decodeAudioData`** — decode MP3/M4A/WAV/OGG/FLAC and most video files to PCM.
- **Web Audio — `OfflineAudioContext` + `GainNode`** — render the trimmed region with fades + gain.
- **Web Audio — `AudioBufferSourceNode`** — live preview playback of the selection.
- **Canvas 2D** — waveform, selection overlay, drag handles, playhead.
- **Web Workers** — MP3/WAV encoding off the main thread with progress.
- **Web Share API** — native share sheet for the exported clip (where supported).
- **Service Worker** — offline app shell (PWA).

## security / privacy model

**Protected**
- Your source file, its decoded audio, the trimmed region and the exported clip never leave the
  device. There is no upload endpoint anywhere in the code.
- No account, no cookies for your data, no third-party fonts, no watermark.
- Works fully offline once loaded.

**Not protected**
- The exported clip is an ordinary, unencrypted audio file — store and send it as carefully as any
  sensitive recording.
- Clipwell can't stop you from sharing the clip yourself after export.
- Which files decode depends on your browser's built-in codecs; an honest error is shown when one
  can't be read.

**Trust model**
- The static site bundle (hash-pinned by the GitHub Pages deploy) and the TLS chain to GitHub Pages.
- Your browser's native Web Audio decoder and the bundled LAME MP3 encoder, which runs locally in a
  worker.
- A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting, no
  cross-site tracking; your audio is never sent to it.

## stack

- Vite 6 + vanilla TypeScript
- [`@breezystack/lamejs`](https://github.com/breez/lamejs) for MP3 encoding (pure JS — no WASM, no
  cross-origin-isolation headers); WAV encoder hand-rolled
- Vitest for unit tests (DSP, WAV encoder, formatting — 53 tests)
- GitHub Pages for hosting, deployed via GitHub Actions

No runtime dependencies beyond the bundled LAME encoder. No cookies, no fingerprinting, no
third-party fonts. Anonymous, cookie-less page-view counts via Cloudflare Web Analytics — no personal
data, no cross-site tracking.

## local development

```bash
npm install
npm run dev      # vite dev server on :5173
npm test         # run vitest suite
npm run build    # produce dist/ for deploy
npm run preview  # serve dist/ locally
```

## deploying

A push to `main` triggers `.github/workflows/deploy.yml`, which runs tests, builds, and deploys
`dist/` to GitHub Pages. The custom domain is set via `public/CNAME` — point a `CNAME` DNS record for
`clipwell.benrichardson.dev` at `ben-gy.github.io`.

## license

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see
[ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

In short: you may run, modify, redistribute and even sell this, but if you
distribute it — or run a modified version where other people can reach it — you
have to publish your source under the same licence and keep the attribution. A
separate commercial licence without those obligations is available on request:
<hi@ben.gy>.

Third-party components keep their own licences — see
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
