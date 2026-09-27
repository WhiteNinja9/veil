import * as tf from '@tensorflow/tfjs-core';
import { type GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';
import type { FaceAttributeProvider, ProviderContext } from './provider';

/**
 * Apparent-gender estimate per face: HSE-FaceRes (A. Savchenko; Apache-2.0),
 * in the TF.js conversion shipped by @vladmandic/human (MIT). Input: square
 * RGB face crops, 0–255. The network was published for 224 px; it ends in
 * global pooling, and at 160 px it measured the same accuracy at half the
 * cost (docs/ML.md). It also predicts age and a face descriptor; only the
 * gender head is evaluated. Its sigmoid output is the probability of
 * "male", so Veil reports 1 − p as the probability the face appears female.
 *
 * This is an appearance estimate with real error rates (docs/ML.md), used
 * only to decide what to blur on the user's own screen. Nothing is stored.
 */
export class GenderClassifier implements FaceAttributeProvider {
  readonly id = 'face-gender-hse';
  readonly signal = 'gender' as const;
  readonly inputSize = 160;
  readonly maxBatch = 8;
  private model: GraphModel | null = null;
  private output = '';

  get loaded(): boolean {
    return this.model !== null;
  }

  async load(context: ProviderContext): Promise<void> {
    const model = await loadGraphModel(context.modelUrl(this.id));
    const output = model.outputs.find((o) => o.name.startsWith('gender'))?.name;
    if (!output) throw new Error('gender model has no gender output');
    this.model = model;
    this.output = output;
  }

  async warmup(): Promise<void> {
    await this.female([new ImageData(this.inputSize, this.inputSize)]);
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }

  async female(crops: ImageData[]): Promise<number[]> {
    if (!this.model || !crops.length) return [];
    const model = this.model;
    const male = tf.tidy(() => {
      const input = tf.stack(crops.map((crop) => tf.cast(tf.browser.fromPixels(crop), 'float32')));
      return model.execute(input, this.output) as tf.Tensor;
    });
    const values = await male.data();
    male.dispose();
    return Array.from(values, (p) => Math.min(1, Math.max(0, 1 - p)));
  }
}
