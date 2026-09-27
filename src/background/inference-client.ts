/**
 * InferenceClient — how the background reaches the inference host.
 *
 *   Chrome:  service worker → offscreen document → worker
 *   Firefox: event page → worker (the event page has a DOM)
 */
import { capabilities, ext } from '../browser/api';
import type { HardwareBackend } from '../ml/backend';
import { type HostStatus, InferenceHost } from '../ml/host/inference-host';
import type { BenchmarkResult } from '../ml/worker/protocol';
import type { DetectRequest, DetectResponse, RenderRequest, RenderResponse, SignalKind } from '../ml/types';
import type { HostPreferences, OffscreenRequest } from '../shared/messages';
import { createLogger } from '../shared/logger';

const log = createLogger('inference');

export interface InferenceClient {
  configure(preferences: HostPreferences): Promise<void>;
  detect(request: DetectRequest): Promise<DetectResponse>;
  render(request: RenderRequest): Promise<RenderResponse>;
  cancel(id: string): void;
  preload(signals: SignalKind[]): void;
  status(): Promise<HostStatus>;
  benchmark(backends: HardwareBackend[]): Promise<BenchmarkResult[]>;
  reset(): Promise<void>;
}

const OFFSCREEN_PATH = 'offscreen.html';

class OffscreenClient implements InferenceClient {
  private creating: Promise<void> | null = null;
  private preferences: HostPreferences = { backend: 'auto', unloadAfterMin: 10 };
  private configured = false;

  private async hasDocument(): Promise<boolean> {
    const runtime = ext().runtime as typeof chrome.runtime;
    if (typeof runtime.getContexts === 'function') {
      const contexts = await runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
        documentUrls: [runtime.getURL(OFFSCREEN_PATH)],
      });
      return contexts.length > 0;
    }
    return false;
  }

  private async ensureDocument(): Promise<void> {
    if (await this.hasDocument()) {
      if (!this.configured) await this.sendConfigure();
      return;
    }
    if (!this.creating) {
      this.creating = (async () => {
        try {
          await chrome.offscreen.createDocument({
            url: OFFSCREEN_PATH,
            reasons: ['WORKERS' as chrome.offscreen.Reason],
            justification: 'Runs on-device image classification in a web worker. No data leaves the device.',
          });
        } catch (error) {
          // A concurrent creation from another wake-up is fine.
          if (!String(error).includes('single offscreen')) throw error;
        }
        await this.sendConfigure();
      })().finally(() => {
        this.creating = null;
      });
    }
    await this.creating;
  }

  private async sendConfigure(): Promise<void> {
    await this.send({ target: 'offscreen', type: 'configure', preferences: this.preferences });
    this.configured = true;
  }

  /**
   * The offscreen document registers its listener when its script runs,
   * which can be a few milliseconds after createDocument() resolves. Retry
   * the "no receiver" error briefly instead of failing the request.
   */
  private async send<T>(message: OffscreenRequest, attempt = 0): Promise<T> {
    try {
      return (await ext().runtime.sendMessage(message)) as T;
    } catch (error) {
      if (
        attempt < 20 &&
        /Receiving end does not exist|Could not establish connection/i.test(String(error))
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        return this.send<T>(message, attempt + 1);
      }
      throw error;
    }
  }

  async configure(preferences: HostPreferences): Promise<void> {
    this.preferences = preferences;
    this.configured = false;
    if (await this.hasDocument()) await this.sendConfigure();
  }

  async detect(request: DetectRequest): Promise<DetectResponse> {
    try {
      await this.ensureDocument();
      const response = await this.send<DetectResponse | undefined>({
        target: 'offscreen',
        type: 'detect',
        request,
      });
      return response ?? { id: request.id, ok: false, error: 'engine-unavailable', message: 'no response' };
    } catch (error) {
      log.warn('Offscreen detect failed', error);
      return { id: request.id, ok: false, error: 'engine-unavailable', message: String(error) };
    }
  }

  async render(request: RenderRequest): Promise<RenderResponse> {
    try {
      await this.ensureDocument();
      const response = await this.send<RenderResponse | undefined>({
        target: 'offscreen',
        type: 'render',
        request,
      });
      return response ?? { id: request.id, ok: false, error: 'no response' };
    } catch (error) {
      return { id: request.id, ok: false, error: String(error) };
    }
  }

  cancel(id: string): void {
    void this.hasDocument().then((exists) => {
      if (exists) void this.send({ target: 'offscreen', type: 'cancel', id }).catch(() => undefined);
    });
  }

  preload(signals: SignalKind[]): void {
    void this.ensureDocument()
      .then(() => this.send({ target: 'offscreen', type: 'preload', signals }))
      .catch(() => undefined);
  }

  async status(): Promise<HostStatus> {
    if (!(await this.hasDocument())) return idleStatus();
    return (await this.send<HostStatus | undefined>({ target: 'offscreen', type: 'status' })) ?? idleStatus();
  }

  async benchmark(backends: HardwareBackend[]): Promise<BenchmarkResult[]> {
    await this.ensureDocument();
    return this.send<BenchmarkResult[]>({ target: 'offscreen', type: 'benchmark', backends });
  }

  async reset(): Promise<void> {
    if (await this.hasDocument()) await this.send({ target: 'offscreen', type: 'reset' });
  }
}

class DirectClient implements InferenceClient {
  private preferences: HostPreferences = { backend: 'auto', unloadAfterMin: 10 };
  private readonly host = new InferenceHost({
    workerUrl: ext().runtime.getURL('engine-worker.js'),
    modelBaseUrl: ext().runtime.getURL('models/'),
    wasmBaseUrl: ext().runtime.getURL('wasm/'),
    testModel: __TEST_MODEL__,
    preferences: async () => this.preferences,
  });

  async configure(preferences: HostPreferences): Promise<void> {
    const changed = JSON.stringify(preferences) !== JSON.stringify(this.preferences);
    this.preferences = preferences;
    if (changed) this.host.reset();
  }
  detect(request: DetectRequest): Promise<DetectResponse> {
    return this.host.detect(request);
  }
  render(request: RenderRequest): Promise<RenderResponse> {
    return this.host.render(request);
  }
  cancel(id: string): void {
    this.host.cancel(id);
  }
  preload(signals: SignalKind[]): void {
    void this.host.preload(signals);
  }
  status(): Promise<HostStatus> {
    return this.host.status();
  }
  benchmark(backends: HardwareBackend[]): Promise<BenchmarkResult[]> {
    return this.host.benchmark(backends);
  }
  async reset(): Promise<void> {
    this.host.reset();
  }
}

function idleStatus(): HostStatus {
  return {
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
}

export function createInferenceClient(): InferenceClient {
  // Build-time branch: the Firefox bundle contains no offscreen code at all.
  if (__BROWSER__ === 'chrome') return capabilities.offscreen ? new OffscreenClient() : new DirectClient();
  return new DirectClient();
}
