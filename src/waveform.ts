/**
 * Canvas waveform with a draggable selection region + playhead.
 * Emits region changes as the user drags the handles, moves the region, or
 * sweeps a new selection. All heavy pixel work is throttled to animation frames.
 */

import type { Region } from './types';
import { computePeaks, mergePeaks, clampRegion, type Peak } from './dsp';

const HANDLE_HIT = 11; // px slop for grabbing a handle

type DragMode = 'none' | 'start' | 'end' | 'move' | 'new';

interface WaveColors {
  base: string;
  selected: string;
  handle: string;
  playhead: string;
  regionFill: string;
}

export interface WaveformOptions {
  onRegionChange: (region: Region, committed: boolean) => void;
}

export class Waveform {
  private canvas: HTMLCanvasElement;
  private c2d: CanvasRenderingContext2D;
  private channels: Float32Array[] = [];
  private duration = 0;
  private region: Region = { start: 0, end: 0 };
  private playhead: number | null = null;
  private peaksCache: Peak[] | null = null;
  private cacheWidth = 0;
  private colors: WaveColors;
  private drag: DragMode = 'none';
  private dragAnchor = 0; // seconds, for 'move'
  private rafPending = false;
  private opts: WaveformOptions;
  private ro: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, opts: WaveformOptions) {
    this.canvas = canvas;
    this.opts = opts;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not available in this browser.');
    this.c2d = ctx;
    this.colors = readColors();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerHover);
    this.ro = new ResizeObserver(() => {
      this.peaksCache = null;
      this.draw();
    });
    this.ro.observe(canvas);
  }

  setBuffer(channels: Float32Array[], duration: number, region: Region): void {
    this.channels = channels;
    this.duration = duration;
    this.region = region;
    this.playhead = null;
    this.peaksCache = null;
    this.draw();
  }

  setRegion(region: Region): void {
    this.region = region;
    this.scheduleDraw();
  }

  setPlayhead(t: number | null): void {
    this.playhead = t;
    this.scheduleDraw();
  }

  clear(): void {
    this.channels = [];
    this.duration = 0;
    this.region = { start: 0, end: 0 };
    this.playhead = null;
    this.peaksCache = null;
    this.draw();
  }

  destroy(): void {
    this.ro?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerHover);
  }

  /* -------------------------------------------------------- geometry */

  private cssWidth(): number {
    return this.canvas.clientWidth || 1;
  }

  private timeToX(t: number): number {
    if (this.duration <= 0) return 0;
    return (t / this.duration) * this.cssWidth();
  }

  private xToTime(x: number): number {
    if (this.duration <= 0) return 0;
    return Math.min(this.duration, Math.max(0, (x / this.cssWidth()) * this.duration));
  }

  private localX(e: PointerEvent): number {
    const rect = this.canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  }

  /* ------------------------------------------------------- pointer */

  private onPointerHover = (e: PointerEvent): void => {
    if (this.drag !== 'none' || this.duration <= 0) return;
    const x = this.localX(e);
    const near = this.nearHandle(x);
    this.canvas.style.cursor = near ? 'ew-resize' : this.insideRegion(x) ? 'grab' : 'crosshair';
  };

  private nearHandle(x: number): 'start' | 'end' | null {
    const sx = this.timeToX(this.region.start);
    const ex = this.timeToX(this.region.end);
    if (Math.abs(x - sx) <= HANDLE_HIT) return 'start';
    if (Math.abs(x - ex) <= HANDLE_HIT) return 'end';
    return null;
  }

  private insideRegion(x: number): boolean {
    return x > this.timeToX(this.region.start) && x < this.timeToX(this.region.end);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.duration <= 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const x = this.localX(e);
    const t = this.xToTime(x);
    const near = this.nearHandle(x);
    if (near === 'start') this.drag = 'start';
    else if (near === 'end') this.drag = 'end';
    else if (this.insideRegion(x)) {
      this.drag = 'move';
      this.dragAnchor = t - this.region.start;
    } else {
      this.drag = 'new';
      this.region = { start: t, end: t };
    }
    this.canvas.style.cursor = this.drag === 'move' ? 'grabbing' : 'ew-resize';
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragUp);
    this.applyDrag(t);
  };

  private onDragMove = (e: PointerEvent): void => {
    if (this.drag === 'none') return;
    this.applyDrag(this.xToTime(this.localX(e)));
  };

  private onDragUp = (): void => {
    if (this.drag === 'none') return;
    this.drag = 'none';
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragUp);
    this.canvas.style.cursor = 'crosshair';
    this.opts.onRegionChange(this.region, true);
  };

  private applyDrag(t: number): void {
    let r = this.region;
    if (this.drag === 'start') r = { start: t, end: this.region.end };
    else if (this.drag === 'end') r = { start: this.region.start, end: t };
    else if (this.drag === 'new') r = { start: Math.min(this.region.start, t), end: Math.max(this.region.start, t) };
    else if (this.drag === 'move') {
      const len = this.region.end - this.region.start;
      let s = t - this.dragAnchor;
      s = Math.max(0, Math.min(s, this.duration - len));
      r = { start: s, end: s + len };
    }
    this.region = clampRegion(r.start, r.end, this.duration);
    this.opts.onRegionChange(this.region, false);
    this.scheduleDraw();
  }

  /* ---------------------------------------------------------- draw */

  private scheduleDraw(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.draw();
    });
  }

  private ensurePeaks(buckets: number): Peak[] {
    if (this.peaksCache && this.cacheWidth === buckets) return this.peaksCache;
    if (this.channels.length === 0) {
      this.peaksCache = [];
    } else {
      this.peaksCache = mergePeaks(this.channels.map((ch) => computePeaks(ch, buckets)));
    }
    this.cacheWidth = buckets;
    return this.peaksCache;
  }

  private draw(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.cssWidth();
    const h = this.canvas.clientHeight || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.c2d;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (this.channels.length === 0 || this.duration <= 0) return;

    const mid = h / 2;
    const buckets = Math.max(1, Math.floor(w));
    const peaks = this.ensurePeaks(buckets);
    const sx = this.timeToX(this.region.start);
    const ex = this.timeToX(this.region.end);

    // Region fill.
    ctx.fillStyle = this.colors.regionFill;
    ctx.fillRect(sx, 0, Math.max(1, ex - sx), h);

    // Waveform bars, coloured by whether they fall inside the selection.
    for (let x = 0; x < buckets; x++) {
      const p = peaks[x];
      if (!p) continue;
      const top = mid - p.max * mid * 0.94;
      const bottom = mid - p.min * mid * 0.94;
      ctx.fillStyle = x >= sx && x <= ex ? this.colors.selected : this.colors.base;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    // Handles.
    ctx.fillStyle = this.colors.handle;
    ctx.fillRect(sx - 1, 0, 2, h);
    ctx.fillRect(ex - 1, 0, 2, h);
    drawGrip(ctx, sx, h, this.colors.handle);
    drawGrip(ctx, ex, h, this.colors.handle);

    // Playhead.
    if (this.playhead !== null && this.playhead >= this.region.start && this.playhead <= this.region.end) {
      const px = this.timeToX(this.playhead);
      ctx.fillStyle = this.colors.playhead;
      ctx.fillRect(px - 0.5, 0, 1.5, h);
    }
  }
}

function drawGrip(ctx: CanvasRenderingContext2D, x: number, h: number, color: string): void {
  const gh = 26;
  const gy = h / 2 - gh / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  const r = 3;
  const gw = 8;
  const gx = x - gw / 2;
  roundRect(ctx, gx, gy, gw, gh, r);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 1.5, gy + 7, 1, gh - 14);
  ctx.fillRect(x + 0.5, gy + 7, 1, gh - 14);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function readColors(): WaveColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    base: v('--wave-base', '#3a4152'),
    selected: v('--accent', '#ffab2e'),
    handle: v('--wave-handle', '#ffd18a'),
    playhead: v('--wave-playhead', '#ffffff'),
    regionFill: v('--wave-region', 'rgba(255,171,46,0.10)'),
  };
}
