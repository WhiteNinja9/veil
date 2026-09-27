/**
 * Minimal in-memory WebExtension API for unit/integration tests: storage
 * areas with change events, runtime identity, and no-op stubs elsewhere.
 */
import { __setExtensionApi } from '../../src/browser/api';

type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

function area(name: string, listeners: Set<Listener>) {
  const data = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  return {
    data,
    async get(keys?: string | string[] | null) {
      if (keys === null || keys === undefined) return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, clone(data.get(k))]));
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data.get(k), newValue: clone(v) };
        data.set(k, clone(v));
      }
      for (const l of listeners) l(changes, name);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

export function installChromeMock(options: { managed?: Record<string, unknown> } = {}) {
  const listeners = new Set<Listener>();
  const local = area('local', listeners);
  const session = area('session', listeners);
  const managed = {
    async get() {
      return options.managed ?? {};
    },
  };
  const api = {
    runtime: { id: 'test-extension', getURL: (p: string) => `chrome-extension://test-extension/${p.replace(/^\//, '')}` },
    storage: {
      local,
      session,
      managed,
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
    i18n: { getUILanguage: () => 'en-US' },
  };
  __setExtensionApi(api);
  return api;
}
