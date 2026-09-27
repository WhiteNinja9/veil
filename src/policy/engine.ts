import type { Region, Signals } from '../ml/types';
import type { Decision, EffectivePolicy, PolicyContext, Reason } from './types';

/** Thresholds are scaled by this factor for media that looks like an advertisement. */
export const AD_THRESHOLD_FACTOR = 0.8;
/** Suggestive scores are damped when detectors ran and found no person at all. */
export const NO_PERSON_DAMPING = 0.8;
/** Scores above this are never damped by context. */
export const DAMPING_CEILING = 0.9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface CategoryScores {
  explicit: number;
  illustrated: number;
  suggestive: number;
}

/**
 * Maps raw classifier output to category scores, applying context-aware
 * corroboration when auxiliary detectors ran. Pure and deterministic.
 */
export function scoreCategories(signals: Signals, contextAware: boolean): CategoryScores | null {
  const c = signals.classifier;
  if (!c) return null;
  const explicit = clamp(c.porn, 0, 1);
  const illustrated = clamp(c.hentai, 0, 1);
  let suggestive = clamp(c.sexy + c.porn, 0, 1);

  if (contextAware && suggestive < DAMPING_CEILING) {
    // The classifier's most common false positives on "suggestive" are
    // skin-toned scenes without people (food, sand, wood, pets). When the
    // person detector ran and found nobody — and no face was found — we damp
    // the suggestive score. Explicit scores are never damped: close-up
    // explicit content often contains no detectable person or face.
    const detectorsRan = signals.people !== undefined;
    const nobody = detectorsRan && signals.people!.length === 0 && (signals.faces?.length ?? 0) === 0;
    if (nobody) suggestive *= NO_PERSON_DAMPING;
  }
  return { explicit, illustrated, suggestive };
}

function effectiveThreshold(base: number, policy: EffectivePolicy, context: PolicyContext): number {
  const factor = context.isAd && policy.media.stricterAds ? AD_THRESHOLD_FACTOR : 1;
  return clamp(base * factor, 0.02, 0.99);
}

function padRegion(region: Region, pad: number): Region {
  const x = clamp(region.x - region.w * pad, 0, 1);
  const y = clamp(region.y - region.h * pad, 0, 1);
  const right = clamp(region.x + region.w * (1 + pad), 0, 1);
  const bottom = clamp(region.y + region.h * (1 + pad), 0, 1);
  return { x, y, w: right - x, h: bottom - y, score: region.score };
}

const REGION_PADDING: Record<'faces' | 'people', number> = { faces: 0.22, people: 0.06 };

/** The core decision function: signals + context + policy → action. */
export function evaluate(signals: Signals, context: PolicyContext, policy: EffectivePolicy): Decision {
  const reasons: Reason[] = [];
  const regions: Region[] = [];
  const regionReasons: Reason[] = [];
  let confidence = 1;
  let pressure = 0;
  const scores = scoreCategories(signals, policy.contextAware);

  if (scores) {
    for (const id of ['explicit', 'illustrated', 'suggestive'] as const) {
      const setting = policy.categories[id];
      if (!setting.enabled) continue;
      const threshold = effectiveThreshold(setting.threshold, policy, context);
      const score = scores[id];
      pressure = Math.max(pressure, score / threshold);
      if (score >= threshold) {
        reasons.push({ category: id, score, threshold });
      } else {
        confidence = Math.min(confidence, (threshold - score) / threshold);
      }
    }
  }

  // Regions can only be rendered for <img>; elsewhere a region category
  // either protects the whole element or is skipped, per policy.
  const regionsRenderable = context.kind === 'image';
  for (const id of ['faces', 'people'] as const) {
    const setting = policy.categories[id];
    const detected = signals[id];
    if (!setting.enabled || !detected) continue;
    const hits = detected.filter((r) => r.score >= setting.threshold);
    if (!hits.length) continue;
    const best = Math.max(...hits.map((r) => r.score));
    if (setting.scope === 'whole' || (!regionsRenderable && context.kind === 'background')) {
      reasons.push({ category: id, score: best, threshold: setting.threshold });
    } else if (!regionsRenderable) {
      if (policy.video.regionsProtectWhole)
        reasons.push({ category: id, score: best, threshold: setting.threshold });
    } else {
      regions.push(...hits.map((r) => padRegion(r, REGION_PADDING[id])));
      regionReasons.push({ category: id, score: best, threshold: setting.threshold });
    }
  }

  const protectReasons = reasons;
  if (protectReasons.length) {
    const margin = Math.max(
      ...protectReasons.map((r) => (r.threshold >= 1 ? 1 : (r.score - r.threshold) / (1 - r.threshold))),
    );
    return { action: 'protect', reasons: protectReasons, confidence: clamp(margin, 0, 1), pressure };
  }
  if (regions.length) {
    return {
      action: 'regions',
      regions,
      reasons: regionReasons,
      confidence,
      pressure,
    };
  }
  return { action: 'allow', reasons: [], confidence: clamp(confidence, 0, 1), pressure };
}

/** Decision used when media could not be verified. */
export function fallbackDecision(policy: EffectivePolicy): Decision {
  return policy.fallback === 'protect'
    ? {
        action: 'protect',
        reasons: [{ category: 'unverified', score: 0, threshold: 0 }],
        confidence: 0,
        pressure: 1,
      }
    : {
        action: 'allow',
        reasons: [{ category: 'unverified', score: 0, threshold: 0 }],
        confidence: 0,
        pressure: 0,
      };
}

/** Signals a policy needs from the engine; unused detectors are never loaded. */
export function requiredSignals(
  policy: EffectivePolicy,
  kind: PolicyContext['kind'],
): ('classifier' | 'faces' | 'people')[] {
  const kinds: ('classifier' | 'faces' | 'people')[] = [];
  const c = policy.categories;
  if (c.explicit.enabled || c.illustrated.enabled || c.suggestive.enabled) kinds.push('classifier');
  const regionsUseful = kind === 'image' || kind === 'background' || policy.video.regionsProtectWhole;
  if (c.faces.enabled && regionsUseful) kinds.push('faces');
  // When enabled, people detection also serves as the corroboration signal
  // for context-aware scoring (see scoreCategories).
  if (c.people.enabled && regionsUseful) kinds.push('people');
  return kinds;
}
