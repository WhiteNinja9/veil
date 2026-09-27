/**
 * Pure post-processing for detector outputs. No TensorFlow.js dependency so
 * the math is unit-tested in isolation (tests/unit/postprocess.test.ts).
 */
import type { ClassifierScores, Region } from './types';

// ── Geometry ───────────────────────────────────────────────────────────────

export function iou(a: Region, b: Region): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Greedy non-maximum suppression; returns regions sorted by descending score. */
export function nonMaxSuppression(regions: Region[], iouThreshold: number, maxOutput: number): Region[] {
  const sorted = [...regions].sort((a, b) => b.score - a.score);
  const kept: Region[] = [];
  for (const candidate of sorted) {
    if (kept.length >= maxOutput) break;
    if (kept.every((k) => iou(k, candidate) <= iouThreshold)) kept.push(candidate);
  }
  return kept;
}

export function clampRegion(r: Region): Region | null {
  const x = Math.max(0, Math.min(1, r.x));
  const y = Math.max(0, Math.min(1, r.y));
  const right = Math.max(0, Math.min(1, r.x + r.w));
  const bottom = Math.max(0, Math.min(1, r.y + r.h));
  const w = right - x;
  const h = bottom - y;
  return w > 0.001 && h > 0.001 ? { x, y, w, h, score: r.score } : null;
}

// ── Letterboxing ───────────────────────────────────────────────────────────

/**
 * Detectors take square inputs. We pad (not stretch) to preserve face and
 * body proportions: the image occupies the top-left of a square canvas.
 * `scaleX/scaleY` convert coordinates normalised to the square back to
 * coordinates normalised to the original image.
 */
export function letterbox(width: number, height: number): { side: number; scaleX: number; scaleY: number } {
  const side = Math.max(width, height);
  return { side, scaleX: side / width, scaleY: side / height };
}

export function unletterbox(r: Region, box: { scaleX: number; scaleY: number }): Region {
  return {
    x: r.x * box.scaleX,
    y: r.y * box.scaleY,
    w: r.w * box.scaleX,
    h: r.h * box.scaleY,
    score: r.score,
  };
}

// ── BlazeFace ──────────────────────────────────────────────────────────────

export interface Anchor {
  x: number;
  y: number;
}

/**
 * SSD anchors for a single feature map: `perCell` anchors per grid cell,
 * centred in the cell, row-major. BlazeFace uses fixed-size anchors, so
 * only centres are needed.
 */
export function gridAnchors(gridSize: number, perCell: number): Anchor[] {
  const anchors: Anchor[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      for (let a = 0; a < perCell; a++) anchors.push({ x: (x + 0.5) / gridSize, y: (y + 0.5) / gridSize });
    }
  }
  return anchors;
}

const sigmoid = (v: number) => 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, v))));

/**
 * Decodes one BlazeFace output head.
 * @param logits   raw scores, one per anchor
 * @param boxes    regressors, `stride` values per anchor: [dx, dy, w, h, keypoints…] in input pixels
 * @param anchors  anchor centres for this head
 * @param inputSize model input side in pixels
 */
export function decodeBlazeFace(
  logits: ArrayLike<number>,
  boxes: ArrayLike<number>,
  anchors: Anchor[],
  inputSize: number,
  minScore: number,
  stride = 16,
): Region[] {
  const out: Region[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const score = sigmoid(logits[i] ?? -100);
    if (score < minScore) continue;
    const anchor = anchors[i]!;
    const o = i * stride;
    const cx = (boxes[o] ?? 0) / inputSize + anchor.x;
    const cy = (boxes[o + 1] ?? 0) / inputSize + anchor.y;
    const w = (boxes[o + 2] ?? 0) / inputSize;
    const h = (boxes[o + 3] ?? 0) / inputSize;
    if (w <= 0 || h <= 0) continue;
    out.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
  }
  return out;
}

// ── SSD (COCO) person extraction ───────────────────────────────────────────

/**
 * Extracts person candidates from COCO-SSD raw outputs.
 * @param scores  [numBoxes × numClasses] sigmoid scores; class 0 is "person"
 * @param boxes   [numBoxes × 4] as [yMin, xMin, yMax, xMax] normalised
 */
export function extractPersons(
  scores: ArrayLike<number>,
  boxes: ArrayLike<number>,
  numBoxes: number,
  numClasses: number,
  minScore: number,
): Region[] {
  const out: Region[] = [];
  for (let i = 0; i < numBoxes; i++) {
    const score = scores[i * numClasses] ?? 0;
    if (score < minScore) continue;
    const yMin = boxes[i * 4] ?? 0;
    const xMin = boxes[i * 4 + 1] ?? 0;
    const yMax = boxes[i * 4 + 2] ?? 0;
    const xMax = boxes[i * 4 + 3] ?? 0;
    const region = clampRegion({ x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin, score });
    if (region) out.push(region);
  }
  return out;
}

// ── Classifier ─────────────────────────────────────────────────────────────

export const CLASSIFIER_LABELS = ['drawing', 'hentai', 'neutral', 'porn', 'sexy'] as const;

export function toClassifierScores(row: ArrayLike<number>): ClassifierScores {
  return {
    drawing: row[0] ?? 0,
    hentai: row[1] ?? 0,
    neutral: row[2] ?? 0,
    porn: row[3] ?? 0,
    sexy: row[4] ?? 0,
  };
}

/**
 * Aggregates per-frame scores for animated images: each unsafe class takes
 * its maximum across frames (worst case), neutral/drawing take the minimum.
 */
export function aggregateFrames(frames: ClassifierScores[]): ClassifierScores {
  if (!frames.length) throw new RangeError('aggregateFrames: no frames');
  return {
    drawing: Math.min(...frames.map((f) => f.drawing)),
    neutral: Math.min(...frames.map((f) => f.neutral)),
    hentai: Math.max(...frames.map((f) => f.hentai)),
    porn: Math.max(...frames.map((f) => f.porn)),
    sexy: Math.max(...frames.map((f) => f.sexy)),
  };
}

/** Exponential moving average over classifier scores (temporal smoothing for video). */
export function emaScores(
  previous: ClassifierScores | null,
  next: ClassifierScores,
  alpha: number,
): ClassifierScores {
  if (!previous) return next;
  const mix = (a: number, b: number) => a * (1 - alpha) + b * alpha;
  return {
    drawing: mix(previous.drawing, next.drawing),
    hentai: mix(previous.hentai, next.hentai),
    neutral: mix(previous.neutral, next.neutral),
    porn: mix(previous.porn, next.porn),
    sexy: mix(previous.sexy, next.sexy),
  };
}
