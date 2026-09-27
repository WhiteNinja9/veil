/**
 * Content script entry (document_start, all frames).
 *
 * The very first statement engages the pre-display gate so no media can
 * paint before Veil has decided. Everything after that is asynchronous and
 * fails open: if settings cannot be read or anything throws during start-up,
 * the gate is released and the page renders exactly as it would without Veil.
 */
import { ext } from '../browser/api';
import { resolvePolicy } from '../policy/resolve';
import { check } from '../security/validate';
import { contentCommand } from '../shared/messages';
import { createLogger } from '../shared/logger';
import type { Settings } from '../storage/schema';
import { settingsStore } from '../storage/settings-store';
import { topLevelHostSync } from './context';
import { ProtectionController } from './controller';
import { engageRoot, releaseRoot } from './dom';

const log = createLogger('content');
const SHORTCUTS_KEY = 'veil.shortcuts';
const INSTANCE = Symbol.for('veil.content.instance');

interface Instance {
  controller: ProtectionController | null;
}

function randomGeneration(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function resolveHost(): Promise<string> {
  const sync = topLevelHostSync();
  if (sync !== null) return sync;
  try {
    const response = (await ext().runtime.sendMessage({ type: 'frame/top' })) as
      { host?: string } | undefined;
    return response?.host ?? location.hostname;
  } catch {
    return location.hostname;
  }
}

async function readShortcut(): Promise<string> {
  try {
    const stored = (await ext().storage.local.get(SHORTCUTS_KEY))[SHORTCUTS_KEY] as
      Record<string, string> | undefined;
    return stored?.['reveal-focused'] || 'Alt+Shift+R';
  } catch {
    return 'Alt+Shift+R';
  }
}

/** Next moment the effective policy changes on its own (pause or temporary rule expiring). */
function nextExpiry(settings: Settings, now: number): number | null {
  const times = [settings.pausedUntil, ...settings.sites.map((rule) => rule.expiresAt)].filter(
    (t): t is number => typeof t === 'number' && t > now,
  );
  return times.length ? Math.min(...times) : null;
}

function bootstrap(): void {
  const scope = globalThis as unknown as Record<symbol, Instance | undefined>;
  if (scope[INSTANCE]) return; // already running in this world
  const instance: Instance = { controller: null };
  scope[INSTANCE] = instance;

  if (!(document instanceof HTMLDocument) || !document.documentElement) return;
  const generation = randomGeneration();
  engageRoot(generation);

  let host = location.hostname;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  const apply = (settings: Settings) => {
    const { policy } = resolvePolicy(settings, host);
    if (!instance.controller) {
      instance.controller = new ProtectionController(generation, settings, policy, shortcut);
      instance.controller.start();
    } else {
      instance.controller.updateSettings(settings, policy);
    }
    clearTimeout(expiryTimer);
    const expiry = nextExpiry(settings, Date.now());
    if (expiry !== null)
      expiryTimer = setTimeout(() => apply(settings), Math.min(expiry - Date.now() + 50, 2 ** 31 - 1));
  };

  let shortcut = 'Alt+Shift+R';
  Promise.all([settingsStore.get(), resolveHost(), readShortcut()])
    .then(([settings, resolvedHost, resolvedShortcut]) => {
      host = resolvedHost;
      shortcut = resolvedShortcut;
      apply(settings);
      settingsStore.subscribe((next) => apply(next));
    })
    .catch((error: unknown) => {
      log.warn('Start-up failed; leaving the page untouched', error);
      releaseRoot(generation);
    });

  ext().runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Commands only come from our own extension (background or popup), never from a page.
    if (sender.id !== ext().runtime.id || sender.tab) return false;
    const parsed = check(contentCommand, message);
    if (!parsed.ok) return false;
    const command = parsed.value;
    if (command.type === 'ping') {
      // Only the top frame answers, so the popup gets a single reply.
      if (window === window.top) sendResponse({ ok: true, generation });
      return false;
    }
    if (!instance.controller) return false;
    if (command.type === 'command' && command.command === 'reveal-focused')
      instance.controller.revealFocused();
    if (command.type === 'context') instance.controller.applyManual(command.srcUrl, command.action);
    return false;
  });
}

try {
  bootstrap();
} catch (error) {
  // Never break the page.
  releaseRoot();
  log.error('Bootstrap failed', error);
}
