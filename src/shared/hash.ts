/**
 * Non-cryptographic hashing used for cache keys and frame change detection.
 * Nothing here is used for security decisions (see security/crypto.ts).
 */

/** 64-bit (2 × 32-bit, independently seeded) string hash rendered as hex. */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Difference hash of a 9×8 grayscale thumbnail: 64 bits describing whether
 * each pixel is brighter than its right neighbour. Robust to scaling and
 * small brightness changes, which makes it a cheap scene-change detector.
 */
export interface FrameSignature {
  hi: number;
  lo: number;
  /** Mean RGB of the thumbnail: catches colour changes luminance misses. */
  rgb?: [number, number, number];
}

/**
 * @param deadBand minimum brightness difference for a bit to be set. Flat
 *   areas (sky, walls, gradients) otherwise flip bits on codec noise and
 *   look like constant scene changes.
 */
export function differenceHash(gray: ArrayLike<number>, width = 9, height = 8, deadBand = 4): FrameSignature {
  if (gray.length < width * height) throw new RangeError('differenceHash: not enough pixels');
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = gray[y * width + x] ?? 0;
      const right = gray[y * width + x + 1] ?? 0;
      if (left - right > deadBand) {
        if (bit < 32) lo |= 1 << bit;
        else hi |= 1 << (bit - 32);
      }
      bit++;
    }
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hammingDistance(a: FrameSignature, b: FrameSignature): number {
  return popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);
}

/** Largest per-channel difference of mean colour (0 when either lacks colour data). */
export function colorDistance(a: FrameSignature, b: FrameSignature): number {
  if (!a.rgb || !b.rgb) return 0;
  return Math.max(
    Math.abs(a.rgb[0] - b.rgb[0]),
    Math.abs(a.rgb[1] - b.rgb[1]),
    Math.abs(a.rgb[2] - b.rgb[2]),
  );
}

export function meanColor(rgba: ArrayLike<number>): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = Math.floor(rgba.length / 4) || 1;
  for (let i = 0; i < n; i++) {
    r += rgba[i * 4] ?? 0;
    g += rgba[i * 4 + 1] ?? 0;
    b += rgba[i * 4 + 2] ?? 0;
  }
  return [r / n, g / n, b / n];
}

/** Converts RGBA pixel data to luma (Rec. 601), the input of differenceHash. */
export function rgbaToGray(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    out[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return out;
}
