import { describe, expect, it } from 'vitest';
import type { Signals } from '../../src/ml/types';
import {
  AD_THRESHOLD_FACTOR,
  evaluate,
  fallbackDecision,
  requiredSignals,
  scoreCategories,
} from '../../src/policy/engine';
import {
  categoriesForLevel,
  isCustomized,
  PRESETS,
  sensitivityToThreshold,
  stricterOf,
  thresholdToSensitivity,
} from '../../src/policy/presets';
import { resolvePolicy } from '../../src/policy/resolve';
import type { EffectivePolicy, PolicyContext } from '../../src/policy/types';
import { defaultSettings, type Settings } from '../../src/storage/schema';

const signals = (classifier: Partial<Signals['classifier']> = {}, extra: Partial<Signals> = {}): Signals => ({
  classifier: { drawing: 0, hentai: 0, neutral: 1, porn: 0, sexy: 0, ...classifier },
  width: 400,
  height: 300,
  backend: 'test',
  models: [],
  ms: 1,
  ...extra,
});

const image: PolicyContext = { kind: 'image', renderedSize: 300, isAd: false };
const policyFor = (settings: Settings = defaultSettings(), host = 'example.com'): EffectivePolicy =>
  resolvePolicy(settings, host).policy;

describe('scoreCategories', () => {
  it('maps classifier outputs to categories', () => {
    const scores = scoreCategories(signals({ porn: 0.4, sexy: 0.3, hentai: 0.2 }), false)!;
    expect(scores.explicit).toBeCloseTo(0.4);
    expect(scores.illustrated).toBeCloseTo(0.2);
    expect(scores.suggestive).toBeCloseTo(0.7); // "at least suggestive" includes explicit mass
  });

  it('damps suggestive only when detectors ran and found nobody', () => {
    const base = signals({ sexy: 0.7 });
    expect(scoreCategories(base, true)!.suggestive).toBeCloseTo(0.7); // no detector ran
    expect(scoreCategories({ ...base, people: [] }, true)!.suggestive).toBeCloseTo(0.56);
    expect(
      scoreCategories({ ...base, people: [{ x: 0, y: 0, w: 1, h: 1, score: 0.9 }] }, true)!.suggestive,
    ).toBeCloseTo(0.7);
    expect(scoreCategories({ ...base, people: [] }, false)!.suggestive).toBeCloseTo(0.7);
  });

  it('never damps explicit scores or very high suggestive scores', () => {
    const s = signals({ porn: 0.95, sexy: 0.02 }, { people: [], faces: [] });
    const scores = scoreCategories(s, true)!;
    expect(scores.explicit).toBeCloseTo(0.95);
    expect(scores.suggestive).toBeCloseTo(0.97);
  });
});

describe('evaluate', () => {
  it('allows neutral content with high confidence', () => {
    const d = evaluate(signals(), image, policyFor());
    expect(d.action).toBe('allow');
    expect(d.confidence).toBeGreaterThan(0.9);
  });

  it('protects explicit content at every level', () => {
    for (const level of ['minimal', 'balanced', 'strict', 'maximum'] as const) {
      const settings = { ...defaultSettings(), strictness: level, categories: categoriesForLevel(level) };
      expect(evaluate(signals({ porn: 0.95 }), image, policyFor(settings)).action).toBe('protect');
    }
  });

  it('treats borderline content differently by level', () => {
    const borderline = signals({ porn: 0.2, sexy: 0.5 }); // suggestive 0.7
    const at = (level: 'minimal' | 'balanced' | 'strict' | 'maximum') =>
      evaluate(
        borderline,
        image,
        policyFor({ ...defaultSettings(), strictness: level, categories: categoriesForLevel(level) }),
      ).action;
    expect(at('minimal')).toBe('allow');
    expect(at('balanced')).toBe('allow');
    expect(at('strict')).toBe('protect');
    expect(at('maximum')).toBe('protect');
  });

  it('applies stricter thresholds to advertisements when enabled', () => {
    const borderline = signals({ porn: 0.2, sexy: 0.5 });
    const policy = policyFor();
    expect(evaluate(borderline, image, policy).action).toBe('allow');
    expect(evaluate(borderline, { ...image, isAd: true }, policy).action).toBe('protect');
    expect(0.8 * AD_THRESHOLD_FACTOR).toBeLessThan(0.7);
    const noAds = { ...policy, media: { ...policy.media, stricterAds: false } };
    expect(evaluate(borderline, { ...image, isAd: true }, noAds).action).toBe('allow');
  });

  it('respects disabled categories', () => {
    const settings = defaultSettings();
    settings.categories.explicit.enabled = false;
    settings.categories.suggestive.enabled = false;
    expect(evaluate(signals({ porn: 0.99 }), image, policyFor(settings)).action).toBe('allow');
  });

  it('reports the triggering category and a margin-based confidence', () => {
    const d = evaluate(signals({ hentai: 0.9 }), image, policyFor());
    expect(d.action).toBe('protect');
    expect(d.reasons.map((r) => r.category)).toContain('illustrated');
    expect(d.confidence).toBeGreaterThan(0.5);
    expect(d.pressure).toBeGreaterThan(1);
  });

  it('returns padded regions for faces on images', () => {
    const settings = defaultSettings();
    settings.categories.faces.enabled = true;
    const face = { x: 0.4, y: 0.3, w: 0.2, h: 0.2, score: 0.9 };
    const d = evaluate(signals({}, { faces: [face] }), image, policyFor(settings));
    expect(d.action).toBe('regions');
    const r = d.regions![0]!;
    expect(r.x).toBeLessThan(face.x);
    expect(r.w).toBeGreaterThan(face.w);
    expect(d.reasons[0]!.category).toBe('faces');
  });

  it('ignores low-confidence face detections', () => {
    const settings = defaultSettings();
    settings.categories.faces.enabled = true;
    const d = evaluate(
      signals({}, { faces: [{ x: 0.4, y: 0.3, w: 0.2, h: 0.2, score: 0.6 }] }),
      image,
      policyFor(settings),
    );
    expect(d.action).toBe('allow');
  });

  it('protects whole media when a region category is set to "whole" or media is not an <img>', () => {
    const settings = defaultSettings();
    settings.categories.people.enabled = true;
    const person = { x: 0.1, y: 0.1, w: 0.5, h: 0.8, score: 0.9 };
    expect(
      evaluate(signals({}, { people: [person] }), { ...image, kind: 'background' }, policyFor(settings))
        .action,
    ).toBe('protect');
    settings.categories.people.scope = 'whole';
    expect(evaluate(signals({}, { people: [person] }), image, policyFor(settings)).action).toBe('protect');
  });

  it('only protects videos with people when configured', () => {
    const settings = defaultSettings();
    settings.categories.faces.enabled = true;
    const face = [{ x: 0.4, y: 0.3, w: 0.2, h: 0.2, score: 0.9 }];
    const video: PolicyContext = { kind: 'video', renderedSize: 400, isAd: false };
    expect(evaluate(signals({}, { faces: face }), video, policyFor(settings)).action).toBe('allow');
    settings.video.peopleInVideos = true;
    expect(evaluate(signals({}, { faces: face }), video, policyFor(settings)).action).toBe('protect');
  });

  it('prefers whole protection over regions when both apply', () => {
    const settings = defaultSettings();
    settings.categories.faces.enabled = true;
    const d = evaluate(
      signals({ porn: 0.9 }, { faces: [{ x: 0.4, y: 0.3, w: 0.2, h: 0.2, score: 0.9 }] }),
      image,
      policyFor(settings),
    );
    expect(d.action).toBe('protect');
  });
});

describe('fallbackDecision & requiredSignals', () => {
  it('follows the fallback policy', () => {
    const policy = policyFor();
    expect(fallbackDecision({ ...policy, fallback: 'reveal' }).action).toBe('allow');
    expect(fallbackDecision({ ...policy, fallback: 'protect' }).action).toBe('protect');
    expect(fallbackDecision(policy).reasons[0]!.category).toBe('unverified');
  });

  it('loads only the detectors the policy needs', () => {
    const settings = defaultSettings();
    expect(requiredSignals(policyFor(settings), 'image')).toEqual(['classifier']);
    settings.categories.faces.enabled = true;
    expect(requiredSignals(policyFor(settings), 'image')).toEqual(['classifier', 'faces']);
    expect(requiredSignals(policyFor(settings), 'video')).toEqual(['classifier']);
    for (const id of ['explicit', 'illustrated', 'suggestive'] as const)
      settings.categories[id].enabled = false;
    settings.categories.faces.enabled = false;
    expect(requiredSignals(policyFor(settings), 'image')).toEqual([]);
  });
});

describe('presets', () => {
  it('levels are monotonic: stricter levels never have higher thresholds', () => {
    const order = ['minimal', 'balanced', 'strict', 'maximum'] as const;
    for (let i = 1; i < order.length; i++) {
      for (const id of ['explicit', 'illustrated', 'suggestive'] as const) {
        expect(PRESETS[order[i]!][id].threshold).toBeLessThanOrEqual(PRESETS[order[i - 1]!][id].threshold);
      }
    }
  });

  it('round-trips sensitivity and thresholds', () => {
    for (const t of [0.05, 0.2, 0.55, 0.8, 0.95])
      expect(sensitivityToThreshold(thresholdToSensitivity(t))).toBeCloseTo(t, 1);
    expect(sensitivityToThreshold(0)).toBe(0.95);
    expect(sensitivityToThreshold(100)).toBe(0.05);
  });

  it('detects customization', () => {
    const categories = categoriesForLevel('balanced');
    expect(isCustomized('balanced', categories)).toBe(false);
    categories.suggestive.threshold = 0.7;
    expect(isCustomized('balanced', categories)).toBe(true);
  });

  it('stricterOf picks the stricter level', () => {
    expect(stricterOf('minimal', 'strict')).toBe('strict');
    expect(stricterOf('maximum', 'balanced')).toBe('maximum');
  });
});
