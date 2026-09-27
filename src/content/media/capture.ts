/**
 * In-page pixel capture for media the page itself can read: video frames
 * (including MediaSource streams), same-origin, data: and blob: images.
 * Captures are downscaled before leaving the page; cross-origin media that
 * would taint a canvas is reported as 'tainted' and handled elsewhere.
 */
import { differenceHash, type FrameSignature, meanColor, rgbaToGray } from '../../shared/hash';
import { safeUrl } from '../../shared/url';

export type CaptureResult = { dataUrl: string; width: number; height: number } | 'tainted' | null;

type Drawable = HTMLImageElement | HTMLVideoElement;

function sourceSize(el: Drawable): { width: number; height: number } {
  return el instanceof HTMLVideoElement
    ? { width: el.videoWidth, height: el.videoHeight }
    : { width: el.naturalWidth, height: el.naturalHeight };
}

let frameCanvas: HTMLCanvasElement | null = null;
let signatureCanvas: HTMLCanvasElement | null = null;

function canvas(kind: 'frame' | 'signature'): HTMLCanvasElement {
  // Detached canvases owned by the content script's isolated world.
  if (kind === 'frame') return (frameCanvas ??= document.createElement('canvas'));
  return (signatureCanvas ??= document.createElement('canvas'));
}

function isSecurityError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'SecurityError';
}

/** True when pixels of `url` can be read without a network re-fetch. */
export function isPageReadable(url: string, el?: HTMLImageElement): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  const parsed = safeUrl(url, location.href);
  if (!parsed) return false;
  if (parsed.origin === location.origin) return true;
  return Boolean(el?.crossOrigin);
}

export async function captureElement(el: Drawable, maxSide: number, quality = 0.85): Promise<CaptureResult> {
  const { width, height } = sourceSize(el);
  if (!width || !height) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const target = canvas('frame');
  target.width = w;
  target.height = h;
  const ctx = target.getContext('2d', { alpha: false });
  if (!ctx) return null;
  try {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(el, 0, 0, w, h);
    const dataUrl = target.toDataURL('image/jpeg', quality);
    return { dataUrl, width: w, height: h };
  } catch (error) {
    if (isSecurityError(error)) return 'tainted';
    return null;
  }
}

/** 64-bit perceptual signature of the current video frame (cheap: 9×8 pixels). */
export function frameSignature(video: HTMLVideoElement): FrameSignature | 'tainted' | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const target = canvas('signature');
  target.width = 9;
  target.height = 8;
  const ctx = target.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, 9, 8);
    const data = ctx.getImageData(0, 0, 9, 8).data;
    return { ...differenceHash(rgbaToGray(data)), rgb: meanColor(data) };
  } catch (error) {
    return isSecurityError(error) ? 'tainted' : null;
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Image capture that keeps decoding, scaling and encoding off the main
 * thread where the platform allows (createImageBitmap + OffscreenCanvas).
 */
export async function captureImage(img: HTMLImageElement | ImageBitmapSource, width: number, height: number, maxSide: number): Promise<CaptureResult> {
  if (!width || !height) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    return img instanceof HTMLImageElement ? captureElement(img, maxSide) : null;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return { dataUrl: await blobToDataUrl(blob), width: w, height: h };
  } catch (error) {
    if (isSecurityError(error)) return 'tainted';
    return null;
  } finally {
    bitmap?.close();
  }
}

/** Decodes a data:/blob: URL the page references (e.g. as a CSS background) and captures it. */
export async function captureUrlInPage(url: string, maxSide: number): Promise<CaptureResult> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  return captureImage(img, img.naturalWidth, img.naturalHeight, maxSide);
}
