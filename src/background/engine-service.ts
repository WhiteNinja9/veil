/**
 * EngineService — the background's front door to inference.
 *
 * Adds, on top of the InferenceClient:
 *   - a shared in-memory result cache (signals by media key), bounded in
 *     size and age. It is never persisted: even hashed media keys would be
 *     a record of browsing (docs/PRIVACY.md).
 *   - de-duplication of identical in-flight requests across tabs/frames
 *   - incremental signals: a request for faces on media already classified
 *     only runs the face detector
 *   - hit-rate accounting for diagnostics
 */
import type { HardwareBackend } from '../ml/backend';
import type {
  DetectRequest,
  DetectResponse,
  RenderRequest,
  RenderResponse,
  SignalKind,
  Signals,
} from '../ml/types';
import type { HostPreferences } from '../shared/messages';
import { LruCache } from '../shared/lru';
import type { InferenceClient } from './inference-client';

export const CACHE_MAX_ENTRIES = 5000;
export const CACHE_TTL_MS = 30 * 60 * 1000;

export class EngineService {
  private readonly cache = new LruCache<string, Signals>({
    maxEntries: CACHE_MAX_ENTRIES,
    ttlMs: CACHE_TTL_MS,
  });
  private readonly inflight = new Map<string, Promise<DetectResponse>>();
  private lookups = 0;
  private hits = 0;

  constructor(private readonly client: InferenceClient) {}

  configure(preferences: HostPreferences): Promise<void> {
    return this.client.configure(preferences);
  }

  /** Cached signals covering `signals`, or null. Never runs inference. */
  lookup(key: string, signals: readonly SignalKind[]): Signals | null {
    const cached = this.cache.get(key);
    if (!cached || signals.some((kind) => cached[kind] === undefined)) return null;
    // A hit replaces a detect call, so it counts as one; a miss is followed by one.
    this.lookups++;
    this.hits++;
    return cached;
  }

  async detect(request: DetectRequest): Promise<DetectResponse> {
    this.lookups++;
    const cached = this.cache.get(request.key);
    const missing = request.signals.filter((kind) => cached?.[kind] === undefined);
    if (cached && !missing.length) {
      this.hits++;
      return { id: request.id, ok: true, signals: cached, cached: true };
    }
    const signals = missing.length ? missing : request.signals;
    const dedupeKey = `${request.key}|${[...signals].sort().join(',')}`;
    let pending = this.inflight.get(dedupeKey);
    if (!pending) {
      pending = this.client
        .detect({ ...request, signals })
        .then((response) => {
          if (response.ok)
            this.cache.set(request.key, mergeSignals(this.cache.peek(request.key), response.signals));
          return response;
        })
        .finally(() => this.inflight.delete(dedupeKey));
      this.inflight.set(dedupeKey, pending);
    }
    const response = await pending;
    if (!response.ok) return { ...response, id: request.id };
    return { id: request.id, ok: true, signals: mergeSignals(cached, response.signals) };
  }

  render(request: RenderRequest): Promise<RenderResponse> {
    return this.client.render(request);
  }

  cancel(id: string): void {
    this.client.cancel(id);
  }

  preload(signals: SignalKind[]): void {
    this.client.preload(signals);
  }

  async status() {
    const status = await this.client.status();
    return {
      ...status,
      cacheHitRate: this.lookups ? this.hits / this.lookups : 0,
      cacheEntries: this.cache.size,
    };
  }

  benchmark(backends: HardwareBackend[]) {
    return this.client.benchmark(backends);
  }

  async reset(): Promise<void> {
    this.cache.clear();
    await this.client.reset();
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function mergeSignals(base: Signals | undefined, next: Signals): Signals {
  if (!base) return next;
  return {
    ...base,
    ...next,
    classifier: next.classifier ?? base.classifier,
    faces: next.faces ?? base.faces,
    people: next.people ?? base.people,
    models: [...new Set([...base.models, ...next.models])],
  };
}
