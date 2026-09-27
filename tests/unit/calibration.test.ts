import { describe, expect, it } from 'vitest';
import {
  evaluateLevel,
  type LabelledSample,
  suggestThreshold,
  sweep,
  thresholdGrid,
  wilsonInterval,
} from '../../src/policy/calibration';

const sample = (label: LabelledSample['label'], explicit: number, suggestive = 0): LabelledSample => ({
  label,
  scores: { explicit, illustrated: 0, suggestive },
});

describe('calibration', () => {
  it('builds an inclusive threshold grid without float drift', () => {
    const grid = thresholdGrid(0.1, 0.3, 0.1);
    expect(grid).toEqual([0.1, 0.2, 0.3]);
    expect(thresholdGrid()).toHaveLength(91);
  });

  it('measures recall on the category and false positives on safe images only', () => {
    const samples = [
      sample('explicit', 0.9),
      sample('explicit', 0.4),
      sample('safe', 0.6),
      sample('safe', 0.1),
      // A suggestive image scoring high on explicit is neither a hit nor a false positive.
      sample('suggestive', 0.95),
    ];
    const [point] = sweep(samples, 'explicit', [0.5]);
    expect(point).toMatchObject({ tp: 1, fn: 1, fp: 1, tn: 1, tpr: 0.5, fpr: 0.5, precision: 0.5 });
  });

  it('suggests the lowest threshold within the false-positive budget', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => sample('safe', i / 10)), // 0.0 … 0.9
      sample('explicit', 0.95),
    ];
    const points = sweep(samples, 'explicit', thresholdGrid(0.05, 0.95, 0.05));
    expect(suggestThreshold(points, 0.1)?.threshold).toBe(0.85); // only 0.9 remains → 10%
    expect(suggestThreshold(points, 0)?.threshold).toBe(0.95);
    expect(suggestThreshold(sweep([sample('safe', 1)], 'explicit', [0.5]), 0)).toBeNull();
  });

  it('computes a Wilson interval that stays within [0, 1]', () => {
    const [lo, hi] = wilsonInterval(0, 50);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0.05);
    expect(hi).toBeLessThan(0.08);
    const [lo2, hi2] = wilsonInterval(50, 100);
    expect(lo2).toBeCloseTo(0.404, 2);
    expect(hi2).toBeCloseTo(0.596, 2);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });

  it('evaluates levels with their enabled categories and shipped thresholds', () => {
    const samples = [sample('suggestive', 0.1, 0.85), sample('safe', 0.1, 0.85)];
    // Minimal leaves suggestive off; Balanced (0.80) catches it — and the safe look-alike.
    expect(evaluateLevel(samples, 'minimal')).toMatchObject({ recall: 0, fpr: 0 });
    expect(evaluateLevel(samples, 'balanced')).toMatchObject({ recall: 1, fpr: 1 });
  });
});
