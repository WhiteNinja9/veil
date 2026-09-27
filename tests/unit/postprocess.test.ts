import { describe, expect, it } from 'vitest';
import { frameIndices } from '../../src/ml/decode';
import {
  aggregateFrames,
  clampRegion,
  decodeBlazeFace,
  emaScores,
  extractPersons,
  gridAnchors,
  iou,
  letterbox,
  nonMaxSuppression,
  toClassifierScores,
  unletterbox,
} from '../../src/ml/postprocess';
import { adaptiveInterval } from '../../src/content/media/video';

const box = (x: number, y: number, w: number, h: number, score = 0.9) => ({ x, y, w, h, score });

describe('geometry', () => {
  it('computes IoU', () => {
    expect(iou(box(0, 0, 1, 1), box(0, 0, 1, 1))).toBe(1);
    expect(iou(box(0, 0, 1, 1), box(2, 2, 1, 1))).toBe(0);
    expect(iou(box(0, 0, 2, 2), box(1, 1, 2, 2))).toBeCloseTo(1 / 7);
  });

  it('suppresses overlapping detections, keeping the best', () => {
    const kept = nonMaxSuppression([box(0, 0, 1, 1, 0.6), box(0.05, 0.05, 1, 1, 0.9), box(3, 3, 1, 1, 0.5)], 0.3, 10);
    expect(kept.map((r) => r.score)).toEqual([0.9, 0.5]);
    expect(nonMaxSuppression([box(0, 0, 1, 1), box(5, 5, 1, 1)], 0.3, 1)).toHaveLength(1);
  });

  it('clamps regions to the image and drops degenerate ones', () => {
    const clamped = clampRegion(box(-0.1, 0.5, 0.3, 0.8))!;
    expect(clamped).toMatchObject({ x: 0, y: 0.5 });
    expect(clamped.w).toBeCloseTo(0.2);
    expect(clamped.h).toBeCloseTo(0.5);
    expect(clampRegion(box(1.2, 0, 0.3, 0.3))).toBeNull();
  });

  it('letterboxes and maps back to source coordinates', () => {
    const lb = letterbox(400, 200);
    expect(lb.side).toBe(400);
    const back = unletterbox(box(0.25, 0.25, 0.5, 0.25), lb);
    expect(back).toMatchObject({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 });
  });
});

describe('BlazeFace decoding', () => {
  it('builds the expected anchor grids', () => {
    expect(gridAnchors(16, 2)).toHaveLength(512);
    expect(gridAnchors(8, 6)).toHaveLength(384);
    expect(gridAnchors(16, 2)[0]).toEqual({ x: 0.5 / 16, y: 0.5 / 16 });
  });

  it('decodes a confident box relative to its anchor', () => {
    const anchors = gridAnchors(2, 1);
    const logits = [-10, 5, -10, -10];
    const boxes = new Array(4 * 16).fill(0);
    boxes[16] = 12.8; // dx: +0.05 of 256
    boxes[18] = 64; // w: 0.25
    boxes[19] = 64; // h: 0.25
    const out = decodeBlazeFace(logits, boxes, anchors, 256, 0.5);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBeGreaterThan(0.99);
    expect(out[0]!.x).toBeCloseTo(0.75 + 0.05 - 0.125);
    expect(out[0]!.w).toBeCloseTo(0.25);
  });
});

describe('COCO-SSD person extraction', () => {
  it('reads class 0 and converts [y1,x1,y2,x2] boxes', () => {
    const numClasses = 3;
    const scores = [0.8, 0.1, 0.1, 0.2, 0.9, 0.1];
    const boxes = [0.1, 0.2, 0.5, 0.6, 0, 0, 1, 1];
    const persons = extractPersons(scores, boxes, 2, numClasses, 0.5);
    expect(persons).toHaveLength(1);
    expect(persons[0]).toMatchObject({ x: 0.2, y: 0.1, score: 0.8 });
    expect(persons[0]!.w).toBeCloseTo(0.4);
  });
});

describe('classifier aggregation', () => {
  it('maps model rows', () => {
    expect(toClassifierScores([0.1, 0.2, 0.3, 0.4, 0.5])).toEqual({ drawing: 0.1, hentai: 0.2, neutral: 0.3, porn: 0.4, sexy: 0.5 });
  });

  it('takes the worst case across animation frames', () => {
    const safe = toClassifierScores([0.1, 0, 0.9, 0, 0]);
    const unsafe = toClassifierScores([0, 0, 0.05, 0.9, 0.05]);
    const agg = aggregateFrames([safe, unsafe]);
    expect(agg.porn).toBe(0.9);
    expect(agg.neutral).toBe(0.05);
    expect(() => aggregateFrames([])).toThrow();
  });

  it('smooths video scores with an EMA', () => {
    const a = toClassifierScores([0, 0, 1, 0, 0]);
    const b = toClassifierScores([0, 0, 0, 1, 0]);
    expect(emaScores(null, b, 0.5)).toBe(b);
    expect(emaScores(a, b, 0.5).porn).toBeCloseTo(0.5);
  });

  it('samples animation frames evenly', () => {
    expect(frameIndices(1, 3)).toEqual([0]);
    expect(frameIndices(10, 3)).toEqual([0, 5, 9]);
    expect(frameIndices(2, 3)).toEqual([0, 1]);
  });
});

describe('adaptive video sampling', () => {
  it('samples faster under pressure and slower when consistently safe', () => {
    expect(adaptiveInterval(1000, 0.6, 0)).toBe(250);
    expect(adaptiveInterval(1000, 0.35, 0)).toBe(500);
    expect(adaptiveInterval(1000, 0.1, 0)).toBe(1000);
    expect(adaptiveInterval(1000, 0.1, 5)).toBe(2000);
    expect(adaptiveInterval(1000, 0.1, 12)).toBe(3000);
    expect(adaptiveInterval(500, 0.9, 0)).toBe(250);
  });
});
