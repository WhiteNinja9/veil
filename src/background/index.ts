/**
 * Background (Chrome: MV3 service worker · Firefox: MV3 event page).
 *
 * Every event listener is registered synchronously at the top level so the
 * browser can wake this context for them. State is either derived from
 * storage on demand or kept in memory purely as a cache.
 */
import { ext, extensionUrl } from '../browser/api';
import { pageTranslator } from '../i18n/page';
import type { HardwareBackend } from '../ml/backend';
import type { BenchmarkResult } from '../ml/worker/protocol';
import { isUnlocked, readLock } from '../security/lock';
import { createLogger } from '../shared/logger';
import type { RuntimeRequest } from '../shared/messages';
import { hostnameOf } from '../shared/url';
import { createRuleId, findRule } from '../sites/rules';
import type { Settings } from '../storage/schema';
import { settingsStore, syncManagedPolicy } from '../storage/settings-store';
import { grantAllowance, pruneAllowances, SITE_RULES_ALARM, syncDynamicRules } from './dnr';
import { EngineService } from './engine-service';
import { createInferenceClient } from './inference-client';
import { registerRouter } from './router';
import { type TabStats, TabStatsStore } from './tab-stats';

const log = createLogger('background');
const PROFILE_KEY = 'veil.engine.profile';
const SHORTCUTS_KEY = 'veil.shortcuts';

interface EngineProfile {
  best: HardwareBackend;
  measuredAt: number;
  userAgent: string;
  results: unknown[];
}

const engine = new EngineService(createInferenceClient());
const tabStats = new TabStatsStore((tabId, stats) => void updateBadge(tabId, stats));

// ── Settings-driven configuration ─────────────────────────────────────────

async function readProfile(): Promise<EngineProfile | null> {
  const profile = (await ext().storage.local.get(PROFILE_KEY))[PROFILE_KEY] as EngineProfile | undefined;
  // A browser upgrade can change which backend is fastest: re-measure then.
  if (!profile || profile.userAgent !== navigator.userAgent) return null;
  return profile;
}

async function configureEngine(settings: Settings): Promise<void> {
  const profile = await readProfile();
  await engine.configure({
    backend: settings.performance.backend,
    ...(profile ? { profileBest: profile.best } : {}),
    unloadAfterMin: settings.performance.unloadAfterMin,
  });
}

let lastRulesKey = '';
let lastEngineKey = '';

async function applySettings(settings: Settings): Promise<void> {
  const rulesKey = JSON.stringify([settings.enabled, settings.sites, settings.strictBrowsing]);
  if (rulesKey !== lastRulesKey) {
    lastRulesKey = rulesKey;
    await syncDynamicRules(settings).catch((error: unknown) => log.error('DNR sync failed', error));
  }
  const engineKey = JSON.stringify(settings.performance);
  if (engineKey !== lastEngineKey) {
    lastEngineKey = engineKey;
    await configureEngine(settings).catch((error: unknown) => log.warn('Engine configure failed', error));
  }
  if (!settings.stats.badge) {
    await ext()
      .action.setBadgeText({ text: '' })
      .catch(() => undefined);
  }
}

settingsStore.subscribe((settings) => void applySettings(settings));

// ── Badge ─────────────────────────────────────────────────────────────────

async function updateBadge(tabId: number, stats: TabStats): Promise<void> {
  const settings = settingsStore.peek() ?? (await settingsStore.get());
  if (!settings.stats.badge) return;
  const text = stats.protected > 0 ? (stats.protected > 99 ? '99+' : String(stats.protected)) : '';
  await ext()
    .action.setBadgeBackgroundColor({ tabId, color: '#5b5fd6' })
    .catch(() => undefined);
  await ext()
    .action.setBadgeText({ tabId, text })
    .catch(() => undefined);
}

// ── Runtime requests (extension pages) ─────────────────────────────────────

async function handle(request: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (request.type) {
    case 'frame/top':
      return { host: sender.tab?.url ? hostnameOf(sender.tab.url) : '' };
    case 'tab/state': {
      await tabStats.restore();
      return { stats: tabStats.get(request.tabId) };
    }
    case 'engine/status':
      return engine.status();
    case 'engine/benchmark':
      return benchmark();
    case 'engine/reset':
      await engine.reset();
      return { ok: true };
    case 'site/proceed': {
      // The interstitial is web-accessible, so a page could open it with any
      // URL. Only a site the user actually set to "warn" can be continued to;
      // "block" rules can never be bypassed from the interstitial.
      const host = hostnameOf(request.url);
      if (!host) return { ok: false };
      const settings = await settingsStore.get();
      const rule = findRule(settings.sites, host, Date.now());
      if (rule?.mode !== 'warn') return { ok: false };
      await grantAllowance(host, Math.min(request.minutes, 60));
      return { ok: true };
    }
    case 'engine/clear-cache':
      engine.clearCache();
      return { ok: true };
    case 'open/options': {
      const hash = request.section ? `#${encodeURIComponent(request.section)}` : '';
      await ext().tabs.create({ url: extensionUrl(`options.html${hash}`) });
      return { ok: true };
    }
    case 'content/reinject':
      await injectIntoTab(request.tabId);
      return { ok: true };
  }
}

async function benchmark() {
  const candidates: HardwareBackend[] = ['webgpu', 'webgl', 'wasm'];
  const reply = (await engine
    .benchmark(candidates)
    .catch((error: unknown) => ({ ok: false, error: String(error) }))) as unknown;
  if (!Array.isArray(reply)) {
    log.warn('Benchmark failed', reply);
    return {
      results: [],
      best: null,
      error: (reply as { error?: string } | null)?.error ?? 'benchmark failed',
    };
  }
  const results = reply as BenchmarkResult[];
  const ok = results
    .filter((r) => r.ok && typeof r.medianMs === 'number')
    .sort((a, b) => a.medianMs! - b.medianMs!);
  const best = ok[0]?.backend;
  if (best) {
    const profile: EngineProfile = { best, measuredAt: Date.now(), userAgent: navigator.userAgent, results };
    await ext().storage.local.set({ [PROFILE_KEY]: profile });
    lastEngineKey = '';
    await applySettings(await settingsStore.get());
  }
  return { results, best: best ?? null };
}

registerRouter(engine, tabStats, { handle });

// ── Commands (keyboard shortcuts) ─────────────────────────────────────────

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await ext().tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Pausing a site weakens protection: respect the settings lock. */
async function lockPermits(scope: 'sites' | 'disable'): Promise<boolean> {
  const lock = await readLock();
  if (!lock || !lock.scope[scope]) return true;
  return isUnlocked();
}

ext().commands?.onCommand.addListener((command) => {
  void (async () => {
    const tab = await activeTab();
    if (!tab?.id) return;
    if (command === 'reveal-focused') {
      await ext()
        .tabs.sendMessage(tab.id, { type: 'command', command: 'reveal-focused' })
        .catch(() => undefined);
      return;
    }
    if (command === 'toggle-site') {
      const host = tab.url ? hostnameOf(tab.url) : '';
      if (!host || !(await lockPermits('sites'))) return;
      const settings = await settingsStore.get();
      const existing = settings.sites.find((rule) => rule.pattern === host && rule.mode === 'off');
      const sites = existing
        ? settings.sites.filter((rule) => rule !== existing)
        : [
            ...settings.sites.filter((rule) => rule.pattern !== host),
            {
              id: createRuleId(),
              pattern: host,
              mode: 'off' as const,
              createdAt: Date.now(),
              expiresAt: null,
            },
          ];
      await settingsStore.update({ sites });
    }
  })();
});

// ── Context menu ───────────────────────────────────────────────────────────

async function createMenus(settings: Settings): Promise<void> {
  const menus = ext().contextMenus;
  if (!menus?.create) return;
  const t = pageTranslator(settings.language);
  await menus.removeAll();
  menus.create({ id: 'veil-hide', title: t.t('menu.hide'), contexts: ['image', 'video'] });
  menus.create({ id: 'veil-show', title: t.t('menu.show'), contexts: ['image', 'video'] });
}

ext().contextMenus?.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.srcUrl) return;
  const action =
    info.menuItemId === 'veil-hide' ? 'protect' : info.menuItemId === 'veil-show' ? 'show' : null;
  if (!action) return;
  void ext()
    .tabs.sendMessage(
      tab.id,
      { type: 'context', action, srcUrl: info.srcUrl },
      { frameId: info.frameId ?? 0 },
    )
    .catch(() => undefined);
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

async function storeShortcuts(): Promise<void> {
  const commands = await ext().commands?.getAll?.();
  if (!commands) return;
  const shortcuts = Object.fromEntries(
    commands.filter((c) => c.name).map((c) => [c.name!, c.shortcut ?? '']),
  );
  await ext().storage.local.set({ [SHORTCUTS_KEY]: shortcuts });
}

async function injectIntoTab(tabId: number): Promise<void> {
  const scripting = ext().scripting;
  if (!scripting) return;
  await scripting
    .insertCSS({ target: { tabId, allFrames: true }, files: ['content.css'] })
    .catch(() => undefined);
  await scripting
    .executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] })
    .catch(() => undefined);
}

/** Tabs opened before install/update have no (live) content script: protect them now. */
async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await ext().tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(
    tabs.filter((tab) => tab.id !== undefined && !tab.discarded).map((tab) => injectIntoTab(tab.id!)),
  );
}

async function initialize(): Promise<Settings> {
  await syncManagedPolicy().catch(() => undefined);
  const settings = await settingsStore.get();
  lastRulesKey = '';
  lastEngineKey = '';
  await applySettings(settings);
  await pruneAllowances().catch(() => undefined);
  await createMenus(settings).catch(() => undefined);
  await storeShortcuts().catch(() => undefined);
  return settings;
}

ext().runtime.onInstalled.addListener(({ reason }) => {
  void (async () => {
    const settings = await initialize();
    if (reason === 'install' && !settings.onboardingComplete) {
      await ext().tabs.create({ url: extensionUrl('onboarding.html') });
    }
    await injectIntoOpenTabs();
  })();
});

ext().runtime.onStartup.addListener(() => {
  void (async () => {
    // "Until I close the browser" exceptions end with the session.
    const settings = await settingsStore.get();
    if (settings.sites.some((rule) => rule.sessionOnly)) {
      await settingsStore.update({ sites: settings.sites.filter((rule) => !rule.sessionOnly) });
    }
    await initialize();
  })();
});

ext().alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('veil-allowance-')) void pruneAllowances();
  if (alarm.name === SITE_RULES_ALARM) {
    // A temporary block/warn rule expired: rebuild so the browser stops enforcing it.
    lastRulesKey = '';
    void settingsStore.get().then((settings) => applySettings(settings));
  }
});

ext().tabs.onRemoved.addListener((tabId) => tabStats.removeTab(tabId));

// Administrator policy changes are mirrored for every other context.
ext().storage.onChanged.addListener((_changes, area) => {
  if (area === 'managed') void syncManagedPolicy();
});

// Service-worker restarts do not fire onStartup: make sure derived state exists.
void settingsStore.get().then((settings) => applySettings(settings));
