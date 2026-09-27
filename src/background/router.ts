/**
 * Message router: the background's only inbound surface.
 *
 * - Content scripts talk over the `veil-engine` port. Every message is
 *   schema-validated; the request initiator is taken from the browser's
 *   sender record, never from the page; in-flight work is capped per frame.
 * - Extension pages (popup, options, onboarding, interstitial) use one-shot
 *   runtime messages. Privileged requests are rejected from content scripts.
 */
import { ext } from '../browser/api';
import type { DetectResponse, RenderResponse } from '../ml/types';
import { check } from '../security/validate';
import { createLogger } from '../shared/logger';
import {
  PORT_NAME,
  portInbound,
  type PortOutbound,
  runtimeRequest,
  type RuntimeRequest,
} from '../shared/messages';
import { hostnameOf } from '../shared/url';
import type { EngineService } from './engine-service';
import type { TabStatsStore } from './tab-stats';

const log = createLogger('router');
const MAX_INFLIGHT_PER_PORT = 64;

export interface RuntimeHandlers {
  handle(request: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<unknown>;
}

/** Messages from our own extension pages (popup, options, onboarding, interstitial). */
export function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== ext().runtime.id) return false;
  const origin = new URL(ext().runtime.getURL('/')).origin;
  const url = sender.url ?? '';
  return url.startsWith(origin);
}

/** Content scripts: our extension id, attached to a tab, running on a web page. */
function isContentScript(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === ext().runtime.id && Boolean(sender.tab) && !isExtensionPage(sender);
}

const CONTENT_ALLOWED: ReadonlySet<RuntimeRequest['type']> = new Set(['frame/top']);

export function registerRouter(engine: EngineService, stats: TabStatsStore, handlers: RuntimeHandlers): void {
  ext().runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME || !port.sender || !isContentScript(port.sender)) {
      port.disconnect();
      return;
    }
    const sender = port.sender;
    const tabId = sender.tab?.id ?? -1;
    const frameId = sender.frameId ?? 0;
    const initiator = sender.url;
    let inflight = 0;
    let open = true;
    const owned = new Set<string>();

    const reply = (message: PortOutbound) => {
      if (!open) return;
      try {
        port.postMessage(message);
      } catch {
        open = false;
      }
    };

    port.onDisconnect.addListener(() => {
      open = false;
      for (const id of owned) engine.cancel(id);
      if (tabId >= 0) stats.removeFrame(tabId, frameId);
    });

    port.onMessage.addListener((raw: unknown) => {
      const parsed = check(portInbound, raw);
      if (!parsed.ok) {
        log.warn('Rejected malformed port message', parsed.error);
        return;
      }
      const message = parsed.value;
      switch (message.type) {
        case 'hello':
          engine.preload(message.signals);
          return;
        case 'stats':
          if (tabId >= 0) stats.update(tabId, frameId, message.stats);
          return;
        case 'cancel':
          if (owned.delete(message.id)) engine.cancel(message.id);
          return;
        case 'probe': {
          const signals = engine.lookup(message.key, message.signals);
          reply({
            type: 'detected',
            response: signals
              ? { id: message.id, ok: true, signals, cached: true }
              : { id: message.id, ok: false, error: 'not-cached' },
          });
          return;
        }
        case 'detect': {
          const request = { ...message.request, initiator };
          if (inflight >= MAX_INFLIGHT_PER_PORT) {
            reply({
              type: 'detected',
              response: { id: request.id, ok: false, error: 'invalid', message: 'too many requests' },
            });
            return;
          }
          inflight++;
          owned.add(request.id);
          engine
            .detect(request)
            .catch((): DetectResponse => ({ id: request.id, ok: false, error: 'engine-unavailable' }))
            .then((response) => reply({ type: 'detected', response }))
            .finally(() => {
              inflight--;
              owned.delete(request.id);
            });
          return;
        }
        case 'render': {
          const request = { ...message.request, initiator };
          engine
            .render(request)
            .catch((): RenderResponse => ({ id: request.id, ok: false, error: 'render failed' }))
            .then((response) => reply({ type: 'rendered', response }));
          return;
        }
      }
    });
  });

  ext().runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    // Offscreen-bound traffic is not for us.
    if (typeof raw === 'object' && raw !== null && (raw as { target?: unknown }).target === 'offscreen')
      return false;
    const parsed = check(runtimeRequest, raw);
    if (!parsed.ok) return false;
    const request = parsed.value;
    if (!isExtensionPage(sender) && !(isContentScript(sender) && CONTENT_ALLOWED.has(request.type))) {
      log.warn('Rejected privileged message from', sender.url ? hostnameOf(sender.url) : 'unknown');
      return false;
    }
    handlers
      .handle(request, sender)
      .then(sendResponse, (error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  });
}
