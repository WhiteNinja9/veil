import * as tf from '@tensorflow/tfjs-core';
import type { ClassifierScores, Region } from '../types';
import type { ClassifierProvider, DetectorProvider, PreparedImage } from './provider';

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
 *   green    (  0, 200,   0)  one face in the centre (content neutral)
 *   other                     neutral 0.97
 */
export const TEST_MARKERS = {
  explicit: [255, 0, 255],
  illustrated: [0, 255, 255],
  suggestive: [255, 140, 0],
  borderline: [255, 255, 0],
  face: [0, 200, 0],
} as const;

type Marker = keyof typeof TEST_MARKERS | 'none';

function nearest(rgb: number[]): Marker {
  for (const [name, target] of Object.entries(TEST_MARKERS) as [keyof typeof TEST_MARKERS, readonly number[]][]) {
    if (target.every((c, i) => Math.abs(c - (rgb[i] ?? 0)) <= 45)) return name;
  }
  return 'none';
}

async function markerOf(image: PreparedImage): Promise<Marker> {
  const [h, w] = image.pixels.shape;
  const size = Math.max(1, Math.min(16, Math.floor(Math.min(h, w) / 4)));
  const mean = tf.tidy(() => tf.mean(tf.cast(tf.slice(image.pixels, [0, 0, 0], [size, size, 3]), 'float32'), [0, 1]));
  const rgb = Array.from(await mean.data()) as number[];
  mean.dispose();
  return nearest(rgb);
}

const neutral = (): ClassifierScores => ({ drawing: 0.01, hentai: 0.005, neutral: 0.97, porn: 0.005, sexy: 0.01 });

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
    return (await markerOf(image)) === 'face' ? [{ x: 0.35, y: 0.3, w: 0.3, h: 0.35, score: 0.96 }] : [];
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
    return (await markerOf(image)) === 'face' ? [{ x: 0.25, y: 0.2, w: 0.5, h: 0.75, score: 0.9 }] : [];
  }
}
