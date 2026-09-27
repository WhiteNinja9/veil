/**
 * Region rendering: produces a copy of an image with detected regions
 * concealed. Used for face/people protection on <img> elements, where the
 * page shows our rendering in place of the original (see content/render).
 *
 * Concealment is done by resampling each region through a tiny canvas —
 * smooth upscaling reads as a heavy blur, nearest-neighbour as a mosaic.
 * This avoids reliance on CanvasRenderingContext2D.filter support.
 */
import type { Region, RenderStyle } from './types';

export const RENDER_MAX_SIDE = 1024;
const NEUTRAL = '#8e9199';

export async function renderConcealed(
  bitmap: ImageBitmap,
  regions: Region[],
  style: RenderStyle,
): Promise<Blob> {
  const scale = Math.min(1, RENDER_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);

  for (const region of regions) {
    const rx = Math.floor(region.x * width);
    const ry = Math.floor(region.y * height);
    const rw = Math.max(1, Math.ceil(region.w * width));
    const rh = Math.max(1, Math.ceil(region.h * height));
    const radius = Math.min(rw, rh) * 0.28;

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(rx, ry, rw, rh, radius);
    else ctx.rect(rx, ry, rw, rh);
    ctx.clip();

    if (style === 'solid') {
      ctx.fillStyle = NEUTRAL;
      ctx.fillRect(rx, ry, rw, rh);
    } else {
      // Blur: ~6 samples across the region; pixelate: ~10 visible blocks.
      const cells = style === 'blur' ? 6 : 10;
      const tw = Math.max(1, Math.round((rw / Math.max(rw, rh)) * cells));
      const th = Math.max(1, Math.round((rh / Math.max(rw, rh)) * cells));
      const tiny = new OffscreenCanvas(tw, th);
      const tctx = tiny.getContext('2d');
      if (!tctx) throw new Error('2D canvas unavailable');
      tctx.drawImage(canvas, rx, ry, rw, rh, 0, 0, tw, th);
      ctx.imageSmoothingEnabled = style === 'blur';
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tiny, 0, 0, tw, th, rx, ry, rw, rh);
      if (style === 'blur') {
        // Second, offset pass removes the residual grid structure.
        ctx.globalAlpha = 0.5;
        ctx.drawImage(tiny, 0, 0, tw, th, rx - rw / (cells * 2), ry - rh / (cells * 2), rw, rh);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}
