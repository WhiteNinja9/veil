import type * as tf from '@tensorflow/tfjs-core';
import type { ClassifierScores, Region, SignalKind } from '../types';

/**
 * ModelProvider — the replaceable unit of the detection pipeline.
 *
 * A provider owns exactly one model and produces exactly one signal kind.
 * The DetectionEngine decides which providers to load (lazily, from the
 * active policy), batches work for them, and aggregates their outputs into
 * `Signals`. Swapping a model means adding a provider; nothing else in the
 * extension changes.
 */
export interface PreparedImage {
  /** Downscaled RGB pixels, int32 [height, width, 3]. Owned by the engine. */
  pixels: tf.Tensor3D;
  /** Original (pre-downscale) dimensions. */
  width: number;
  height: number;
}

export interface ProviderContext {
  /** Absolute URL of a model.json packaged with the extension. */
  modelUrl(id: string): string;
}

export interface ModelProvider {
  readonly id: string;
  readonly signal: SignalKind;
  readonly loaded: boolean;
  load(context: ProviderContext): Promise<void>;
  /** Runs a throwaway inference so shader compilation / kernel JIT is off the critical path. */
  warmup(): Promise<void>;
  dispose(): void;
}

export interface ClassifierProvider extends ModelProvider {
  readonly signal: 'classifier';
  readonly maxBatch: number;
  classify(images: PreparedImage[]): Promise<ClassifierScores[]>;
}

export interface DetectorProvider extends ModelProvider {
  readonly signal: 'faces' | 'people';
  detect(image: PreparedImage): Promise<Region[]>;
}

export type AnyProvider = ClassifierProvider | DetectorProvider;

export function isClassifier(provider: AnyProvider): provider is ClassifierProvider {
  return provider.signal === 'classifier';
}
