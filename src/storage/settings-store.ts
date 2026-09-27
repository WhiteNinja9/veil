import { ext } from '../browser/api';
import { createLogger } from '../shared/logger';
import { categoriesForLevel, stricterOf } from '../policy/presets';
import { REVEAL_MODES, STRICTNESS_LEVELS, type RevealMode, type StrictnessLevel } from '../policy/types';
import { type DeepPartial, mergeSettings, sanitizeSettings, SETTINGS_KEY, type Settings } from './schema';

/** Subset of settings an administrator can enforce (see static/managed_schema.json). */
export interface ManagedPolicy {
  enforceEnabled?: boolean;
  minimumStrictness?: StrictnessLevel;
  strictBrowsing?: boolean;
  revealMode?: RevealMode;
}

const log = createLogger('settings');

export type SettingsListener = (settings: Settings, previous: Settings | null) => void;

/**
 * SettingsStore: typed, validated access to user configuration.
 *
 * - Reads are sanitised (see schema.ts) and cached per context.
 * - Writes go through `update`, which merges, validates and persists.
 * - Changes made in any context propagate via storage.onChanged.
 * - Managed-storage policies (enterprise / family deployments) are overlaid
 *   on top of user values and cannot be changed from the UI.
 *
 * Only extension pages write settings. Content scripts read them.
 */
export class SettingsStore {
  private current: Settings | null = null;
  private managed: ManagedPolicy | null = null;
  private loading: Promise<Settings> | null = null;
  private readonly listeners = new Set<SettingsListener>();
  private subscribed = false;

  async get(): Promise<Settings> {
    if (this.current) return this.current;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  /** Synchronous access after the first `get()` resolved. */
  peek(): Settings | null {
    return this.current;
  }

  private async load(): Promise<Settings> {
    this.ensureSubscribed();
    let raw: unknown;
    try {
      const result = await ext().storage.local.get(SETTINGS_KEY);
      raw = result[SETTINGS_KEY];
    } catch (error) {
      log.warn('Failed to read settings, using defaults', error);
    }
    this.managed = await readManagedMirror();
    this.current = this.applyManaged(sanitizeSettings(raw));
    return this.current;
  }

  private applyManaged(settings: Settings): Settings {
    const policy = this.managed;
    if (!policy) return settings;
    const patch: DeepPartial<Settings> = {};
    if (policy.enforceEnabled) {
      patch.enabled = true;
      patch.pausedUntil = null;
    }
    if (
      policy.minimumStrictness &&
      stricterOf(settings.strictness, policy.minimumStrictness) !== settings.strictness
    ) {
      patch.strictness = policy.minimumStrictness;
      patch.categories = categoriesForLevel(policy.minimumStrictness, settings.categories);
    }
    if (policy.strictBrowsing) patch.strictBrowsing = { enabled: true };
    if (policy.revealMode) patch.reveal = { mode: policy.revealMode };
    return Object.keys(patch).length ? mergeSettings(settings, patch) : settings;
  }

  /** Administrator policy in effect, for UI affordances ("Managed by your organisation"). */
  managedPolicy(): ManagedPolicy | null {
    return this.managed;
  }

  async update(patch: DeepPartial<Settings>): Promise<Settings> {
    const base = await this.get();
    const next = this.applyManaged(mergeSettings(base, patch));
    const previous = this.current;
    this.current = next;
    await ext().storage.local.set({ [SETTINGS_KEY]: next });
    this.emit(next, previous);
    return next;
  }

  async replace(settings: unknown): Promise<Settings> {
    const next = this.applyManaged(sanitizeSettings(settings));
    const previous = this.current;
    this.current = next;
    await ext().storage.local.set({ [SETTINGS_KEY]: next });
    this.emit(next, previous);
    return next;
  }

  subscribe(listener: SettingsListener): () => void {
    this.ensureSubscribed();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(next: Settings, previous: Settings | null) {
    for (const listener of this.listeners) {
      try {
        listener(next, previous);
      } catch (error) {
        log.error('Settings listener failed', error);
      }
    }
  }

  private ensureSubscribed() {
    if (this.subscribed) return;
    this.subscribed = true;
    ext().storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_KEY]) {
        const next = this.applyManaged(sanitizeSettings(changes[SETTINGS_KEY].newValue));
        if (this.current && JSON.stringify(this.current) === JSON.stringify(next)) return;
        const previous = this.current;
        this.current = next;
        this.emit(next, previous);
      }
      if (area === 'local' && changes[MANAGED_MIRROR_KEY]) {
        this.managed = parseManagedPolicy(changes[MANAGED_MIRROR_KEY].newValue);
        if (this.current) {
          const previous = this.current;
          this.current = this.applyManaged(this.current);
          this.emit(this.current, previous);
        }
      }
    });
  }
}

/**
 * Administrator policy (Chrome `storage.managed` via managed_schema.json,
 * Firefox via policies.json "3rdparty" extension settings).
 *
 * Only the background reads the managed area — in Chrome that read can
 * take seconds when no policy exists, which must never delay a page. The
 * background mirrors the parsed policy into local storage; every other
 * context reads the mirror.
 */
export const MANAGED_MIRROR_KEY = 'veil.managedPolicy';

export function parseManagedPolicy(raw: unknown): ManagedPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const policy: ManagedPolicy = {};
  if (input.enforceEnabled === true) policy.enforceEnabled = true;
  if (
    typeof input.minimumStrictness === 'string' &&
    (STRICTNESS_LEVELS as readonly string[]).includes(input.minimumStrictness)
  ) {
    policy.minimumStrictness = input.minimumStrictness as StrictnessLevel;
  }
  if (input.strictBrowsing === true) policy.strictBrowsing = true;
  if (
    typeof input.revealMode === 'string' &&
    (REVEAL_MODES as readonly string[]).includes(input.revealMode)
  ) {
    policy.revealMode = input.revealMode as RevealMode;
  }
  return Object.keys(policy).length ? policy : null;
}

async function readManagedMirror(): Promise<ManagedPolicy | null> {
  try {
    return parseManagedPolicy((await ext().storage.local.get(MANAGED_MIRROR_KEY))[MANAGED_MIRROR_KEY]);
  } catch {
    return null;
  }
}

/** Background only: reads the managed area (bounded wait) and refreshes the mirror. */
export async function syncManagedPolicy(timeoutMs = 3000): Promise<ManagedPolicy | null> {
  const managedArea = (ext().storage as Partial<typeof chrome.storage>).managed;
  let policy: ManagedPolicy | null = null;
  if (managedArea) {
    try {
      const raw = await Promise.race([
        managedArea.get(null) as Promise<Record<string, unknown>>,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      policy = parseManagedPolicy(raw);
    } catch {
      // storage.managed rejects when no policy is configured on some platforms.
    }
  }
  const current = await readManagedMirror();
  if (JSON.stringify(current) !== JSON.stringify(policy)) {
    if (policy) await ext().storage.local.set({ [MANAGED_MIRROR_KEY]: policy });
    else await ext().storage.local.remove(MANAGED_MIRROR_KEY);
  }
  return policy;
}

/** Process-wide singleton for each extension context. */
export const settingsStore = new SettingsStore();
