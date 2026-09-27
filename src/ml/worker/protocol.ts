/** Messages between the inference host (offscreen document / Firefox event page) and the worker. */
import type { HardwareBackend } from '../backend';
import type { EngineStatus, Priority, Region, RenderStyle, SignalKind, Signals } from '../types';

export interface WorkerConfig {
  modelBaseUrl: string;
  wasmBaseUrl: string;
  backend: HardwareBackend | 'auto';
  profileBest?: HardwareBackend;
  testModel: boolean;
  /** Sample up to N frames of animated images. */
  animatedFrames: number;
  /** Backends that crashed this worker's predecessors; never retried this session. */
  exclude?: HardwareBackend[];
}

export interface DetectJob {
  id: string;
  key: string;
  blob: Blob;
  signals: SignalKind[];
  priority: Priority;
  /** Keep the decoded image briefly so a follow-up render request avoids re-decoding. */
  retainForRender: boolean;
}

export interface RenderJob {
  id: string;
  key: string;
  blob?: Blob;
  regions: Region[];
  style: RenderStyle;
}

export interface BenchmarkResult {
  backend: HardwareBackend;
  ok: boolean;
  detail?: string;
  error?: string;
  initMs?: number;
  loadMs?: number;
  firstMs?: number;
  medianMs?: number;
  batch4PerImageMs?: number;
}

export type ToWorker =
  | { type: 'init'; config: WorkerConfig }
  | { type: 'detect'; job: DetectJob }
  | { type: 'render'; job: RenderJob }
  | { type: 'cancel'; id: string }
  | { type: 'preload'; signals: SignalKind[] }
  | { type: 'status'; requestId: string }
  | { type: 'benchmark'; requestId: string; config: WorkerConfig; backends: HardwareBackend[]; iterations: number };

export type FromWorker =
  | { type: 'ready'; backend: string; detail: string; initMs: number }
  | { type: 'trying'; backend: string }
  | { type: 'fatal'; message: string }
  | { type: 'detected'; id: string; ok: true; signals: Signals }
  | { type: 'detected'; id: string; ok: false; error: 'decode-failed' | 'engine-unavailable' | 'cancelled'; message?: string }
  | { type: 'rendered'; id: string; ok: true; dataUrl: string }
  | { type: 'rendered'; id: string; ok: false; error: string }
  | { type: 'status'; requestId: string; status: EngineStatus }
  | { type: 'benchmark'; requestId: string; results: BenchmarkResult[] };
