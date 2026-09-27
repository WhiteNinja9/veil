/**
 * UI actions with business rules: switching levels, backup and restore,
 * resetting. Components call these; they never compose patches themselves.
 */
import { ext } from '../browser/api';
import { categoriesForLevel, PRESETS } from '../policy/presets';
import type { StrictnessLevel } from '../policy/types';
import { isUnlocked, readLock } from '../security/lock';
import { requiresUnlock } from '../security/weakening';
import { type DeepPartial, defaultSettings, sanitizeSettings, type Settings } from '../storage/schema';
import { settingsStore } from '../storage/settings-store';

/** Everything a level implies: thresholds, reveal behaviour, fallback, video cadence. */
export function levelPatch(level: StrictnessLevel, current: Settings): DeepPartial<Settings> {
  const preset = PRESETS[level];
  return {
    strictness: level,
    categories: categoriesForLevel(level, current.categories),
    reveal: { mode: preset.reveal.mode, confirm: preset.reveal.confirm },
    fallback: preset.fallback,
    video: { baseIntervalMs: preset.videoIntervalMs },
  };
}

export const EXPORT_FORMAT = 'veil-settings';

export function exportSettings(settings: Settings): Blob {
  const payload = { format: EXPORT_FORMAT, version: settings.schemaVersion, exportedAt: new Date().toISOString(), settings };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ReplaceOutcome = 'ok' | 'invalid' | 'cancelled';

/** Replaces settings wholesale, honouring the lock for any weakening. */
async function replaceGuarded(next: Settings, requestUnlock: () => Promise<boolean>): Promise<ReplaceOutcome> {
  const current = await settingsStore.get();
  const lock = await readLock();
  if (requiresUnlock(lock, current, next) && !(await isUnlocked())) {
    if (!(await requestUnlock())) return 'cancelled';
  }
  await settingsStore.replace(next);
  return 'ok';
}

export async function importSettings(text: string, requestUnlock: () => Promise<boolean>): Promise<ReplaceOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'invalid';
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { format?: unknown }).format !== EXPORT_FORMAT) return 'invalid';
  const current = await settingsStore.get();
  // Imports never change onboarding state or bypass sanitisation.
  const next = sanitizeSettings({ ...(parsed as { settings?: object }).settings, onboardingComplete: current.onboardingComplete });
  return replaceGuarded(next, requestUnlock);
}

export async function resetSettings(requestUnlock: () => Promise<boolean>): Promise<ReplaceOutcome> {
  const current = await settingsStore.get();
  return replaceGuarded({ ...defaultSettings(), onboardingComplete: current.onboardingComplete, language: current.language }, requestUnlock);
}

/** Opens the browser's keyboard-shortcut editor. */
export async function openShortcutSettings(): Promise<void> {
  const commands = ext().commands as typeof chrome.commands & { openShortcutSettings?: () => Promise<void> };
  if (typeof commands?.openShortcutSettings === 'function') {
    await commands.openShortcutSettings(); // Firefox 137+
    return;
  }
  await ext().tabs.create({ url: 'chrome://extensions/shortcuts' });
}

export async function readShortcuts(): Promise<Record<string, string>> {
  try {
    const commands = await ext().commands.getAll();
    return Object.fromEntries(commands.filter((c) => c.name).map((c) => [c.name!, c.shortcut ?? '']));
  } catch {
    return {};
  }
}
