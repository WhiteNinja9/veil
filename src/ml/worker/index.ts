/**
 * Inference worker entry point. Hosted by the offscreen document (Chrome)
 * or the background event page (Firefox). Receives messages only from its
 * host; every message is still shape-checked before use.
 */
import { benchmarkBackends, DetectionEngine, EngineJobError } from './engine';
import type { FromWorker, ToWorker, WorkerConfig } from './protocol';

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}
const self = globalThis as unknown as WorkerScope;

let engine: DetectionEngine | null = null;
let config: WorkerConfig | null = null;

const post = (message: FromWorker) => self.postMessage(message);

function isToWorker(value: unknown): value is ToWorker {
  return (
    typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
  );
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isToWorker(message)) return;
  void handle(message);
});

async function handle(message: ToWorker): Promise<void> {
  switch (message.type) {
    case 'init': {
      config = message.config;
      engine?.dispose();
      engine = new DetectionEngine(config, (backend) => post({ type: 'trying', backend }));
      try {
        const selection = await engine.init();
        post({ type: 'ready', backend: selection.name, detail: selection.detail, initMs: selection.initMs });
      } catch (error) {
        post({ type: 'fatal', message: error instanceof Error ? error.message : 'engine init failed' });
      }
      return;
    }
    case 'detect': {
      const { job } = message;
      if (!engine) {
        post({
          type: 'detected',
          id: job.id,
          ok: false,
          error: 'engine-unavailable',
          message: 'not initialised',
        });
        return;
      }
      try {
        const signals = await engine.detect(job);
        post({ type: 'detected', id: job.id, ok: true, signals });
      } catch (error) {
        const code = error instanceof EngineJobError ? error.code : 'engine-unavailable';
        post({
          type: 'detected',
          id: job.id,
          ok: false,
          error: code,
          message: error instanceof Error ? error.message : undefined,
        });
      }
      return;
    }
    case 'render': {
      const { job } = message;
      try {
        if (!engine) throw new Error('not initialised');
        post({ type: 'rendered', id: job.id, ok: true, dataUrl: await engine.render(job) });
      } catch (error) {
        post({
          type: 'rendered',
          id: job.id,
          ok: false,
          error: error instanceof Error ? error.message : 'render failed',
        });
      }
      return;
    }
    case 'cancel':
      engine?.cancel(message.id);
      return;
    case 'preload':
      await engine?.preload(message.signals).catch(() => undefined);
      return;
    case 'status':
      if (engine) post({ type: 'status', requestId: message.requestId, status: engine.status() });
      return;
    case 'benchmark': {
      // Benchmarks run in a dedicated worker with no engine: backend
      // switching is global to the TF.js instance.
      const results = await benchmarkBackends(message.config, message.backends, message.iterations);
      post({ type: 'benchmark', requestId: message.requestId, results });
      return;
    }
  }
}
