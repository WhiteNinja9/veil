import * as tf from '@tensorflow/tfjs-core';
import { type GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';
import {
  clampRegion,
  decodeBlazeFace,
  gridAnchors,
  letterbox,
  nonMaxSuppression,
  unletterbox,
} from '../postprocess';
import type { Region } from '../types';
import type { DetectorProvider, PreparedImage, ProviderContext } from './provider';

/**
 * Face detector: MediaPipe BlazeFace (back-camera / 256×256 variant, which
 * handles smaller and more distant faces than the selfie model).
 * Two output heads: 16×16×2 anchors (stride 16) and 8×8×6 anchors (stride 32).
 */
export class FaceDetector implements DetectorProvider {
  readonly id = 'face-blazeface-back';
  readonly signal = 'faces' as const;
  private static readonly SIZE = 256;
  private static readonly MIN_SCORE = 0.5;
  private readonly anchorsFine = gridAnchors(16, 2);
  private readonly anchorsCoarse = gridAnchors(8, 6);
  private model: GraphModel | null = null;

  get loaded(): boolean {
    return this.model !== null;
  }

  async load(context: ProviderContext): Promise<void> {
    this.model = await loadGraphModel(context.modelUrl(this.id));
  }

  async warmup(): Promise<void> {
    const size = FaceDetector.SIZE;
    const outputs = tf.tidy(() => this.execute(tf.zeros([1, size, size, 3])));
    await Promise.all(outputs.map((t) => t.data()));
    tf.dispose(outputs);
  }

  async detect(image: PreparedImage): Promise<Region[]> {
    const [h, w] = image.pixels.shape;
    const box = letterbox(w, h);
    const size = FaceDetector.SIZE;
    const outputs = tf.tidy(() => {
      const padded = tf.pad(image.pixels, [
        [0, box.side - h],
        [0, box.side - w],
        [0, 0],
      ]);
      const input = tf.expandDims(tf.sub(tf.div(tf.image.resizeBilinear(padded, [size, size]), 127.5), 1), 0);
      return this.execute(input);
    });
    try {
      const heads = await this.splitHeads(outputs);
      const candidates = [
        ...decodeBlazeFace(heads.fineScores, heads.fineBoxes, this.anchorsFine, size, FaceDetector.MIN_SCORE),
        ...decodeBlazeFace(heads.coarseScores, heads.coarseBoxes, this.anchorsCoarse, size, FaceDetector.MIN_SCORE),
      ];
      return nonMaxSuppression(candidates, 0.3, 24)
        .map((r) => clampRegion(unletterbox(r, box)))
        .filter((r): r is Region => r !== null);
    } finally {
      tf.dispose(outputs);
    }
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }

  private execute(input: tf.Tensor): tf.Tensor[] {
    if (!this.model) throw new Error(`${this.id} not loaded`);
    const result = this.model.execute(input);
    return Array.isArray(result) ? result : [result];
  }

  /** Output order is not guaranteed across converters; identify heads by shape. */
  private async splitHeads(outputs: tf.Tensor[]) {
    const find = (anchors: number, depth: number) => {
      const t = outputs.find((o) => o.shape[1] === anchors && o.shape[2] === depth);
      if (!t) throw new Error(`BlazeFace head ${anchors}×${depth} missing`);
      return t;
    };
    const [fineScores, fineBoxes, coarseScores, coarseBoxes] = await Promise.all([
      find(512, 1).data(),
      find(512, 16).data(),
      find(384, 1).data(),
      find(384, 16).data(),
    ]);
    return { fineScores, fineBoxes, coarseScores, coarseBoxes };
  }
}
