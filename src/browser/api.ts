/**
 * BrowserAdapter: the only module that touches the WebExtension global.
 *
 * Firefox exposes the promise-based `browser` namespace; Chromium exposes
 * `chrome` (promise-capable in MV3 for every API we use). Differences that
 * matter to Veil are surfaced as capability flags rather than scattered
 * `if (firefox)` checks.
 */

type ChromeApi = typeof chrome;

interface GlobalWithBrowser {
  browser?: ChromeApi;
  chrome?: ChromeApi;
}

function resolveApi(): ChromeApi {
  const g = globalThis as unknown as GlobalWithBrowser;
  const api = g.browser ?? g.chrome;
  if (!api) throw new Error('WebExtension API unavailable in this context');
  return api;
}

let cached: ChromeApi | null = null;

/** Lazily resolved so modules can be imported in tests before a mock is installed. */
export function ext(): ChromeApi {
  if (!cached) cached = resolveApi();
  return cached;
}

/** For tests only. */
export function __setExtensionApi(api: unknown): void {
  cached = api as ChromeApi;
}

export const capabilities = {
  get offscreen(): boolean {
    return typeof (ext() as Partial<ChromeApi>).offscreen?.createDocument === 'function';
  },
  get sessionStorage(): boolean {
    return Boolean((ext().storage as Partial<ChromeApi['storage']>).session);
  },
  get managedStorage(): boolean {
    return Boolean((ext().storage as Partial<ChromeApi['storage']>).managed);
  },
  get dnr(): boolean {
    return Boolean((ext() as Partial<ChromeApi>).declarativeNetRequest?.updateDynamicRules);
  },
  get contextMenus(): boolean {
    return Boolean((ext() as Partial<ChromeApi>).contextMenus?.create);
  },
  /** Background runs in a document (Firefox event page) rather than a service worker. */
  get backgroundHasDom(): boolean {
    return typeof document !== 'undefined' && typeof Worker !== 'undefined';
  },
};

export function extensionUrl(path: string): string {
  return ext().runtime.getURL(path);
}

/** True when this script's extension context was invalidated (extension reloaded/updated). */
export function isContextInvalidated(): boolean {
  try {
    return !ext().runtime?.id;
  } catch {
    return true;
  }
}

/**
 * Reads the shadow root of any element, including closed ones, using the
 * privileged helpers both engines expose to content scripts.
 */
export function openOrClosedShadowRoot(element: Element): ShadowRoot | null {
  const api = ext() as ChromeApi & {
    dom?: { openOrClosedShadowRoot?: (el: HTMLElement) => ShadowRoot | null };
  };
  try {
    if (api.dom?.openOrClosedShadowRoot && element instanceof HTMLElement) {
      return api.dom.openOrClosedShadowRoot(element);
    }
    const firefoxAccessor = (element as Element & { openOrClosedShadowRoot?: () => ShadowRoot | null })
      .openOrClosedShadowRoot;
    if (typeof firefoxAccessor === 'function') return firefoxAccessor.call(element);
  } catch {
    // fall through to the open shadow root
  }
  return element.shadowRoot;
}
