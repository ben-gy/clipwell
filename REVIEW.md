# Clipwell — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **GitHub Pages:** https://ben-gy.github.io/clipwell/ *(redirects to custom domain once DNS is set)*
- **Custom domain:** https://clipwell.benrichardson.dev *(live after DNS + cert below)*

## What it is

An in-browser audio trimmer & ringtone maker. Drop an audio (or video) file, drag a region across
the waveform, add a fade in/out, normalise, and export MP3 or WAV. Decode + render use the Web Audio
API; encoding runs in a Web Worker (pure-JS LAME for MP3, hand-rolled WAV). Nothing is uploaded.

## DNS setup required

Add in Cloudflare (`benrichardson.dev` zone):

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `clipwell` | `ben-gy.github.io` | DNS only (grey cloud) |

Then trigger cert issuance:
```bash
gh api repos/ben-gy/clipwell/pages -X PUT -f cname=""
sleep 3
gh api repos/ben-gy/clipwell/pages -X PUT -f cname="clipwell.benrichardson.dev"
```
