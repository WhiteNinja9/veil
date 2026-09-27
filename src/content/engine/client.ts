/**
 * EngineClient — the content script's connection to the background.
 *
 * A single long-lived port per frame carries detection traffic. The port is
 * opened lazily, re-opened after the service worker restarts, and in-flight
 * requests are replayed on reconnect. When the extension itself is reloaded
 * the context is invalidated; we report that so the page can be released.
 */
import { ext, isContextInvalidated } from '../../browser/api';
import type {
  DetectRequest,
  DetectResponse,
  RenderRequest,
  RenderResponse,
  SignalKind,
} from '../../ml/types';
import { type FrameStats, PORT_NAME, type PortInbound, type PortOutbound } from '../../shared/messages';

export const REQUEST_TIMEOUT_MS = 25_000;
/** A probe is answered from memory; if it takes longer, analysing is the faster path. */
export const PROBE_TIMEOUT_MS = 1_500;

type Pending =
  | {
      kind: 'detect';
      request: DetectRequest;
      resolve: (r: DetectResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | {
      kind: 'render';
      request: RenderRequest;
      resolve: (r: RenderResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | {
      kind: 'probe';
      resolve: (r: DetectResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    };

export class EngineClient {
  private port: chrome.runtime.Port | null = null;
  private readonly pending = new Map<string, Pending>();
  private invalidated = false;
  private reconnectAttempts = 0;

  constructor(private readonly onInvalidated: () => void) {}

  private connect(): chrome.runtime.Port | null {
    if (this.port) return this.port;
    if (this.invalidated || isContextInvalidated()) {
      this.markInvalidated();
      return null;
    }
    try {
      const port = ext().runtime.connect({ name: PORT_NAME });
      port.onMessage.addListener((message: PortOutbound) => this.onMessage(message));
      port.onDisconnect.addListener(() => {
        this.port = null;
        if (isContextInvalidated()) {
          this.markInvalidated();
          return;
        }
        // Service worker restarted: replay what is still pending.
        if (this.pending.size && this.reconnectAttempts < 5) {
          this.reconnectAttempts++;
          setTimeout(() => this.replay(), 50 * this.reconnectAttempts);
        }
      });
      this.port = port;
      return port;
    } catch {
      this.markInvalidated();
      return null;
    }
  }

  private markInvalidated(): void {
    if (this.invalidated) return;
    this.invalidated = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      if (pending.kind !== 'render')
        pending.resolve({ id, ok: false, error: 'engine-unavailable', message: 'extension reloaded' });
      else pending.resolve({ id, ok: false, error: 'extension reloaded' });
    }
    this.pending.clear();
    this.onInvalidated();
  }

  private replay(): void {
    const port = this.connect();
    if (!port) return;
    for (const [id, pending] of this.pending) {
      if (pending.kind === 'probe') {
        // Not worth replaying: the caller falls back to a full analysis.
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.resolve({ id, ok: false, error: 'not-cached' });
      } else if (pending.kind === 'detect') this.post({ type: 'detect', request: pending.request });
      else this.post({ type: 'render', request: pending.request });
    }
  }

  private post(message: PortInbound): boolean {
    const port = this.connect();
    if (!port) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      this.port = null;
      return false;
    }
  }

  private onMessage(message: PortOutbound): void {
    this.reconnectAttempts = 0;
    const id = message.response?.id;
    if (typeof id !== 'string') return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (message.type === 'detected' && pending.kind !== 'render') pending.resolve(message.response);
    else if (message.type === 'rendered' && pending.kind === 'render') pending.resolve(message.response);
  }

  detect(request: DetectRequest): Promise<DetectResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        this.post({ type: 'cancel', id: request.id });
        resolve({ id: request.id, ok: false, error: 'timeout' });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(request.id, { kind: 'detect', request, resolve, timer });
      if (!this.post({ type: 'detect', request })) {
        clearTimeout(timer);
        this.pending.delete(request.id);
        resolve({ id: request.id, ok: false, error: 'engine-unavailable' });
      }
    });
  }

  /** Asks the background for already-computed signals, without analysing anything. */
  probe(id: string, key: string, signals: SignalKind[]): Promise<DetectResponse> {
    return new Promise((resolve) => {
      const miss = () => resolve({ id, ok: false, error: 'not-cached' });
      const timer = setTimeout(() => {
        this.pending.delete(id);
        miss();
      }, PROBE_TIMEOUT_MS);
      this.pending.set(id, { kind: 'probe', resolve, timer });
      if (!this.post({ type: 'probe', id, key, signals })) {
        clearTimeout(timer);
        this.pending.delete(id);
        miss();
      }
    });
  }

  render(request: RenderRequest): Promise<RenderResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        resolve({ id: request.id, ok: false, error: 'timeout' });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(request.id, { kind: 'render', request, resolve, timer });
      if (!this.post({ type: 'render', request })) {
        clearTimeout(timer);
        this.pending.delete(request.id);
        resolve({ id: request.id, ok: false, error: 'engine unavailable' });
      }
    });
  }

  cancel(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    this.post({ type: 'cancel', id });
  }

  /** Asks the background to warm the models this page will need. */
  hello(signals: SignalKind[]): void {
    this.post({ type: 'hello', signals });
  }

  sendStats(stats: FrameStats): void {
    this.post({ type: 'stats', stats });
  }

  get isInvalidated(): boolean {
    return this.invalidated;
  }

  disconnect(): void {
    try {
      this.port?.disconnect();
    } catch {
      // already gone
    }
    this.port = null;
  }
}
