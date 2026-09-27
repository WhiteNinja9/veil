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
    this.managed = await readManagedPolicy();
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
    if (policy.minimumStrictness && stricterOf(settings.strictness, policy.minimumStrictness) !== settings.strictness) {
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
      if (area === 'managed') {
        void readManagedPolicy().then((managed) => {
          this.managed = managed;
          if (this.current) {
            const previous = this.current;
            this.current = this.applyManaged(this.current);
            this.emit(this.current, previous);
          }
        });
      }
    });
  }
}

/**
 * Administrator policy (Chrome `storage.managed` via managed_schema.json,
 * Firefox via policies.json "3rdparty" extension settings). Only a curated
 * subset of settings can be enforced; see docs/DEPLOYMENT.md.
 */
async function readManagedPolicy(): Promise<ManagedPolicy | null> {
  const managedArea = (ext().storage as Partial<typeof chrome.storage>).managed;
  if (!managedArea) return null;
  try {
    const raw = (await managedArea.get(null)) as Record<string, unknown>;
    if (!raw || !Object.keys(raw).length) return null;
    const policy: ManagedPolicy = {};
    if (raw.enforceEnabled === true) policy.enforceEnabled = true;
    if (typeof raw.minimumStrictness === 'string' && (STRICTNESS_LEVELS as readonly string[]).includes(raw.minimumStrictness)) {
      policy.minimumStrictness = raw.minimumStrictness as StrictnessLevel;
    }
    if (raw.strictBrowsing === true) policy.strictBrowsing = true;
    if (typeof raw.revealMode === 'string' && (REVEAL_MODES as readonly string[]).includes(raw.revealMode)) {
      policy.revealMode = raw.revealMode as RevealMode;
    }
    return Object.keys(policy).length ? policy : null;
  } catch {
    // storage.managed rejects when no policy is configured on some platforms.
    return null;
  }
}

/** Process-wide singleton for each extension context. */
export const settingsStore = new SettingsStore();
