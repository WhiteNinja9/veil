import { describe, expect, it } from 'vitest';
import { faceCropBox, faceTiles, fromTile, mergeDetections } from '../../src/ml/postprocess';
import type { Region, Signals } from '../../src/ml/types';
import {
  apparentGender,
  evaluate,
  personGender,
  requiredSignals,
  selectedBy,
  selectRegions,
} from '../../src/policy/engine';
import { resolvePolicy } from '../../src/policy/resolve';
import type { PeopleFilter, PolicyContext } from '../../src/policy/types';
import { weakenedScopes } from '../../src/security/weakening';
import {
  type DeepPartial,
  defaultSettings,
  mergeSettings,
  sanitizeSettings,
  type Settings,
} from '../../src/storage/schema';

const face = (x: number, y: number, female?: number, score = 0.95): Region => ({
  x,
  y,
  w: 0.1,
  h: 0.12,
  score,
  ...(female === undefined ? {} : { female }),
});
const person = (x: number, y: number, score = 0.9): Region => ({ x, y, w: 0.3, h: 0.8, score });
const signals = (extra: Partial<Signals>): Signals => ({
  width: 800,
  height: 600,
  backend: 'test',
  models: [],
  ms: 1,
  ...extra,
});
const image: PolicyContext = { kind: 'image', renderedSize: 400, isAd: false };

const settingsWith = (patch: DeepPartial<Settings>): Settings =>
  mergeSettings(
    mergeSettings(defaultSettings(), {
      categories: {
        faces: { enabled: true, scope: 'regions' },
        people: { enabled: true, scope: 'regions' },
      },
    }),
    patch,
  );
const policyWith = (patch: DeepPartial<Settings>) => resolvePolicy(settingsWith(patch), 'example.com').policy;

describe('apparent gender', () => {
  it('uses asymmetric cut-offs with an unsure band', () => {
    expect(apparentGender(0.9)).toBe('female');
    expect(apparentGender(0.45)).toBe('female');
    expect(apparentGender(0.4)).toBe('unsure');
    expect(apparentGender(0.3)).toBe('male');
    expect(apparentGender(0.02)).toBe('male');
    expect(apparentGender(undefined)).toBe('unsure');
  });

  it('selects by target, sending unsure faces to the user’s choice', () => {
    const women: PeopleFilter = { who: 'women', unsure: 'protect' };
    expect(selectedBy(women, 'female')).toBe(true);
    expect(selectedBy(women, 'male')).toBe(false);
    expect(selectedBy(women, 'unsure')).toBe(true);
    expect(selectedBy({ ...women, unsure: 'reveal' }, 'unsure')).toBe(false);
    expect(selectedBy({ who: 'men', unsure: 'reveal' }, 'male')).toBe(true);
    expect(selectedBy({ who: 'men', unsure: 'reveal' }, 'female')).toBe(false);
    expect(selectedBy({ who: 'everyone', unsure: 'reveal' }, 'unsure')).toBe(true);
  });

  it('gives a person the gender of the largest face in the upper part of their box', () => {
    const p = person(0.1, 0.1);
    expect(personGender(p, [face(0.15, 0.15, 0.9)])).toBe('female');
    // A face low in the box (someone sitting in front) doesn't count.
    expect(personGender(p, [face(0.15, 0.75, 0.9)])).toBe('unsure');
    expect(personGender(p, [face(0.6, 0.15, 0.9)])).toBe('unsure');
    const small = { ...face(0.12, 0.12, 0.05), w: 0.03, h: 0.04 };
    expect(personGender(p, [small, face(0.2, 0.2, 0.95)])).toBe('female');
  });
});

describe('selecting regions', () => {
  const faces = [face(0.1, 0.1, 0.92), face(0.5, 0.1, 0.05), face(0.8, 0.1, 0.38), face(0.3, 0.6, 0.9, 0.55)];
  const withGender = signals({
    gender: faces,
    people: [person(0.05, 0.05), person(0.45, 0.05), person(0.75, 0.05)],
  });

  it('blurs only faces that appear female, plus unsure ones when asked', () => {
    const picked = selectRegions(
      'faces',
      withGender,
      policyWith({ peopleFilter: { who: 'women', unsure: 'protect' } }),
    );
    expect(picked!.map((r) => r.x)).toEqual([0.1, 0.8]); // low-score face below the 0.75 threshold is ignored
    const strict = selectRegions(
      'faces',
      withGender,
      policyWith({ peopleFilter: { who: 'women', unsure: 'reveal' } }),
    );
    expect(strict!.map((r) => r.x)).toEqual([0.1]);
    const men = selectRegions(
      'faces',
      withGender,
      policyWith({ peopleFilter: { who: 'men', unsure: 'reveal' } }),
    );
    expect(men!.map((r) => r.x)).toEqual([0.5]);
  });

  it('blurs people by the face found on them', () => {
    const picked = selectRegions(
      'people',
      withGender,
      policyWith({ peopleFilter: { who: 'men', unsure: 'reveal' } }),
    );
    expect(picked!.map((r) => r.x)).toEqual([0.45]);
  });

  it('needs gender estimates to filter, but not to blur everyone', () => {
    const plain = signals({ faces });
    expect(
      selectRegions('faces', plain, policyWith({ peopleFilter: { who: 'women', unsure: 'protect' } })),
    ).toBeNull();
    expect(selectRegions('faces', plain, policyWith({}))!.length).toBe(3);
  });

  it('turns selections into region or whole-image decisions', () => {
    const regions = evaluate(
      withGender,
      image,
      policyWith({ peopleFilter: { who: 'women', unsure: 'reveal' } }),
    );
    expect(regions.action).toBe('regions');
    const nobody = evaluate(
      signals({ gender: [face(0.5, 0.1, 0.05)], people: [] }),
      image,
      policyWith({ peopleFilter: { who: 'women', unsure: 'reveal' } }),
    );
    expect(nobody.action).toBe('allow');
    const whole = evaluate(
      withGender,
      image,
      policyWith({
        peopleFilter: { who: 'women', unsure: 'reveal' },
        categories: { faces: { scope: 'whole' } },
      }),
    );
    expect(whole.action).toBe('protect');
  });

  it('asks the engine for gender only when filtering', () => {
    expect(requiredSignals(policyWith({}), 'image')).toEqual(['classifier', 'faces', 'people']);
    expect(requiredSignals(policyWith({ peopleFilter: { who: 'women' } }), 'image')).toEqual([
      'classifier',
      'gender',
      'people',
    ]);
    const peopleOnly = policyWith({
      peopleFilter: { who: 'men' },
      categories: { faces: { enabled: false } },
    });
    expect(requiredSignals(peopleOnly, 'image')).toEqual(['classifier', 'people', 'gender']);
    // Video frames only when the user asked for whole-video protection.
    expect(requiredSignals(policyWith({ peopleFilter: { who: 'women' } }), 'video')).toEqual(['classifier']);
    expect(
      requiredSignals(
        policyWith({ peopleFilter: { who: 'women' }, video: { peopleInVideos: true } }),
        'video',
      ),
    ).toEqual(['classifier', 'gender', 'people']);
  });
});

describe('settings', () => {
  it('sanitises the filter field by field', () => {
    expect(sanitizeSettings({ peopleFilter: { who: 'women', unsure: 'nope' } }).peopleFilter).toEqual({
      who: 'women',
      unsure: 'protect',
    });
    expect(sanitizeSettings({ peopleFilter: 'men' }).peopleFilter).toEqual({
      who: 'everyone',
      unsure: 'protect',
    });
  });

  it('treats blurring fewer people as weakening', () => {
    const everyone = settingsWith({});
    const women = settingsWith({ peopleFilter: { who: 'women' } });
    expect(weakenedScopes(everyone, women).has('settings')).toBe(true);
    expect(weakenedScopes(women, settingsWith({ peopleFilter: { who: 'men' } })).has('settings')).toBe(true);
    expect(weakenedScopes(women, everyone).size).toBe(0);
    expect(
      weakenedScopes(women, settingsWith({ peopleFilter: { who: 'women', unsure: 'reveal' } })).has(
        'settings',
      ),
    ).toBe(true);
  });
});

describe('face geometry', () => {
  it('crops a square around the face, or refuses tiny faces', () => {
    const box = faceCropBox({ x: 0.4, y: 0.4, w: 0.1, h: 0.2, score: 1 }, 1000, 500, 1.5, 24)!;
    expect(box.side).toBeCloseTo(150); // longer side 100 px × 1.5
    expect(box.sx + box.side / 2).toBeCloseTo(450);
    expect(box.sy + box.side / 2).toBeCloseTo(250);
    expect(faceCropBox({ x: 0.5, y: 0.5, w: 0.01, h: 0.01, score: 1 }, 1000, 1000, 1.5, 24)).toBeNull();
  });

  it('tiles only large images, covering them with overlap', () => {
    expect(faceTiles(480, 400, 384)).toEqual([]);
    const tiles = faceTiles(1280, 1024, 384);
    expect(tiles).toHaveLength(12);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(Math.max(...tiles.map((t) => t.x + t.w))).toBeCloseTo(1);
    expect(Math.max(...tiles.map((t) => t.y + t.h))).toBeCloseTo(1);
    expect(faceTiles(10000, 500, 384).length).toBeLessThanOrEqual(8);
  });

  it('maps tile detections back and merges duplicates and halves', () => {
    const r = fromTile({ x: 0.5, y: 0.5, w: 0.1, h: 0.1, score: 0.9 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(r).toMatchObject({ x: 0.75, y: 0.25, w: 0.05, h: 0.05 });
    const whole = { x: 0.1, y: 0.1, w: 0.2, h: 0.2, score: 0.9 };
    const same = { x: 0.11, y: 0.1, w: 0.2, h: 0.2, score: 0.8 };
    const half = { x: 0.1, y: 0.1, w: 0.1, h: 0.2, score: 0.85 };
    const other = { x: 0.6, y: 0.6, w: 0.1, h: 0.1, score: 0.7 };
    expect(mergeDetections([same, half, whole, other])).toEqual([whole, other]);
  });
});
