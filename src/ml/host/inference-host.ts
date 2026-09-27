/**
 * InferenceHost — owns the inference worker's lifecycle.
 *
 * Runs in the Chrome offscreen document or the Firefox background page.
 * Responsibilities: lazy worker start, request/response correlation,
 * per-request timeouts, crash detection and restart with back-off,
 * idle unloading to release GPU/CPU memory, and backend benchmarking.
 */
import { createLogger } from '../../shared/logger';
import type { HardwareBackend } from '../backend';
import type { BenchmarkResult, FromWorker, ToWorker, WorkerConfig } from '../worker/protocol';
import type { DetectRequest, DetectResponse, EngineStatus, RenderRequest, RenderResponse, SignalKind } from '../types';
import { loadSource, MediaError } from './fetch-media';

const log = createLogger('host');

export const DETECT_TIMEOUT_MS = 20_000;
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES = 3;
const COOLDOWN_MS = 30_000;

export interface HostOptions {
  workerUrl: string;
  modelBaseUrl: string;
  wasmBaseUrl: string;
  testModel: boolean;
  /** Reads the latest user preferences each time the worker (re)starts. */
  preferences: () => Promise<{ backend: HardwareBackend | 'auto'; profileBest?: HardwareBackend; unloadAfterMin: number }>;
  createWorker?: (url: string) => Worker;
}

interface Pending {
  resolve: (message: FromWorker) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface HostStatus extends EngineStatus {
  detail: string;
  running: boolean;
}

export class InferenceHost {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private crashes: number[] = [];
  private cooldownUntil = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private unloadAfterMs = 10 * 60_000;
  private backendInfo = { name: '', detail: '' };
  private consecutiveTimeouts = 0;
  private requestSeq = 0;
  /** Backend the worker is initialising right now (reported by the worker). */
  private attempting: HardwareBackend | null = null;
  /** Backends that crashed the worker this session: skipped from now on. */
  private readonly excluded = new Set<HardwareBackend>();

  constructor(private readonly options: HostOptions) {}

  private spawn(url: string): Worker {
    return this.options.createWorker ? this.options.createWorker(url) : new Worker(url);
  }

  private ensureWorker(): Promise<void> {
    if (Date.now() < this.cooldownUntil) return Promise.reject(new MediaError('engine-unavailable', 'engine cooling down'));
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const prefs = await this.options.preferences();
      this.unloadAfterMs = prefs.unloadAfterMin * 60_000;
      const worker = this.spawn(this.options.workerUrl);
      this.worker = worker;
      const readyPromise = new Promise<void>((resolve, reject) => {
        const onMessage = (event: MessageEvent<FromWorker>) => {
          const message = event.data;
          if (message.type === 'trying') {
            this.attempting = message.backend as HardwareBackend;
            return;
          }
          if (message.type === 'ready') {
            this.attempting = null;
            this.backendInfo = { name: message.backend, detail: message.detail };
            worker.removeEventListener('message', onMessage);
            resolve();
          } else if (message.type === 'fatal') {
            worker.removeEventListener('message', onMessage);
            reject(new MediaError('engine-unavailable', message.message));
          }
        };
        worker.addEventListener('message', onMessage);
      });
      worker.addEventListener('message', (event: MessageEvent<FromWorker>) => this.onWorkerMessage(event.data));
      worker.addEventListener('error', (event) => this.onCrash(event.message || 'worker error'));
      const config: WorkerConfig = {
        modelBaseUrl: this.options.modelBaseUrl,
        wasmBaseUrl: this.options.wasmBaseUrl,
        backend: prefs.backend,
        ...(prefs.profileBest ? { profileBest: prefs.profileBest } : {}),
        testModel: this.options.testModel,
        animatedFrames: 3,
        exclude: [...this.excluded],
      };
      this.post({ type: 'init', config });
      await readyPromise;
    })().catch((error: unknown) => {
      this.teardown();
      this.recordCrash();
      throw error;
    });
    return this.ready;
  }

  private post(message: ToWorker): void {
    this.worker?.postMessage(message);
  }

  private onWorkerMessage(message: FromWorker): void {
    const id = message.type === 'detected' || message.type === 'rendered' ? message.id : 'requestId' in message ? message.requestId : null;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(message);
  }

  private onCrash(reason: string): void {
    log.warn('Inference worker crashed:', reason);
    // A crash while initialising a backend (typically a GPU driver problem)
    // excludes that backend, so the restart falls back instead of looping.
    if (this.attempting) {
      this.excluded.add(this.attempting);
      this.attempting = null;
    }
    this.recordCrash();
    this.teardown();
  }

  private recordCrash(): void {
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (this.crashes.length >= MAX_CRASHES) {
      this.cooldownUntil = now + COOLDOWN_MS;
      this.crashes = [];
    }
  }

  /** Terminates the worker and fails in-flight requests (they fall back per policy). */
  private teardown(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ type: 'detected', id, ok: false, error: 'engine-unavailable', message: 'engine restarted' });
    }
    this.pending.clear();
  }

  private request<T extends FromWorker>(id: string, message: ToWorker, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.post({ type: 'cancel', id });
        this.consecutiveTimeouts++;
        // Two back-to-back timeouts means the worker is wedged (e.g. lost GPU context): restart it.
        if (this.consecutiveTimeouts >= 2) {
          this.consecutiveTimeouts = 0;
          this.recordCrash();
          this.teardown();
        }
        resolve({ type: 'detected', id, ok: false, error: 'engine-unavailable', message: 'timeout' } as T);
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (m: FromWorker) => void, timer });
      this.post(message);
    });
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0) {
        log.info('Unloading idle inference engine');
        this.teardown();
      } else this.touch();
    }, this.unloadAfterMs);
  }

  async detect(request: DetectRequest): Promise<DetectResponse> {
    this.touch();
    let blob: Blob;
    try {
      blob = await loadSource(request.source, request.initiator);
      await this.ensureWorker();
    } catch (error) {
      const code = error instanceof MediaError ? error.code : 'engine-unavailable';
      return { id: request.id, ok: false, error: code, message: error instanceof Error ? error.message : undefined };
    }
    const retainForRender = request.signals.includes('faces') || request.signals.includes('people');
    const message = await this.request<Extract<FromWorker, { type: 'detected' }>>(
      request.id,
      { type: 'detect', job: { id: request.id, key: request.key, blob, signals: request.signals, priority: request.priority, retainForRender } },
      DETECT_TIMEOUT_MS,
    );
    if (message.ok) {
      this.consecutiveTimeouts = 0;
      return { id: request.id, ok: true, signals: message.signals };
    }
    return { id: request.id, ok: false, error: message.error, ...(message.message ? { message: message.message } : {}) };
  }

  async render(request: RenderRequest): Promise<RenderResponse> {
    this.touch();
    try {
      await this.ensureWorker();
      // Try the retained decode first; re-fetch only if the worker no longer has it.
      let message = await this.request<Extract<FromWorker, { type: 'rendered' }>>(
        request.id,
        { type: 'render', job: { id: request.id, key: request.key, regions: request.regions, style: request.style } },
        DETECT_TIMEOUT_MS,
      );
      if (!message.ok) {
        const blob = await loadSource(request.source, request.initiator);
        message = await this.request(
          request.id,
          { type: 'render', job: { id: request.id, key: request.key, blob, regions: request.regions, style: request.style } },
          DETECT_TIMEOUT_MS,
        );
      }
      return message.ok ? { id: request.id, ok: true, dataUrl: message.dataUrl } : { id: request.id, ok: false, error: message.error };
    } catch (error) {
      return { id: request.id, ok: false, error: error instanceof Error ? error.message : 'render failed' };
    }
  }

  cancel(id: string): void {
    this.post({ type: 'cancel', id });
  }

  async preload(signals: SignalKind[]): Promise<void> {
    try {
      await this.ensureWorker();
      this.touch();
      this.post({ type: 'preload', signals });
    } catch {
      // Preloading is best-effort.
    }
  }

  async status(): Promise<HostStatus> {
    const base: HostStatus = {
      state: 'idle',
      backend: null,
      models: [],
      queue: 0,
      processed: 0,
      avgMs: 0,
      p95Ms: 0,
      cacheHitRate: 0,
      detail: '',
      running: false,
    };
    if (!this.worker || !this.ready) return base;
    const requestId = `status-${++this.requestSeq}`;
    const message = await this.request<FromWorker>(requestId, { type: 'status', requestId }, 3000);
    if (message.type !== 'status') return { ...base, running: true, state: 'loading' };
    return { ...message.status, detail: this.backendInfo.detail, running: true };
  }

  /**
   * Benchmarks each backend in its own short-lived worker, so a backend that
   * hangs or crashes (GPU drivers do) cannot take the others down with it.
   */
  async benchmark(backends: HardwareBackend[], iterations = 8, perBackendTimeoutMs = 45_000): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    for (const backend of backends) results.push(await this.benchmarkOne(backend, iterations, perBackendTimeoutMs));
    return results;
  }

  private async benchmarkOne(backend: HardwareBackend, iterations: number, timeoutMs: number): Promise<BenchmarkResult> {
    const worker = this.spawn(this.options.workerUrl);
    try {
      const requestId = `bench-${++this.requestSeq}`;
      return await new Promise<BenchmarkResult>((resolve) => {
        const timer = setTimeout(() => resolve({ backend, ok: false, error: 'timed out' }), timeoutMs);
        worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
          if (event.data.type === 'benchmark' && event.data.requestId === requestId) {
            clearTimeout(timer);
            resolve(event.data.results[0] ?? { backend, ok: false, error: 'no result' });
          }
        });
        worker.addEventListener('error', (event) => {
          event.preventDefault();
          clearTimeout(timer);
          resolve({ backend, ok: false, error: `crashed: ${event.message || 'worker error'}` });
        });
        const config: WorkerConfig = {
          modelBaseUrl: this.options.modelBaseUrl,
          wasmBaseUrl: this.options.wasmBaseUrl,
          backend: 'auto',
          testModel: this.options.testModel,
          animatedFrames: 1,
        };
        worker.postMessage({ type: 'benchmark', requestId, config, backends: [backend], iterations } satisfies ToWorker);
      });
    } finally {
      worker.terminate();
    }
  }

  /** Applies new preferences (e.g. backend change) by restarting on next use. */
  reset(): void {
    this.teardown();
  }
}
