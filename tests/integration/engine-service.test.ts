import { describe, expect, it, vi } from 'vitest';
import { EngineService, mergeSignals } from '../../src/background/engine-service';
import type { InferenceClient } from '../../src/background/inference-client';
import type { DetectRequest, DetectResponse, Signals } from '../../src/ml/types';

function fakeClient(respond: (req: DetectRequest) => Partial<Signals>) {
  const calls: DetectRequest[] = [];
  const client: InferenceClient = {
    configure: vi.fn(async () => undefined),
    detect: vi.fn(async (req: DetectRequest): Promise<DetectResponse> => {
      calls.push(req);
      await new Promise((r) => setTimeout(r, 5));
      return { id: req.id, ok: true, signals: { width: 10, height: 10, backend: 'test', models: ['m'], ms: 3, ...respond(req) } };
    }),
    render: vi.fn(),
    cancel: vi.fn(),
    preload: vi.fn(),
    status: vi.fn(),
    benchmark: vi.fn(),
    reset: vi.fn(async () => undefined),
  };
  return { client, calls };
}

const request = (id: string, key: string, signals: DetectRequest['signals']): DetectRequest => ({
  id,
  key,
  source: { kind: 'url', url: `https://a.com/${key}.png` },
  signals,
  priority: 0,
});

const classifier = { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0 };

describe('EngineService', () => {
  it('caches results by media key', async () => {
    const { client, calls } = fakeClient(() => ({ classifier }));
    const service = new EngineService(client);
    await service.detect(request('1', 'k', ['classifier']));
    const second = await service.detect(request('2', 'k', ['classifier']));
    expect(calls).toHaveLength(1);
    expect(second).toMatchObject({ id: '2', ok: true, cached: true });
  });

  it('de-duplicates concurrent identical requests across tabs', async () => {
    const { client, calls } = fakeClient(() => ({ classifier }));
    const service = new EngineService(client);
    const results = await Promise.all([1, 2, 3].map((n) => service.detect(request(String(n), 'same', ['classifier']))));
    expect(calls).toHaveLength(1);
    expect(results.map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('only runs missing detectors for partially cached media', async () => {
    const { client, calls } = fakeClient((req) => (req.signals.includes('faces') ? { faces: [] } : { classifier }));
    const service = new EngineService(client);
    await service.detect(request('1', 'k', ['classifier']));
    const both = await service.detect(request('2', 'k', ['classifier', 'faces']));
    expect(calls[1]!.signals).toEqual(['faces']);
    expect(both.ok && both.signals.classifier && both.signals.faces).toBeTruthy();
  });

  it('does not cache failures and reports hit rate', async () => {
    let fail = true;
    const client = fakeClient(() => ({ classifier })).client;
    client.detect = vi.fn(async (req) => (fail ? { id: req.id, ok: false as const, error: 'fetch-failed' as const } : { id: req.id, ok: true as const, signals: { classifier, width: 1, height: 1, backend: 't', models: [], ms: 1 } }));
    client.status = vi.fn(async () => ({ state: 'ready', backend: 'wasm', models: [], queue: 0, processed: 0, avgMs: 0, p95Ms: 0, cacheHitRate: 0, detail: '', running: true }) as never);
    const service = new EngineService(client);
    expect((await service.detect(request('1', 'k', ['classifier']))).ok).toBe(false);
    fail = false;
    expect((await service.detect(request('2', 'k', ['classifier']))).ok).toBe(true);
    await service.detect(request('3', 'k', ['classifier']));
    expect((await service.status()).cacheHitRate).toBeCloseTo(1 / 3);
  });

  it('merges signal sets without losing earlier detectors', () => {
    const base: Signals = { classifier, width: 1, height: 1, backend: 'a', models: ['x'], ms: 1 };
    const merged = mergeSignals(base, { faces: [], width: 1, height: 1, backend: 'a', models: ['y'], ms: 2 });
    expect(merged.classifier).toEqual(classifier);
    expect(merged.faces).toEqual([]);
    expect(merged.models).toEqual(['x', 'y']);
  });
});
