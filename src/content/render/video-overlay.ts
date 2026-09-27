/**
 * VideoRegionOverlay — blurred boxes that follow people in a playing video.
 *
 * A video frame can't be re-rendered the way an image can, so region
 * protection for video draws over it: one fixed layer in a closed shadow
 * root (open in development builds) with a canvas per protected video.
 * Every animation frame, the canvas is placed over the video's content box
 * and each selected face or person is painted over with a blurred (or
 * pixelated, or solid) copy of that part of the current frame. Boxes are
 * placed from the video's object-fit / object-position and the tracker's
 * prediction at the frame on screen (media time).
 *
 * The copy is drawn with canvas 2D rather than a CSS backdrop-filter:
 * whether a backdrop filter sees video pixels depends on how the browser
 * composites video (hardware overlays, software paths), and a box that
 * looks right but leaves the face sharp would be the worst failure.
 * Drawing the frame ourselves behaves the same everywhere. When the frame
 * can't be drawn (not decoded yet, protected media), the box is opaque.
 *
 * `pointer-events: none` keeps the page's own controls usable. When the
 * video element itself is fullscreen nothing can be drawn over it (the
 * browser shows only that element); `canOverlay` reports this so the caller
 * protects the whole video instead. When a *container* is fullscreen, the
 * layer moves into it.
 */
import type { ProtectionStyle } from '../../policy/types';
import { boxOnElement, type Box, drawnFrameRect, type Rect } from '../media/tracks';

export interface OverlayBox {
  id: number;
  box: Box;
  /** Padding around the box, as a fraction of its size on each side. */
  pad: number;
  shape: 'face' | 'body';
}

export interface OverlaySource {
  /** Boxes to draw at media time `at` (ms), or none. */
  boxes(at: number): OverlayBox[];
  /** Cover the whole frame at media time `at` (scene cut, seek) until the next analysis. */
  cover(at: number): boolean;
  /** Draw nothing (revealed by the user, or protected as a whole). */
  hidden(): boolean;
}

const LAYER_CSS = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; contain: strict; }
  canvas { position: fixed; left: 0; top: 0; pointer-events: none; }
`;

/** Blur radius in CSS pixels per style; other styles paint solid boxes. */
const BLUR_RADIUS: Partial<Record<ProtectionStyle, number>> = {
  'blur-soft': 16,
  'blur-strong': 28,
};
/** Blurring runs on a copy at this scale: the result is the same, at a sixteenth of the pixels. */
const BLUR_SCALE = 0.25;
/** Pixelated boxes are about this many blocks across. */
const PIXEL_BLOCKS = 9;
const NEUTRAL = '#5c5e68';
const SOLID = '#8e9199';

interface Target {
  source: OverlaySource;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Last painted state; an identical frame is not painted again (paused video). */
  painted: string;
  drawn: number;
  /** The frame could not be drawn (protected media): boxes are painted solid. */
  opaque: boolean;
  cssAt: number;
  /** Ancestors that clip the video (overflow, paint containment): nothing is drawn outside them. */
  clippers: Element[];
  css: { fit: string; position: string; bl: number; bt: number; br: number; bb: number };
}

type Shape = OverlayBox['shape'] | 'frame';

export class VideoRegionOverlay {
  private host: HTMLElement | null = null;
  private layer: HTMLDivElement | null = null;
  private readonly targets = new Map<HTMLVideoElement, Target>();
  private frame = 0;
  private scratch: CanvasRenderingContext2D | null = null;
  private readonly lowTransparency = matchMedia('(prefers-reduced-transparency: reduce)');

  constructor(private readonly style: () => ProtectionStyle) {
    document.addEventListener('fullscreenchange', () => this.placeHost(), { passive: true });
  }

  /** False when the video element itself is fullscreen or in picture-in-picture: nothing can be drawn over it. */
  canOverlay(video: HTMLVideoElement): boolean {
    if (document.fullscreenElement === video) return false;
    return document.pictureInPictureElement !== video;
  }

  attach(video: HTMLVideoElement, source: OverlaySource): void {
    this.ensureHost();
    const existing = this.targets.get(video);
    if (existing) {
      existing.source = source;
      existing.painted = '';
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = 0;
      canvas.height = 0;
      canvas.hidden = true;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      this.layer!.append(canvas);
      this.targets.set(video, {
        source,
        canvas,
        ctx,
        painted: '',
        drawn: 0,
        opaque: false,
        cssAt: -Infinity,
        clippers: [],
        css: { fit: 'contain', position: '50% 50%', bl: 0, bt: 0, br: 0, bb: 0 },
      });
    }
    this.schedule();
  }

  detach(video: HTMLVideoElement): void {
    const target = this.targets.get(video);
    if (!target) return;
    target.canvas.remove();
    this.targets.delete(video);
  }

  /** Number of boxes currently drawn for a video (diagnostics, tests). */
  drawn(video: HTMLVideoElement): number {
    const target = this.targets.get(video);
    return !target || target.canvas.hidden ? 0 : target.drawn;
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const video of [...this.targets.keys()]) this.detach(video);
    this.host?.remove();
    this.host = null;
    this.layer = null;
  }

  private ensureHost(): void {
    if (this.host?.isConnected) return;
    const host = document.createElement('veil-video-layer');
    const shadow = host.attachShadow({ mode: __DEV__ ? 'open' : 'closed' });
    const style = document.createElement('style');
    style.textContent = LAYER_CSS;
    const layer = document.createElement('div');
    layer.className = 'layer';
    shadow.append(style, layer);
    this.host = host;
    this.layer = layer;
    for (const target of this.targets.values()) layer.append(target.canvas);
    this.placeHost();
  }

  /** The layer lives in <html>, or inside a fullscreen container so it stays visible. */
  private placeHost(): void {
    if (!this.host) return;
    const fullscreen = document.fullscreenElement;
    const parent =
      fullscreen && !(fullscreen instanceof HTMLVideoElement) ? fullscreen : document.documentElement;
    if (this.host.parentNode !== parent) parent.append(this.host);
  }

  private schedule(): void {
    if (this.frame || !this.targets.size) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
      this.schedule();
    });
  }

  private draw(): void {
    const style = this.style();
    for (const [video, target] of this.targets) {
      if (!video.isConnected) {
        this.detach(video);
        continue;
      }
      this.drawTarget(video, target, style);
    }
  }

  private drawTarget(video: HTMLVideoElement, target: Target, style: ProtectionStyle): void {
    const { source, canvas } = target;
    const rect = video.getBoundingClientRect();
    if (source.hidden() || !this.canOverlay(video) || rect.width < 2 || rect.height < 2) {
      canvas.hidden = true;
      target.painted = '';
      return;
    }
    const now = performance.now();
    if (now - target.cssAt > 500) {
      // Layout-affecting styles change rarely; read them twice a second, not every frame.
      const cs = getComputedStyle(video);
      target.css = {
        fit: cs.objectFit || 'contain',
        position: cs.objectPosition || '50% 50%',
        bl: parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) || 0,
        bt: parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) || 0,
        br: parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight) || 0,
        bb: parseFloat(cs.borderBottomWidth) + parseFloat(cs.paddingBottom) || 0,
      };
      target.clippers = clippingAncestors(video);
      target.cssAt = now;
    }
    const { css } = target;
    const left = rect.left + css.bl;
    const top = rect.top + css.bt;
    const width = Math.round(Math.max(0, rect.width - css.bl - css.br));
    const height = Math.round(Math.max(0, rect.height - css.bt - css.bb));
    const frame = drawnFrameRect(
      { width, height },
      video.videoWidth,
      video.videoHeight,
      css.fit,
      css.position,
    );
    // The part of the video the page actually shows, in canvas pixels.
    let shown: Rect | null = { x: 0, y: 0, w: width, h: height };
    for (const el of target.clippers) {
      const r = el.getBoundingClientRect();
      shown &&= intersect(shown, {
        x: r.left + el.clientLeft - left,
        y: r.top + el.clientTop - top,
        w: el.clientWidth || r.width,
        h: el.clientHeight || r.height,
      });
    }
    const bounds = shown && intersect(shown, frame);
    if (!bounds) {
      canvas.hidden = true;
      target.painted = '';
      return;
    }
    const at = video.currentTime * 1000;
    const cover = source.cover(at);
    const boxes = cover
      ? []
      : source
          .boxes(at)
          .map((item) => ({ rect: boxOnElement(frame, item.box, item.pad), shape: item.shape as Shape }));
    const regions = cover ? [{ rect: frame, shape: 'frame' as Shape }] : boxes;

    const key = [
      left,
      top,
      width,
      height,
      style,
      video.currentTime,
      video.readyState,
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h,
      ...regions.flatMap(({ rect: r, shape }) => [shape, r.x, r.y, r.w, r.h].map(String)),
    ].join('|');
    if (key === target.painted && !canvas.hidden) return;
    target.painted = key;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    canvas.style.transform = `translate(${left}px, ${top}px)`;
    canvas.hidden = false;
    const { ctx } = target;
    ctx.clearRect(0, 0, width, height);
    for (const { rect: r, shape } of regions) this.paint(target, video, frame, bounds, r, shape, style);
    target.drawn = boxes.length;
    if (__DEV__) {
      canvas.dataset.boxes = JSON.stringify(boxes.map(({ rect: r }) => r));
      canvas.dataset.cover = String(cover);
    }
  }

  /**
   * Paints one region: the shape, clipped to the part of the picture that is
   * shown (`bounds`), filled with a protected copy of the frame.
   */
  private paint(
    target: Target,
    video: HTMLVideoElement,
    frame: Rect,
    bounds: Rect,
    r: Rect,
    shape: Shape,
    style: ProtectionStyle,
  ): void {
    const { ctx } = target;
    // Nothing to hide outside the shown picture (letterbox bars, clipped by the page).
    const visible = intersect(r, bounds);
    if (!visible || visible.w < 1 || visible.h < 1) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.clip();
    ctx.beginPath();
    shapePath(ctx, r, shape);
    ctx.clip();
    const blur = BLUR_RADIUS[style];
    const drawable = !target.opaque && video.readyState >= 2 && video.videoWidth > 0;
    ctx.fillStyle = blur === undefined && style !== 'pixelate' ? SOLID : NEUTRAL;
    ctx.fill();
    if (drawable && (blur !== undefined || style === 'pixelate')) {
      try {
        if (blur !== undefined) this.blurred(ctx, video, frame, r, blur);
        else this.pixelated(ctx, video, frame, visible);
        ctx.fillStyle = this.lowTransparency.matches ? 'rgba(92, 94, 104, 0.6)' : 'rgba(92, 94, 104, 0.18)';
        ctx.fill();
      } catch {
        // The frame can't be copied (protected media): keep this video's boxes solid.
        target.opaque = true;
        ctx.fillStyle = SOLID;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Blurs the region of the frame under `r`. The copy reaches past the box
   * by twice the radius so the blur has real pixels to spread at its edges
   * (a blur of the box alone would fade to transparent there and let the
   * sharp frame show through).
   */
  private blurred(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    frame: Rect,
    r: Rect,
    radius: number,
  ): void {
    const margin = radius * 2;
    const area = intersect(
      { x: r.x - margin, y: r.y - margin, w: r.w + 2 * margin, h: r.h + 2 * margin },
      frame,
    );
    if (!area) return;
    const sw = Math.max(1, Math.ceil(area.w * BLUR_SCALE));
    const sh = Math.max(1, Math.ceil(area.h * BLUR_SCALE));
    const scratch = this.scratchOf(sw, sh);
    scratch.clearRect(0, 0, sw + 2, sh + 2);
    scratch.filter = `blur(${radius * BLUR_SCALE}px) saturate(0.7)`;
    drawFrom(scratch, video, frame, area, { x: 0, y: 0, w: sw, h: sh });
    scratch.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scratch.canvas, 0, 0, sw, sh, area.x, area.y, area.w, area.h);
  }

  /** Big square blocks: the region is shrunk to a few blocks across and drawn back without smoothing. */
  private pixelated(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, frame: Rect, r: Rect): void {
    const block = Math.max(6, Math.max(r.w, r.h) / PIXEL_BLOCKS);
    const sw = Math.max(1, Math.round(r.w / block));
    const sh = Math.max(1, Math.round(r.h / block));
    const scratch = this.scratchOf(sw, sh);
    scratch.clearRect(0, 0, sw + 2, sh + 2);
    scratch.imageSmoothingEnabled = true;
    drawFrom(scratch, video, frame, r, { x: 0, y: 0, w: sw, h: sh });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch.canvas, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
    ctx.imageSmoothingEnabled = true;
  }

  /** A shared off-screen canvas at least `w` × `h`; it only ever grows. */
  private scratchOf(w: number, h: number): CanvasRenderingContext2D {
    if (!this.scratch) {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      this.scratch = ctx;
    }
    const { canvas } = this.scratch;
    if (canvas.width < w + 2 || canvas.height < h + 2) {
      canvas.width = Math.max(canvas.width, w + 2);
      canvas.height = Math.max(canvas.height, h + 2);
    }
    return this.scratch;
  }
}

/**
 * Ancestors whose box clips the video: overflow other than visible, or paint
 * containment. The walk stops at a fixed-position ancestor (what is above it
 * doesn't clip it) and at <body>, which clips to the viewport anyway.
 */
function clippingAncestors(video: HTMLVideoElement): Element[] {
  const found: Element[] = [];
  let el = parentOf(video);
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain)) {
      found.push(el);
    }
    if (cs.position === 'fixed') break;
    el = parentOf(el);
  }
  return found;
}

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Draws the part of the video frame shown at element rect `area` into `to` on `ctx`. */
function drawFrom(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  frame: Rect,
  area: Rect,
  to: Rect,
): void {
  const kx = video.videoWidth / frame.w;
  const ky = video.videoHeight / frame.h;
  ctx.drawImage(
    video,
    (area.x - frame.x) * kx,
    (area.y - frame.y) * ky,
    area.w * kx,
    area.h * ky,
    to.x,
    to.y,
    to.w,
    to.h,
  );
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Faces are ovals, bodies rounded rectangles, a covered frame its plain rectangle. */
function shapePath(ctx: CanvasRenderingContext2D, r: Rect, shape: Shape): void {
  if (shape === 'face') {
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    return;
  }
  if (shape === 'frame') {
    ctx.rect(r.x, r.y, r.w, r.h);
    return;
  }
  const radius = Math.min(r.w, r.h) * 0.16;
  ctx.moveTo(r.x + radius, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, radius);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, radius);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, radius);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, radius);
  ctx.closePath();
}
