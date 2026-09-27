/**
 * Offline threshold calibration, used by `npm run calibrate`
 * (scripts/calibrate.mjs). Pure functions over labelled scores; nothing here
 * is imported by the extension itself.
 *
 * Method (docs/ML.md): for each content category, sweep the decision
 * threshold over labelled samples, measuring the true-positive rate on that
 * category's images and the false-positive rate on safe images. A level's
 * suggested threshold is the lowest one whose false-positive rate on safe
 * images stays within that level's budget — the most protection for a
 * bounded amount of wrongly hidden safe content.
 */
import { PRESETS } from './presets';
import type { StrictnessLevel } from './types';

export type CalibrationLabel = 'safe' | 'explicit' | 'illustrated' | 'suggestive';
export const CALIBRATION_LABELS: readonly CalibrationLabel[] = [
  'safe',
  'explicit',
  'illustrated',
  'suggestive',
];
export type ContentCategory = Exclude<CalibrationLabel, 'safe'>;
export const CONTENT_CATEGORIES: readonly ContentCategory[] = ['explicit', 'illustrated', 'suggestive'];

export interface LabelledSample {
  label: CalibrationLabel;
  scores: Record<ContentCategory, number>;
}

/** Maximum share of safe images each level may hide, per category. */
export const FPR_BUDGETS: Record<StrictnessLevel, number> = {
  minimal: 0.005,
  balanced: 0.02,
  strict: 0.05,
  maximum: 0.1,
};

export interface OperatingPoint {
  threshold: number;
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  /** Recall on the category's own images. */
  tpr: number;
  /** Share of safe images that would be protected. */
  fpr: number;
  /** Among protected images (category + safe), the share that belonged to the category. */
  precision: number;
}

export function thresholdGrid(from = 0.05, to = 0.95, step = 0.01): number[] {
  const out: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i++) out.push(Math.round((from + i * step) * 1000) / 1000);
  return out;
}

/**
 * Operating points for one category. Positives are samples labelled with the
 * category; negatives are safe samples. Samples with a different unsafe
 * label are excluded: protecting them under another category is correct.
 */
export function sweep(
  samples: readonly LabelledSample[],
  category: ContentCategory,
  thresholds: readonly number[] = thresholdGrid(),
): OperatingPoint[] {
  const positives = samples.filter((s) => s.label === category).map((s) => s.scores[category]);
  const negatives = samples.filter((s) => s.label === 'safe').map((s) => s.scores[category]);
  return thresholds.map((threshold) => {
    const tp = positives.filter((score) => score >= threshold).length;
    const fp = negatives.filter((score) => score >= threshold).length;
    const fn = positives.length - tp;
    const tn = negatives.length - fp;
    return {
      threshold,
      tp,
      fn,
      fp,
      tn,
      tpr: positives.length ? tp / positives.length : Number.NaN,
      fpr: negatives.length ? fp / negatives.length : Number.NaN,
      precision: tp + fp ? tp / (tp + fp) : Number.NaN,
    };
  });
}

/** Lowest threshold whose false-positive rate is within budget, or null when none is. */
export function suggestThreshold(
  points: readonly OperatingPoint[],
  fprBudget: number,
): OperatingPoint | null {
  const sorted = [...points].sort((a, b) => a.threshold - b.threshold);
  return sorted.find((p) => Number.isFinite(p.fpr) && p.fpr <= fprBudget) ?? null;
}

/** Wilson score interval for a binomial proportion k/n (95% by default). */
export function wilsonInterval(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

export interface LevelOutcome {
  level: StrictnessLevel;
  /** Unsafe images (any category) that the level protects. */
  recall: number;
  /** Safe images the level protects. */
  fpr: number;
  fprInterval: [number, number];
  unsafe: number;
  safe: number;
}

/**
 * Whole-image outcome of a level's shipped thresholds: an image is protected
 * when any enabled category reaches its threshold (as in policy/engine.ts,
 * for non-advertising media).
 */
export function evaluateLevel(samples: readonly LabelledSample[], level: StrictnessLevel): LevelOutcome {
  const preset = PRESETS[level];
  const protects = (s: LabelledSample) =>
    CONTENT_CATEGORIES.some((c) => preset[c].enabled && s.scores[c] >= preset[c].threshold);
  const unsafe = samples.filter((s) => s.label !== 'safe');
  const safe = samples.filter((s) => s.label === 'safe');
  const caught = unsafe.filter(protects).length;
  const falsePositives = safe.filter(protects).length;
  return {
    level,
    recall: unsafe.length ? caught / unsafe.length : Number.NaN,
    fpr: safe.length ? falsePositives / safe.length : Number.NaN,
    fprInterval: wilsonInterval(falsePositives, safe.length),
    unsafe: unsafe.length,
    safe: safe.length,
  };
}
