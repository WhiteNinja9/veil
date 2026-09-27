import * as tf from '@tensorflow/tfjs-core';
import {
  type BackendSelection,
  candidateOrder,
  type HardwareBackend,
  preferredBatchSize,
  selectBackend,
} from '../backend';
import { type DecodedMedia, decodeImage, rasterize } from '../decode';
import { aggregateFrames } from '../postprocess';
import { FaceDetector } from '../providers/face-detector';
import { NsfwClassifier } from '../providers/nsfw-classifier';
import { PersonDetector } from '../providers/person-detector';
import type { AnyProvider, ClassifierProvider, DetectorProvider, PreparedImage } from '../providers/provider';
import { TestClassifier, TestFaceDetector, TestPersonDetector } from '../providers/test-providers';
import { blobToDataUrl, RENDER_MAX_SIDE, renderConcealed } from '../render';
import type { EngineStatus, Region, SignalKind, Signals } from '../types';
import type { BenchmarkResult, DetectJob, RenderJob, WorkerConfig } from './protocol';

/** Longest side fed to the models. Every model input is ≤ 320 px, so more is wasted work. */
const MODEL_MAX_SIDE = 320;
const MAX_RETAINED = 8;
const TIMING_WINDOW = 200;

export class EngineJobError extends Error {
  constructor(
    readonly code: 'decode-failed' | 'engine-unavailable' | 'cancelled',
    message: string,
  ) {
    super(message);
  }
}

interface QueuedJob {
  job: DetectJob;
  seq: number;
  resolve: (signals: Signals) => void;
  reject: (error: EngineJobError) => void;
}

/**
 * DetectionEngine — runs inside a dedicated worker.
 *
 * Responsibilities: backend selection, lazy provider loading and warm-up,
 * priority queueing, cross-request batching for the classifier, per-image
 * detector passes, animated-image frame sampling, tensor lifetime, and
 * region rendering. It knows nothing about pages, policies or settings.
 */
export class DetectionEngine {
  private selection: BackendSelection | null = null;
  private initPromise: Promise<BackendSelection> | null = null;
  private readonly providers = new Map<SignalKind, AnyProvider>();
  private readonly loading = new Map<SignalKind, Promise<void>>();
  private readonly loadTimes = new Map<string, number>();
  private queue: QueuedJob[] = [];
  private pumping = false;
  private seq = 0;
  private readonly timings: number[] = [];
  private processed = 0;
  private readonly retained = new Map<string, ImageBitmap>();
  private lastError: string | undefined;
  private state: EngineStatus['state'] = 'idle';

  constructor(
    private readonly config: WorkerConfig,
    private readonly onAttempt: (backend: HardwareBackend) => void = () => undefined,
  ) {}

  init(): Promise<BackendSelection> {
    if (!this.initPromise) {
      this.state = 'loading';
      this.initPromise = (async () => {
        if (this.config.testModel) {
          await tf.setBackend('cpu');
          await tf.ready();
          this.selection = { name: 'cpu', detail: 'test model (deterministic)', initMs: 0, skipped: [] };
        } else {
          this.selection = await selectBackend(
            candidateOrder(this.config.backend, this.config.profileBest, this.config.exclude),
            {
              wasmBaseUrl: this.config.wasmBaseUrl,
              onAttempt: this.onAttempt,
            },
          );
        }
        this.state = 'ready';
        return this.selection;
      })().catch((error: unknown) => {
        this.state = 'error';
        this.lastError = error instanceof Error ? error.message : String(error);
        this.initPromise = null;
        throw error;
      });
    }
    return this.initPromise;
  }

  private createProvider(kind: SignalKind): AnyProvider {
    if (this.config.testModel) {
      if (kind === 'classifier') return new TestClassifier();
      return kind === 'faces' ? new TestFaceDetector() : new TestPersonDetector();
    }
    if (kind === 'classifier') return new NsfwClassifier();
    return kind === 'faces' ? new FaceDetector() : new PersonDetector();
  }

  /** Loads and warms the providers for `kinds` (idempotent, deduplicated). */
  async ensure(kinds: readonly SignalKind[]): Promise<void> {
    await this.init();
    await Promise.all(
      kinds.map((kind) => {
        if (this.providers.get(kind)?.loaded) return Promise.resolve();
        let pending = this.loading.get(kind);
        if (!pending) {
          pending = (async () => {
            const provider = this.createProvider(kind);
            const started = performance.now();
            await provider.load({ modelUrl: (id) => `${this.config.modelBaseUrl}${id}/model.json` });
            await provider.warmup();
            this.loadTimes.set(provider.id, performance.now() - started);
            this.providers.set(kind, provider);
          })().finally(() => this.loading.delete(kind));
          this.loading.set(kind, pending);
        }
        return pending;
      }),
    );
  }

  detect(job: DetectJob): Promise<Signals> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, seq: this.seq++, resolve, reject });
      this.schedulePump();
    });
  }

  cancel(id: string): void {
    const index = this.queue.findIndex((q) => q.job.id === id);
    if (index >= 0) {
      const [entry] = this.queue.splice(index, 1);
      entry?.reject(new EngineJobError('cancelled', 'cancelled'));
    }
  }

  private schedulePump(): void {
    if (this.pumping) return;
    this.pumping = true;
    // A macrotask lets messages already queued arrive first, so they batch.
    setTimeout(() => void this.pump(), 0);
  }

  private async pump(): Promise<void> {
    try {
      while (this.queue.length) {
        this.queue.sort((a, b) => a.job.priority - b.job.priority || a.seq - b.seq);
        const batch = this.queue.splice(0, preferredBatchSize(this.selection?.name));
        await this.processBatch(batch);
      }
    } finally {
      this.pumping = false;
      if (this.queue.length) this.schedulePump();
    }
  }

  private async processBatch(entries: QueuedJob[]): Promise<void> {
    const started = performance.now();
    const kinds = [...new Set(entries.flatMap((e) => e.job.signals))];
    try {
      await this.ensure(kinds);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'model load failed';
      this.lastError = message;
      for (const entry of entries) entry.reject(new EngineJobError('engine-unavailable', message));
      return;
    }

    const decoded = await Promise.all(
      entries.map(async (entry) => {
        try {
          return await decodeImage(entry.job.blob, this.config.animatedFrames);
        } catch (error) {
          entry.reject(
            new EngineJobError('decode-failed', error instanceof Error ? error.message : 'decode failed'),
          );
          return null;
        }
      }),
    );

    const work: { entry: QueuedJob; media: DecodedMedia; images: PreparedImage[] }[] = [];
    try {
      for (let i = 0; i < entries.length; i++) {
        const media = decoded[i];
        if (!media) continue;
        const images = media.frames.map((frame) => ({
          pixels: tf.browser.fromPixels(rasterize(frame, MODEL_MAX_SIDE)) as tf.Tensor3D,
          width: media.width,
          height: media.height,
        }));
        work.push({ entry: entries[i]!, media, images });
      }
      await this.runProviders(work, started);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'inference failed';
      this.lastError = message;
      for (const { entry } of work) entry.reject(new EngineJobError('engine-unavailable', message));
    } finally {
      for (const { entry, media, images } of work) {
        for (const image of images) image.pixels.dispose();
        media.frames.forEach((frame, index) => {
          if (index === 0 && entry.job.retainForRender) void this.retain(entry.job.key, frame);
          else frame.close();
        });
      }
    }
  }

  private async runProviders(
    work: { entry: QueuedJob; media: DecodedMedia; images: PreparedImage[] }[],
    started: number,
  ): Promise<void> {
    const results = work.map(() => ({}) as Pick<Signals, 'classifier' | 'faces' | 'people'>);
    const classifier = this.providers.get('classifier') as ClassifierProvider | undefined;

    // 1. Classifier, batched across every frame of every job that wants it.
    const classifyItems: { workIndex: number; image: PreparedImage }[] = [];
    work.forEach((w, workIndex) => {
      if (w.entry.job.signals.includes('classifier'))
        w.images.forEach((image) => classifyItems.push({ workIndex, image }));
    });
    if (classifier && classifyItems.length) {
      const perWork = new Map<number, ReturnType<typeof aggregateFrames>[]>();
      for (let i = 0; i < classifyItems.length; i += classifier.maxBatch) {
        const chunk = classifyItems.slice(i, i + classifier.maxBatch);
        const scores = await classifier.classify(chunk.map((c) => c.image));
        chunk.forEach((c, j) => {
          const list = perWork.get(c.workIndex) ?? [];
          list.push(scores[j]!);
          perWork.set(c.workIndex, list);
        });
      }
      for (const [workIndex, frames] of perWork) results[workIndex]!.classifier = aggregateFrames(frames);
    }

    // 2. Region detectors on the first frame.
    for (const kind of ['faces', 'people'] as const) {
      const detector = this.providers.get(kind) as DetectorProvider | undefined;
      if (!detector) continue;
      for (let i = 0; i < work.length; i++) {
        if (!work[i]!.entry.job.signals.includes(kind)) continue;
        results[i]![kind] = await detector.detect(work[i]!.images[0]!);
      }
    }

    const elapsed = performance.now() - started;
    const backend = this.selection?.name ?? 'unknown';
    const models = [...this.providers.values()].map((p) => p.id);
    work.forEach(({ entry, media }, i) => {
      this.recordTiming(elapsed / work.length);
      entry.resolve({
        ...results[i],
        width: media.width,
        height: media.height,
        backend,
        models,
        ms: Math.round(elapsed),
        frames: media.frames.length,
      });
    });
  }

  private recordTiming(ms: number): void {
    this.processed++;
    this.timings.push(ms);
    if (this.timings.length > TIMING_WINDOW) this.timings.shift();
  }

  private async retain(key: string, frame: ImageBitmap): Promise<void> {
    let bitmap = frame;
    const longest = Math.max(frame.width, frame.height);
    if (longest > RENDER_MAX_SIDE) {
      const scale = RENDER_MAX_SIDE / longest;
      bitmap = await createImageBitmap(frame, {
        resizeWidth: Math.round(frame.width * scale),
        resizeHeight: Math.round(frame.height * scale),
        resizeQuality: 'medium',
      });
      frame.close();
    }
    this.retained.get(key)?.close();
    this.retained.delete(key);
    this.retained.set(key, bitmap);
    while (this.retained.size > MAX_RETAINED) {
      const [oldestKey, oldest] = this.retained.entries().next().value as [string, ImageBitmap];
      oldest.close();
      this.retained.delete(oldestKey);
    }
  }

  async render(job: RenderJob): Promise<string> {
    let bitmap = this.retained.get(job.key);
    let owned = false;
    if (!bitmap) {
      if (!job.blob) throw new Error('image no longer available');
      const media = await decodeImage(job.blob, 1);
      bitmap = media.frames[0]!;
      owned = true;
    }
    try {
      return await blobToDataUrl(await renderConcealed(bitmap, job.regions as Region[], job.style));
    } finally {
      if (owned) bitmap.close();
    }
  }

  async preload(kinds: SignalKind[]): Promise<void> {
    await this.ensure(kinds);
  }

  status(): EngineStatus {
    const sorted = [...this.timings].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0;
    const known: SignalKind[] = ['classifier', 'faces', 'people'];
    return {
      state: this.state,
      backend: (this.selection?.name as EngineStatus['backend']) ?? null,
      models: known
        .filter((kind) => this.providers.has(kind))
        .map((kind) => {
          const provider = this.providers.get(kind)!;
          return {
            id: provider.id,
            loaded: provider.loaded,
            loadMs: Math.round(this.loadTimes.get(provider.id) ?? 0),
          };
        }),
      queue: this.queue.length,
      processed: this.processed,
      avgMs: Math.round(avg * 10) / 10,
      p95Ms: Math.round(p95 * 10) / 10,
      cacheHitRate: 0,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  backendDetail(): string {
    return this.selection?.detail ?? '';
  }

  dispose(): void {
    for (const provider of this.providers.values()) provider.dispose();
    this.providers.clear();
    for (const bitmap of this.retained.values()) bitmap.close();
    this.retained.clear();
  }
}

/**
 * Measures the classifier on each backend in turn. Runs in a throwaway
 * worker (backend switching is global to the TF.js instance).
 */
export async function benchmarkBackends(
  config: WorkerConfig,
  backends: HardwareBackend[],
  iterations: number,
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  for (const backend of backends) {
    const result: BenchmarkResult = { backend, ok: false };
    try {
      const selection = await selectBackend([backend], {
        wasmBaseUrl: config.wasmBaseUrl,
        allowSoftwareGpu: true,
      });
      result.initMs = round(selection.initMs);
      result.detail = selection.detail;
      const classifier = config.testModel ? new TestClassifier() : new NsfwClassifier();
      let t = performance.now();
      await classifier.load({ modelUrl: (id) => `${config.modelBaseUrl}${id}/model.json` });
      result.loadMs = round(performance.now() - t);
      const make = () => ({
        pixels: tf.randomUniform([MODEL_MAX_SIDE, MODEL_MAX_SIDE, 3], 0, 255, 'int32') as tf.Tensor3D,
        width: MODEL_MAX_SIDE,
        height: MODEL_MAX_SIDE,
      });
      const first = make();
      t = performance.now();
      await classifier.classify([first]);
      result.firstMs = round(performance.now() - t);
      first.pixels.dispose();
      const samples: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const image = make();
        t = performance.now();
        await classifier.classify([image]);
        samples.push(performance.now() - t);
        image.pixels.dispose();
      }
      samples.sort((a, b) => a - b);
      result.medianMs = round(samples[Math.floor(samples.length / 2)] ?? 0);
      const batch = [make(), make(), make(), make()];
      t = performance.now();
      await classifier.classify(batch);
      result.batch4PerImageMs = round((performance.now() - t) / 4);
      batch.forEach((b) => b.pixels.dispose());
      classifier.dispose();
      result.ok = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message.slice(0, 160) : 'failed';
    }
    results.push(result);
  }
  return results;
}

const round = (v: number) => Math.round(v * 10) / 10;
