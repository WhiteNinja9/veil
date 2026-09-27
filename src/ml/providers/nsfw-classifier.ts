import * as tf from '@tensorflow/tfjs-core';
import { type GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';
import { toClassifierScores } from '../postprocess';
import type { ClassifierScores } from '../types';
import type { ClassifierProvider, PreparedImage, ProviderContext } from './provider';

/**
 * Five-class content classifier (MobileNetV2, 224×224, softmax output).
 * Weights: NSFWJS "MobileNetV2 Mid" (MIT). Input is RGB scaled to [0, 1];
 * the graph applies its own mean/std normalisation.
 */
export class NsfwClassifier implements ClassifierProvider {
  readonly id = 'nsfw-mobilenet-v2-mid';
  readonly signal = 'classifier' as const;
  readonly maxBatch = 8;
  private static readonly SIZE = 224;
  private model: GraphModel | null = null;

  get loaded(): boolean {
    return this.model !== null;
  }

  async load(context: ProviderContext): Promise<void> {
    this.model = await loadGraphModel(context.modelUrl(this.id));
  }

  async warmup(): Promise<void> {
    const size = NsfwClassifier.SIZE;
    const out = tf.tidy(() => this.requireModel().predict(tf.zeros([1, size, size, 3])) as tf.Tensor);
    await out.data();
    out.dispose();
  }

  async classify(images: PreparedImage[]): Promise<ClassifierScores[]> {
    if (!images.length) return [];
    const size = NsfwClassifier.SIZE;
    const output = tf.tidy(() => {
      const batch = tf.stack(
        images.map((image) => tf.div(tf.image.resizeBilinear(image.pixels, [size, size], true), 255)),
      ) as tf.Tensor4D;
      return this.requireModel().predict(batch) as tf.Tensor2D;
    });
    const data = await output.data();
    output.dispose();
    return images.map((_, i) => toClassifierScores(data.subarray(i * 5, i * 5 + 5)));
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }

  private requireModel(): GraphModel {
    if (!this.model) throw new Error(`${this.id} not loaded`);
    return this.model;
  }
}
