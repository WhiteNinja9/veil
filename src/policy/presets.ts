import type {
  CategorySettings,
  FallbackAction,
  RevealMode,
  StrictnessLevel,
} from './types';

/**
 * Protection levels. Thresholds apply to the content classifier's softmax
 * outputs; see docs/ML.md for the calibration method and how to re-derive
 * them from a private evaluation set with `npm run calibrate`.
 */
export interface Preset {
  level: StrictnessLevel;
  explicit: { enabled: boolean; threshold: number };
  illustrated: { enabled: boolean; threshold: number };
  suggestive: { enabled: boolean; threshold: number };
  reveal: { mode: RevealMode; confirm: boolean };
  fallback: FallbackAction;
  videoIntervalMs: number;
}

export const PRESETS: Record<StrictnessLevel, Preset> = {
  minimal: {
    level: 'minimal',
    explicit: { enabled: true, threshold: 0.8 },
    illustrated: { enabled: true, threshold: 0.85 },
    suggestive: { enabled: false, threshold: 0.92 },
    reveal: { mode: 'click', confirm: false },
    fallback: 'reveal',
    videoIntervalMs: 1500,
  },
  balanced: {
    level: 'balanced',
    explicit: { enabled: true, threshold: 0.55 },
    illustrated: { enabled: true, threshold: 0.65 },
    suggestive: { enabled: true, threshold: 0.8 },
    reveal: { mode: 'click', confirm: false },
    fallback: 'reveal',
    videoIntervalMs: 1000,
  },
  strict: {
    level: 'strict',
    explicit: { enabled: true, threshold: 0.35 },
    illustrated: { enabled: true, threshold: 0.45 },
    suggestive: { enabled: true, threshold: 0.6 },
    reveal: { mode: 'hold', confirm: false },
    fallback: 'protect',
    videoIntervalMs: 700,
  },
  maximum: {
    level: 'maximum',
    explicit: { enabled: true, threshold: 0.2 },
    illustrated: { enabled: true, threshold: 0.3 },
    suggestive: { enabled: true, threshold: 0.4 },
    reveal: { mode: 'hold', confirm: true },
    fallback: 'protect',
    videoIntervalMs: 500,
  },
};

export const LEVEL_RANK: Record<StrictnessLevel, number> = { minimal: 0, balanced: 1, strict: 2, maximum: 3 };

export function stricterOf(a: StrictnessLevel, b: StrictnessLevel): StrictnessLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/** Default detector thresholds for the region categories (detector confidence). */
export const REGION_DEFAULTS = {
  faces: { enabled: false, threshold: 0.75, scope: 'regions' as const },
  people: { enabled: false, threshold: 0.55, scope: 'regions' as const },
};

/** Category settings for a level, keeping the caller's region-category choices. */
export function categoriesForLevel(
  level: StrictnessLevel,
  regions: Pick<CategorySettings, 'faces' | 'people'> = REGION_DEFAULTS,
): CategorySettings {
  const preset = PRESETS[level];
  return {
    explicit: { ...preset.explicit },
    illustrated: { ...preset.illustrated },
    suggestive: { ...preset.suggestive },
    faces: { ...regions.faces },
    people: { ...regions.people },
  };
}

/** True when content-category settings differ from the level's preset. */
export function isCustomized(level: StrictnessLevel, categories: CategorySettings): boolean {
  const preset = PRESETS[level];
  return (['explicit', 'illustrated', 'suggestive'] as const).some(
    (id) =>
      categories[id].enabled !== preset[id].enabled ||
      Math.abs(categories[id].threshold - preset[id].threshold) > 0.001,
  );
}

/**
 * Users adjust "sensitivity" (0–100, higher = protects more); the engine
 * works with thresholds. The mapping is linear over [0.05, 0.95].
 */
export function sensitivityToThreshold(sensitivity: number): number {
  const s = Math.min(100, Math.max(0, sensitivity));
  return Math.round((0.95 - (s / 100) * 0.9) * 100) / 100;
}

export function thresholdToSensitivity(threshold: number): number {
  const t = Math.min(0.95, Math.max(0.05, threshold));
  return Math.round(((0.95 - t) / 0.9) * 100);
}
