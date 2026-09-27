/**
 * Chrome offscreen document: hosts the inference worker (service workers
 * cannot create dedicated workers or use WebGL). Only `chrome.runtime` is
 * available here, so preferences arrive from the background via `configure`.
 */
import { ext } from '../browser/api';
import { InferenceHost } from '../ml/host/inference-host';
import type { HostPreferences, OffscreenRequest } from '../shared/messages';

let preferences: HostPreferences = { backend: 'auto', unloadAfterMin: 10 };

const host = new InferenceHost({
  workerUrl: ext().runtime.getURL('engine-worker.js'),
  modelBaseUrl: ext().runtime.getURL('models/'),
  wasmBaseUrl: ext().runtime.getURL('wasm/'),
  testModel: __TEST_MODEL__,
  preferences: async () => preferences,
});

function isOffscreenRequest(message: unknown): message is OffscreenRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { target?: unknown }).target === 'offscreen' &&
    typeof (message as { type?: unknown }).type === 'string'
  );
}

ext().runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isOffscreenRequest(message)) return false;
  // Accept only the extension's own background context — never a content script.
  if (sender.id !== ext().runtime.id || sender.tab) return false;

  const respond = (promise: Promise<unknown>) => {
    promise.then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  };

  switch (message.type) {
    case 'configure': {
      const changed = JSON.stringify(preferences) !== JSON.stringify(message.preferences);
      preferences = message.preferences;
      if (changed) host.reset();
      sendResponse({ ok: true });
      return false;
    }
    case 'detect':
      return respond(host.detect(message.request));
    case 'render':
      return respond(host.render(message.request));
    case 'cancel':
      host.cancel(message.id);
      return false;
    case 'preload':
      void host.preload(message.signals);
      return false;
    case 'status':
      return respond(host.status());
    case 'benchmark':
      return respond(host.benchmark(message.backends));
    case 'reset':
      host.reset();
      sendResponse({ ok: true });
      return false;
  }
  return false;
});
