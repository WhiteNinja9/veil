import { describe, expect, it } from 'vitest';
import type { Region } from '../../src/ml/types';
import {
  boxOnElement,
  drawnFrameRect,
  MAX_EXTRAPOLATE_MS,
  MAX_SPEED,
  predictBox,
  Tracker,
} from '../../src/content/media/tracks';

const face = (x: number, y: number, female?: number, w = 0.1, h = 0.15): Region => ({
  x,
  y,
  w,
  h,
  score: 0.95,
  ...(female === undefined ? {} : { female }),
});

describe('Tracker', () => {
  it('keeps identity while a face moves and learns its velocity', () => {
    const tracker = new Tracker();
    tracker.update('faces', [face(0.1, 0.2)], 0);
    const id = tracker.of('faces')[0]!.id;
    tracker.update('faces', [face(0.15, 0.2)], 200);
    tracker.update('faces', [face(0.2, 0.2)], 400);
    const [track] = tracker.of('faces');
    expect(track!.id).toBe(id);
    expect(track!.vx).toBeCloseTo(0.05 / 200, 6);
    expect(track!.vy).toBeCloseTo(0, 6);
    // Extrapolated 200 ms ahead: centre moved another 0.05, box grown.
    const predicted = predictBox(track!, 600);
    expect(predicted.x + predicted.w / 2).toBeCloseTo(0.25 + 0.05, 5);
    expect(predicted.w).toBeGreaterThan(0.1);
  });

  it('tells two people apart and creates tracks for newcomers', () => {
    const tracker = new Tracker();
    tracker.update('faces', [face(0.1, 0.2), face(0.7, 0.2)], 0);
    const [left, right] = tracker.of('faces').sort((a, b) => a.box.x - b.box.x);
    tracker.update('faces', [face(0.72, 0.2), face(0.12, 0.2), face(0.4, 0.6)], 200);
    const after = tracker.of('faces');
    expect(after).toHaveLength(3);
    expect(after.find((t) => t.id === left!.id)!.box.x).toBeCloseTo(0.12);
    expect(after.find((t) => t.id === right!.id)!.box.x).toBeCloseTo(0.72);
  });

  it('drops a track only after analyses stop finding it, never for slowness', () => {
    const tracker = new Tracker();
    tracker.update('faces', [face(0.3, 0.3)], 0);
    // No analysis for a long time: the track stays.
    expect(tracker.of('faces')).toHaveLength(1);
    tracker.update('faces', [], 400);
    expect(tracker.of('faces')).toHaveLength(1); // one miss
    tracker.update('faces', [], 800);
    expect(tracker.of('faces')).toHaveLength(0); // two misses
  });

  it('averages gender estimates, keeping them across face-only frames', () => {
    const tracker = new Tracker();
    tracker.update('faces', [face(0.3, 0.3, 0.9)], 0);
    tracker.update('faces', [face(0.31, 0.3)], 200); // faces only
    expect(tracker.of('faces')[0]!.female).toBeCloseTo(0.9);
    tracker.update('faces', [face(0.32, 0.3, 0.7)], 400);
    expect(tracker.of('faces')[0]!.female).toBeCloseTo(0.8);
    expect(tracker.needsGender(500, 1000)).toBe(false);
    expect(tracker.needsGender(2000, 1000)).toBe(true);
    tracker.update('faces', [face(0.32, 0.3), face(0.8, 0.3)], 600);
    expect(tracker.needsGender(700, 5000)).toBe(true); // the newcomer has no estimate
  });

  it('bounds speed and extrapolation', () => {
    const tracker = new Tracker();
    tracker.update('faces', [face(0.0, 0.2)], 0);
    tracker.update('faces', [face(0.08, 0.2)], 1); // implausible jump in 1 ms
    const track = tracker.of('faces')[0]!;
    expect(Math.abs(track.vx)).toBeLessThanOrEqual(MAX_SPEED);
    const far = predictBox(track, 1 + MAX_EXTRAPOLATE_MS * 10);
    const capped = predictBox(track, 1 + MAX_EXTRAPOLATE_MS);
    expect(far).toEqual(capped);
  });

  it('resets per kind', () => {
    const tracker = new Tracker();
    tracker.update('faces', [face(0.1, 0.1)], 0);
    tracker.update('people', [face(0.1, 0.1, undefined, 0.3, 0.8)], 0);
    tracker.reset('faces');
    expect(tracker.of('faces')).toHaveLength(0);
    expect(tracker.of('people')).toHaveLength(1);
  });
});

describe('video geometry', () => {
  it('letterboxes with object-fit: contain, centred by default', () => {
    // 16:9 video in a square box: bars above and below.
    expect(drawnFrameRect({ width: 400, height: 400 }, 1600, 900)).toEqual({ x: 0, y: 87.5, w: 400, h: 225 });
  });

  it('handles cover, fill, none and object-position', () => {
    expect(drawnFrameRect({ width: 400, height: 400 }, 1600, 900, 'cover')).toMatchObject({
      y: 0,
      h: 400,
      w: 711.1111111111111,
    });
    expect(drawnFrameRect({ width: 300, height: 200 }, 1600, 900, 'fill')).toEqual({
      x: 0,
      y: 0,
      w: 300,
      h: 200,
    });
    expect(drawnFrameRect({ width: 400, height: 400 }, 1600, 900, 'contain', 'left top')).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(drawnFrameRect({ width: 400, height: 400 }, 1600, 900, 'contain', '50% 100%').y).toBeCloseTo(175);
    expect(drawnFrameRect({ width: 400, height: 400 }, 100, 50, 'none')).toEqual({
      x: 150,
      y: 175,
      w: 100,
      h: 50,
    });
  });

  it('maps a padded frame box onto the element', () => {
    const frame = { x: 0, y: 50, w: 400, h: 200 };
    expect(boxOnElement(frame, { x: 0.5, y: 0.5, w: 0.1, h: 0.2 }, 0)).toEqual({
      x: 200,
      y: 150,
      w: 40,
      h: 40,
    });
    const padded = boxOnElement(frame, { x: 0.5, y: 0.5, w: 0.1, h: 0.2 }, 0.25);
    expect(padded.w).toBeCloseTo(60);
    expect(padded.x).toBeCloseTo(190);
  });
});
