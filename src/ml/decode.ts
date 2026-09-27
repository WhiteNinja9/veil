/**
 * Image decoding for the inference worker.
 *
 * Still images decode through createImageBitmap. Animated images (GIF,
 * animated WebP/PNG/AVIF) are sampled at up to `maxFrames` evenly spaced
 * frames through WebCodecs' ImageDecoder where available, because an
 * animation's first frame is frequently innocuous.
 */

export interface DecodedMedia {
  frames: ImageBitmap[];
  width: number;
  height: number;
  animated: boolean;
}

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

const ANIMATABLE = new Set(['image/gif', 'image/webp', 'image/png', 'image/apng', 'image/avif']);

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; animated: boolean } | null };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}

interface ImageDecoderCtor {
  new (init: { data: ReadableStream<Uint8Array> | BufferSource; type: string }): ImageDecoderLike;
  isTypeSupported(type: string): Promise<boolean>;
}

function imageDecoderCtor(): ImageDecoderCtor | null {
  const ctor = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  return typeof ctor === 'function' ? ctor : null;
}

export function frameIndices(frameCount: number, maxFrames: number): number[] {
  if (frameCount <= 1 || maxFrames <= 1) return [0];
  const n = Math.min(frameCount, maxFrames);
  const indices = new Set<number>();
  for (let i = 0; i < n; i++) indices.add(Math.round((i * (frameCount - 1)) / (n - 1)));
  return [...indices];
}

async function decodeAnimated(blob: Blob, maxFrames: number): Promise<DecodedMedia | null> {
  const Ctor = imageDecoderCtor();
  if (!Ctor || !ANIMATABLE.has(blob.type) || maxFrames <= 1) return null;
  try {
    if (!(await Ctor.isTypeSupported(blob.type))) return null;
    const decoder = new Ctor({ data: await blob.arrayBuffer(), type: blob.type });
    try {
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (!track || !track.animated || track.frameCount <= 1) return null;
      const frames: ImageBitmap[] = [];
      for (const frameIndex of frameIndices(track.frameCount, maxFrames)) {
        const { image } = await decoder.decode({ frameIndex });
        try {
          frames.push(await createImageBitmap(image));
        } finally {
          image.close();
        }
      }
      const first = frames[0];
      if (!first) return null;
      return { frames, width: first.width, height: first.height, animated: true };
    } finally {
      decoder.close();
    }
  } catch {
    return null; // fall back to the still-image path
  }
}

export async function decodeImage(blob: Blob, maxFrames = 3): Promise<DecodedMedia> {
  const animated = await decodeAnimated(blob, maxFrames);
  if (animated) return animated;
  try {
    const bitmap = await createImageBitmap(blob);
    if (!bitmap.width || !bitmap.height) {
      bitmap.close();
      throw new DecodeError('empty image');
    }
    return { frames: [bitmap], width: bitmap.width, height: bitmap.height, animated: false };
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    throw new DecodeError(`undecodable image (${blob.type || 'unknown type'})`);
  }
}

/** Draws a bitmap scaled so its longest side is at most `maxSide`; returns RGBA pixels. */
export function rasterize(bitmap: ImageBitmap, maxSide: number): ImageData {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new DecodeError('2D canvas unavailable');
  // Transparent regions (PNG icons, stickers) are composited over mid-grey,
  // which the classifier treats as neutral, rather than black.
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** Decodes a `data:` URL into a Blob without going through fetch. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new DecodeError('malformed data URL');
  const type = match[1] ?? 'application/octet-stream';
  const payload = match[3] ?? '';
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(payload)], { type });
}
