import { categoriesForLevel, PRESETS } from '../policy/presets';
import {
  type CategorySettings,
  type FallbackAction,
  type ProtectionStyle,
  type RevealMode,
  type StrictnessLevel,
  PROTECTION_STYLES,
  REVEAL_MODES,
  STRICTNESS_LEVELS,
} from '../policy/types';
import { parsePattern, SITE_MODES, type SiteRule } from '../sites/rules';

export const SETTINGS_VERSION = 1;
export const SETTINGS_KEY = 'veil.settings';
export const LOCK_KEY = 'veil.lock';
export const MAX_SITE_RULES = 2000;

export type Language = 'auto' | 'en' | 'ar' | 'fr';
export const LANGUAGES: readonly Language[] = ['auto', 'en', 'ar', 'fr'];
export type ThemePreference = 'system' | 'light' | 'dark';
export type MotionPreference = 'system' | 'reduced' | 'full';
export type BackendPreference = 'auto' | 'webgpu' | 'webgl' | 'wasm' | 'cpu';

export interface Settings {
  schemaVersion: number;
  enabled: boolean;
  /** Global pause (epoch ms) — protection resumes automatically afterwards. */
  pausedUntil: number | null;
  strictness: StrictnessLevel;
  categories: CategorySettings;
  media: {
    images: boolean;
    videos: boolean;
    backgrounds: boolean;
    /** Include small images (thumbnails, avatars) down to `minSize`. */
    thumbnails: boolean;
    /** Minimum rendered size in CSS px for media to be analysed. */
    minSize: number;
    /** Apply stricter thresholds to media that looks like an ad. */
    stricterAds: boolean;
  };
  appearance: {
    style: ProtectionStyle;
    theme: ThemePreference;
    motion: MotionPreference;
    /** Show the "Protected" chip when hovering or focusing protected media. */
    showChip: boolean;
  };
  reveal: {
    mode: RevealMode;
    confirm: boolean;
    /** Re-protect revealed media after N seconds (0 = keep revealed). */
    reprotectAfterSec: number;
  };
  fallback: FallbackAction;
  video: {
    /** Base sampling interval; adapts between ¼× and 3× at runtime. */
    baseIntervalMs: number;
    /** Lift protection automatically after several consecutive safe frames. */
    autoRestore: boolean;
    /** When faces/people are enabled, protect whole videos containing them. */
    regionsProtectWhole: boolean;
  };
  strictBrowsing: {
    enabled: boolean;
    safeSearch: boolean;
    youtubeRestricted: boolean;
    /** Ignore per-site "off" rules while strict browsing is on. */
    ignoreSiteExceptions: boolean;
  };
  sites: SiteRule[];
  performance: {
    backend: BackendPreference;
    /** Unload models after this many idle minutes (frees memory). */
    unloadAfterMin: number;
  };
  contextAware: boolean;
  stats: { enabled: boolean; /** Show the protected count on the toolbar icon. */ badge: boolean };
  language: Language;
  onboardingComplete: boolean;
}

export function defaultSettings(): Settings {
  const balanced = PRESETS.balanced;
  return {
    schemaVersion: SETTINGS_VERSION,
    enabled: true,
    pausedUntil: null,
    strictness: 'balanced',
    categories: categoriesForLevel('balanced'),
    media: {
      images: true,
      videos: true,
      backgrounds: true,
      thumbnails: true,
      minSize: 36,
      stricterAds: true,
    },
    appearance: { style: 'blur-strong', theme: 'system', motion: 'system', showChip: true },
    reveal: { mode: balanced.reveal.mode, confirm: balanced.reveal.confirm, reprotectAfterSec: 0 },
    fallback: balanced.fallback,
    video: { baseIntervalMs: balanced.videoIntervalMs, autoRestore: true, regionsProtectWhole: false },
    strictBrowsing: { enabled: false, safeSearch: true, youtubeRestricted: true, ignoreSiteExceptions: true },
    sites: [],
    performance: { backend: 'auto', unloadAfterMin: 10 },
    contextAware: true,
    stats: { enabled: true, badge: false },
    language: 'auto',
    onboardingComplete: false,
  };
}

// ── Sanitisation ──────────────────────────────────────────────────────────
// Stored data is never trusted: every field is type-checked and clamped, and
// invalid fields fall back to defaults individually so one corrupt value
// cannot reset (or weaken) the rest of a user's configuration.

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const num = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
const obj = (value: unknown): Obj => (isObj(value) ? value : {});

function sanitizeCategories(raw: unknown, fallback: CategorySettings): CategorySettings {
  const input = obj(raw);
  const content = (id: 'explicit' | 'illustrated' | 'suggestive') => {
    const c = obj(input[id]);
    return {
      enabled: bool(c.enabled, fallback[id].enabled),
      threshold: num(c.threshold, fallback[id].threshold, 0.05, 0.99),
    };
  };
  const region = (id: 'faces' | 'people') => {
    const c = obj(input[id]);
    return {
      enabled: bool(c.enabled, fallback[id].enabled),
      threshold: num(c.threshold, fallback[id].threshold, 0.3, 0.99),
      scope: oneOf(c.scope, ['regions', 'whole'] as const, fallback[id].scope),
    };
  };
  return {
    explicit: content('explicit'),
    illustrated: content('illustrated'),
    suggestive: content('suggestive'),
    faces: region('faces'),
    people: region('people'),
  };
}

export function sanitizeSiteRules(raw: unknown): SiteRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rules: SiteRule[] = [];
  for (const entry of raw.slice(0, MAX_SITE_RULES)) {
    if (!isObj(entry)) continue;
    if (typeof entry.pattern !== 'string' || entry.pattern.length > 253) continue;
    const parsed = parsePattern(entry.pattern);
    if (!parsed.ok || seen.has(parsed.value.pattern)) continue;
    const mode = oneOf(entry.mode, SITE_MODES, 'balanced');
    if (entry.mode !== mode) continue;
    seen.add(parsed.value.pattern);
    rules.push({
      id: typeof entry.id === 'string' && /^[a-f0-9]{8,32}$/.test(entry.id) ? entry.id : randomId(),
      pattern: parsed.value.pattern,
      mode,
      createdAt: num(entry.createdAt, Date.now(), 0, 8.64e15),
      expiresAt:
        entry.expiresAt === null || entry.expiresAt === undefined
          ? null
          : num(entry.expiresAt, 0, 0, 8.64e15),
      ...(entry.sessionOnly === true ? { sessionOnly: true } : {}),
    });
  }
  return rules;
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const input = migrate(obj(raw));
  const strictness = oneOf(input.strictness, STRICTNESS_LEVELS, d.strictness);
  const media = obj(input.media);
  const appearance = obj(input.appearance);
  const reveal = obj(input.reveal);
  const video = obj(input.video);
  const strict = obj(input.strictBrowsing);
  const perf = obj(input.performance);

  return {
    schemaVersion: SETTINGS_VERSION,
    enabled: bool(input.enabled, d.enabled),
    pausedUntil:
      typeof input.pausedUntil === 'number' && Number.isFinite(input.pausedUntil) ? input.pausedUntil : null,
    strictness,
    categories: sanitizeCategories(input.categories, categoriesForLevel(strictness)),
    media: {
      images: bool(media.images, d.media.images),
      videos: bool(media.videos, d.media.videos),
      backgrounds: bool(media.backgrounds, d.media.backgrounds),
      thumbnails: bool(media.thumbnails, d.media.thumbnails),
      minSize: Math.round(num(media.minSize, d.media.minSize, 16, 400)),
      stricterAds: bool(media.stricterAds, d.media.stricterAds),
    },
    appearance: {
      style: oneOf(appearance.style, PROTECTION_STYLES, d.appearance.style),
      theme: oneOf(appearance.theme, ['system', 'light', 'dark'] as const, d.appearance.theme),
      motion: oneOf(appearance.motion, ['system', 'reduced', 'full'] as const, d.appearance.motion),
      showChip: bool(appearance.showChip, d.appearance.showChip),
    },
    reveal: {
      mode: oneOf(reveal.mode, REVEAL_MODES, d.reveal.mode),
      confirm: bool(reveal.confirm, d.reveal.confirm),
      reprotectAfterSec: Math.round(num(reveal.reprotectAfterSec, d.reveal.reprotectAfterSec, 0, 3600)),
    },
    fallback: oneOf(input.fallback, ['reveal', 'protect'] as const, d.fallback),
    video: {
      baseIntervalMs: Math.round(num(video.baseIntervalMs, d.video.baseIntervalMs, 250, 5000)),
      autoRestore: bool(video.autoRestore, d.video.autoRestore),
      regionsProtectWhole: bool(video.regionsProtectWhole, d.video.regionsProtectWhole),
    },
    strictBrowsing: {
      enabled: bool(strict.enabled, d.strictBrowsing.enabled),
      safeSearch: bool(strict.safeSearch, d.strictBrowsing.safeSearch),
      youtubeRestricted: bool(strict.youtubeRestricted, d.strictBrowsing.youtubeRestricted),
      ignoreSiteExceptions: bool(strict.ignoreSiteExceptions, d.strictBrowsing.ignoreSiteExceptions),
    },
    sites: sanitizeSiteRules(input.sites),
    performance: {
      backend: oneOf(
        perf.backend,
        ['auto', 'webgpu', 'webgl', 'wasm', 'cpu'] as const,
        d.performance.backend,
      ),
      unloadAfterMin: Math.round(num(perf.unloadAfterMin, d.performance.unloadAfterMin, 1, 240)),
    },
    contextAware: bool(input.contextAware, d.contextAware),
    stats: {
      enabled: bool(obj(input.stats).enabled, d.stats.enabled),
      badge: bool(obj(input.stats).badge, d.stats.badge),
    },
    language: oneOf(input.language, LANGUAGES, d.language),
    onboardingComplete: bool(input.onboardingComplete, d.onboardingComplete),
  };
}

/**
 * Schema migrations, oldest first. Each step receives the raw object for
 * version N and returns version N+1. Unversioned data is treated as v1.
 */
const MIGRATIONS: Record<number, (input: Obj) => Obj> = {
  // 1: (input) => ({ ...input, schemaVersion: 2, newField: ... }),
};

export function migrate(input: Obj): Obj {
  let current = input;
  let version = typeof current.schemaVersion === 'number' ? current.schemaVersion : SETTINGS_VERSION;
  while (version < SETTINGS_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    current = step(current);
    version++;
  }
  return current;
}

/** Deep partial used for updates. Arrays are replaced, not merged. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  const merge = (target: Obj, source: Obj): Obj => {
    const out: Obj = { ...target };
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      out[key] = isObj(value) && isObj(target[key]) ? merge(target[key] as Obj, value) : value;
    }
    return out;
  };
  return sanitizeSettings(merge(base as unknown as Obj, patch as Obj));
}

export type { FallbackAction, RevealMode, ProtectionStyle, StrictnessLevel };
