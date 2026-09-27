import * as tf from '@tensorflow/tfjs-core';
import type { ClassifierScores, Region } from '../types';
import type { ClassifierProvider, DetectorProvider, FaceAttributeProvider, PreparedImage } from './provider';

/**
 * Deterministic providers for automated tests (`--test-model` builds).
 *
 * They exercise the full pipeline — fetch, decode, tensors, batching,
 * policy, rendering — without shipping or requiring explicit test media.
 * The verdict is driven by the average colour of the image's top-left
 * 16×16 block ("marker"):
 *
 *   magenta  (255,   0, 255)  explicit      porn 0.97
 *   cyan     (  0, 255, 255)  illustrated   hentai 0.95
 *   orange   (255, 140,   0)  suggestive    sexy 0.88
 *   yellow   (255, 255,   0)  borderline    sexy 0.50 + porn 0.20
 *   green    (  0, 200,   0)  one face in the centre (content neutral; gender unsure)
 *   teal     (  0, 200, 120)  one face that appears female
 *   blue     (  0, 110, 200)  one face that appears male
 *   other                     neutral 0.97
 *
 * The gender provider reads the *face crop* rather than the marker: lab
 * images paint the face area in the marker colour, so the real cropping
 * path is exercised. A plain green face reads as undecided (0.38).
 *
 * Painted teal / blue areas anywhere in the image (not touching the
 * top-left corner, where markers live) are found as faces where they are,
 * so moving faces in lab videos are detected at their real position.
 */
export const TEST_MARKERS = {
  explicit: [255, 0, 255],
  illustrated: [0, 255, 255],
  suggestive: [255, 140, 0],
  borderline: [255, 255, 0],
  face: [0, 200, 0],
  woman: [0, 200, 120],
  man: [0, 110, 200],
} as const;

type Marker = keyof typeof TEST_MARKERS | 'none';

function nearest(rgb: number[]): Marker {
  for (const [name, target] of Object.entries(TEST_MARKERS) as [
    keyof typeof TEST_MARKERS,
    readonly number[],
  ][]) {
    if (target.every((c, i) => Math.abs(c - (rgb[i] ?? 0)) <= 45)) return name;
  }
  return 'none';
}

const hasFace = (marker: Marker) => marker === 'face' || marker === 'woman' || marker === 'man';

const PAINTED = [TEST_MARKERS.woman, TEST_MARKERS.man] as const;

/** Bounding boxes of teal / blue painted areas, excluding the corner marker. */
async function paintedFaces(image: PreparedImage): Promise<Region[]> {
  const [h, w] = image.pixels.shape;
  const data = await image.pixels.data();
  const step = 2;
  const cols = Math.ceil(w / step);
  const rows = Math.ceil(h / step);
  const mask = new Uint8Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const i = (gy * step * w + gx * step) * 3;
      const rgb = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (PAINTED.some((c) => c.every((v, k) => Math.abs(v - rgb[k]!) <= 45))) mask[gy * cols + gx] = 1;
    }
  }
  const faces: Region[] = [];
  const seen = new Uint8Array(cols * rows);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cell = stack.pop()!;
      const x = cell % cols;
      const y = Math.floor(cell / cols);
      count++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const touchesCorner = minX === 0 && minY === 0;
    if (touchesCorner || count < 12) continue;
    faces.push({
      x: minX / cols,
      y: minY / rows,
      w: (maxX - minX + 1) / cols,
      h: (maxY - minY + 1) / rows,
      score: 0.96,
    });
  }
  return faces;
}

async function markerOf(image: PreparedImage): Promise<Marker> {
  const [h, w] = image.pixels.shape;
  const size = Math.max(1, Math.min(16, Math.floor(Math.min(h, w) / 4)));
  const mean = tf.tidy(() =>
    tf.mean(tf.cast(tf.slice(image.pixels, [0, 0, 0], [size, size, 3]), 'float32'), [0, 1]),
  );
  const rgb = Array.from(await mean.data()) as number[];
  mean.dispose();
  return nearest(rgb);
}

const neutral = (): ClassifierScores => ({
  drawing: 0.01,
  hentai: 0.005,
  neutral: 0.97,
  porn: 0.005,
  sexy: 0.01,
});

export class TestClassifier implements ClassifierProvider {
  readonly id = 'test-classifier';
  readonly signal = 'classifier' as const;
  readonly maxBatch = 8;
  loaded = false;

  async load(): Promise<void> {
    this.loaded = true;
  }
  async warmup(): Promise<void> {}
  dispose(): void {
    this.loaded = false;
  }

  async classify(images: PreparedImage[]): Promise<ClassifierScores[]> {
    return Promise.all(
      images.map(async (image) => {
        switch (await markerOf(image)) {
          case 'explicit':
            return { drawing: 0.005, hentai: 0.01, neutral: 0.005, porn: 0.97, sexy: 0.01 };
          case 'illustrated':
            return { drawing: 0.02, hentai: 0.95, neutral: 0.01, porn: 0.01, sexy: 0.01 };
          case 'suggestive':
            return { drawing: 0.01, hentai: 0.01, neutral: 0.08, porn: 0.02, sexy: 0.88 };
          case 'borderline':
            return { drawing: 0.05, hentai: 0.05, neutral: 0.2, porn: 0.2, sexy: 0.5 };
          default:
            return neutral();
        }
      }),
    );
  }
}

export class TestFaceDetector implements DetectorProvider {
  readonly id = 'test-faces';
  readonly signal = 'faces' as const;
  loaded = false;

  async load(): Promise<void> {
    this.loaded = true;
  }
  async warmup(): Promise<void> {}
  dispose(): void {
    this.loaded = false;
  }

  async detect(image: PreparedImage): Promise<Region[]> {
    const painted = await paintedFaces(image);
    if (painted.length) return painted;
    return hasFace(await markerOf(image)) ? [{ x: 0.35, y: 0.3, w: 0.3, h: 0.35, score: 0.96 }] : [];
  }
}

export class TestPersonDetector implements DetectorProvider {
  readonly id = 'test-people';
  readonly signal = 'people' as const;
  loaded = false;

  async load(): Promise<void> {
    this.loaded = true;
  }
  async warmup(): Promise<void> {}
  dispose(): void {
    this.loaded = false;
  }

  async detect(image: PreparedImage): Promise<Region[]> {
    // A body below each painted face, or the fixed one for marker images.
    const painted = await paintedFaces(image);
    if (painted.length)
      return painted.map((f) => {
        const x = Math.max(0, f.x - f.w / 2);
        const y = Math.max(0, f.y - f.h * 0.2);
        return { x, y, w: Math.min(1 - x, f.w * 2), h: Math.min(1 - y, f.h * 3.5), score: 0.9 };
      });
    return hasFace(await markerOf(image)) ? [{ x: 0.25, y: 0.2, w: 0.5, h: 0.75, score: 0.9 }] : [];
  }
}

export class TestGenderClassifier implements FaceAttributeProvider {
  readonly id = 'test-gender';
  readonly signal = 'gender' as const;
  readonly inputSize = 64;
  readonly maxBatch = 8;
  loaded = false;

  async load(): Promise<void> {
    this.loaded = true;
  }
  async warmup(): Promise<void> {}
  dispose(): void {
    this.loaded = false;
  }

  async female(crops: ImageData[]): Promise<number[]> {
    return crops.map((crop) => {
      // Mean colour of the crop's central quarter.
      const { width, height, data } = crop;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = Math.floor(height / 4); y < Math.ceil((height * 3) / 4); y++) {
        for (let x = Math.floor(width / 4); x < Math.ceil((width * 3) / 4); x++) {
          const i = (y * width + x) * 4;
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          n++;
        }
      }
      n = Math.max(1, n);
      const marker = nearest([r / n, g / n, b / n]);
      return marker === 'woman' ? 0.97 : marker === 'man' ? 0.03 : 0.38; // 0.38: inside the unsure band
    });
  }
}
