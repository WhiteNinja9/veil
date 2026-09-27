import * as tf from '@tensorflow/tfjs-core';
import { type GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';
import { extractPersons, nonMaxSuppression } from '../postprocess';
import type { Region } from '../types';
import type { DetectorProvider, PreparedImage, ProviderContext } from './provider';

/**
 * Person detector: COCO-SSD (SSDLite MobileNetV2, Apache-2.0), weights
 * uint8-quantised at build time. Only the "person" class is used. The graph
 * contains control flow, so inference goes through `executeAsync`.
 */
export class PersonDetector implements DetectorProvider {
  readonly id = 'person-ssdlite-mobilenet-v2';
  readonly signal = 'people' as const;
  private static readonly MAX_SIDE = 320;
  private static readonly MIN_SCORE = 0.3;
  private model: GraphModel | null = null;

  get loaded(): boolean {
    return this.model !== null;
  }

  async load(context: ProviderContext): Promise<void> {
    this.model = await loadGraphModel(context.modelUrl(this.id));
  }

  async warmup(): Promise<void> {
    const input = tf.zeros([1, 128, 128, 3], 'int32');
    const outputs = await this.execute(input);
    input.dispose();
    await Promise.all(outputs.map((t) => t.data()));
    tf.dispose(outputs);
  }

  async detect(image: PreparedImage): Promise<Region[]> {
    const [h, w] = image.pixels.shape;
    const scale = Math.min(1, PersonDetector.MAX_SIDE / Math.max(h, w));
    const input = tf.tidy(() =>
      tf.expandDims(
        tf.cast(
          tf.image.resizeBilinear(image.pixels, [Math.max(1, Math.round(h * scale)), Math.max(1, Math.round(w * scale))]),
          'int32',
        ),
        0,
      ),
    );
    const outputs = await this.execute(input);
    input.dispose();
    try {
      const scoresT = outputs.find((t) => t.shape[t.shape.length - 1] === 90);
      const boxesT = outputs.find((t) => t.shape[t.shape.length - 1] === 4);
      if (!scoresT || !boxesT) throw new Error('COCO-SSD outputs not recognised');
      const [scores, boxes] = await Promise.all([scoresT.data(), boxesT.data()]);
      const numBoxes = scoresT.shape[1] ?? 0;
      const candidates = extractPersons(scores, boxes, numBoxes, 90, PersonDetector.MIN_SCORE);
      return nonMaxSuppression(candidates, 0.5, 20);
    } finally {
      tf.dispose(outputs);
    }
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }

  private async execute(input: tf.Tensor): Promise<tf.Tensor[]> {
    if (!this.model) throw new Error(`${this.id} not loaded`);
    const result = await this.model.executeAsync(input);
    return Array.isArray(result) ? result : [result];
  }
}
