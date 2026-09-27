/**
 * Face and person tracking between video analyses, and the geometry that
 * maps a tracked box onto the element the video is drawn in.
 *
 * Analyses arrive a few times per second; people move in between. Each
 * detection is matched to a track, which keeps a smoothed velocity so its
 * box can be extrapolated to the frame on screen, growing with the time
 * since it was last seen. A track is dropped only on evidence (later
 * analyses that no longer find it), never because analyses are slow.
 *
 * Pure and deterministic. Times are media time in milliseconds
 * (video.currentTime × 1000), so pausing, seeking and playback rate are
 * handled naturally: a paused video's boxes stay exactly where they were.
 */
import type { Region } from '../../ml/types';

export type TrackKind = 'faces' | 'people';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Track {
  id: number;
  kind: TrackKind;
  /** Last detected box, normalised to the video frame. */
  box: Box;
  score: number;
  /** Centre velocity, frame widths/heights per millisecond of media time. */
  vx: number;
  vy: number;
  /** Media time of the last detection. */
  seenAt: number;
  /** Consecutive analyses of this kind that did not find it. */
  missed: number;
  hits: number;
  /** Running estimate that the face appears female (faces only), when one exists. */
  female?: number;
  genderSamples: number;
  /** Media time of the last gender estimate. */
  genderAt?: number;
}

/** No one crosses the frame faster than this (frame units per ms: a full width in 400 ms). */
export const MAX_SPEED = 1 / 400;
/** Boxes are extrapolated at most this far past their last detection. */
export const MAX_EXTRAPOLATE_MS = 700;
/** Uncertainty growth: boxes widen by this fraction per second since last seen. */
export const GROWTH_PER_SECOND = 0.8;
/** A track is dropped after this many analyses in a row that did not find it… */
export const MISSES_TO_DROP = 2;
/** …or when analyses keep running and it has not been seen for this long. */
export const MAX_UNSEEN_MS = 2500;
/** Gender estimates are averaged over at most this many samples (recent ones matter). */
const GENDER_WINDOW = 5;

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Where a track's box is expected at media time `at`, grown for the uncertainty since it was seen. */
export function predictBox(track: Track, at: number): Box {
  const dt = clamp(at - track.seenAt, 0, MAX_EXTRAPOLATE_MS);
  const c = centre(track.box);
  const cx = c.x + track.vx * dt;
  const cy = c.y + track.vy * dt;
  const growth = 1 + (GROWTH_PER_SECOND * dt) / 1000;
  // Motion uncertainty: half the distance travelled, on each side.
  const w = track.box.w * growth + Math.abs(track.vx) * dt;
  const h = track.box.h * growth + Math.abs(track.vy) * dt;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function matchScore(predicted: Box, detection: Box): number {
  const overlap = iou(predicted, detection);
  if (overlap >= 0.15) return 1 + overlap;
  const a = centre(predicted);
  const b = centre(detection);
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const reach = 0.75 * Math.max(predicted.w, predicted.h, detection.w, detection.h);
  return distance <= reach ? 1 - distance / reach : 0;
}

export class Tracker {
  private tracks: Track[] = [];
  private nextId = 1;

  get all(): readonly Track[] {
    return this.tracks;
  }

  of(kind: TrackKind): Track[] {
    return this.tracks.filter((t) => t.kind === kind);
  }

  reset(kind?: TrackKind): void {
    this.tracks = kind ? this.tracks.filter((t) => t.kind !== kind) : [];
  }

  /**
   * Folds one analysis into the tracks of `kind`. Detections carrying a
   * `female` estimate update their track's running gender estimate; frames
   * analysed for faces only keep the estimates tracks already have.
   */
  update(kind: TrackKind, detections: readonly Region[], at: number): void {
    const own = this.of(kind);
    const others = this.tracks.filter((t) => t.kind !== kind);
    const candidates: { track: Track; detection: number; score: number }[] = [];
    own.forEach((track) => {
      const predicted = predictBox(track, at);
      detections.forEach((d, i) => {
        const score = matchScore(predicted, d);
        if (score > 0) candidates.push({ track, detection: i, score });
      });
    });
    candidates.sort((a, b) => b.score - a.score);
    const matchedTracks = new Set<Track>();
    const matchedDetections = new Set<number>();
    for (const { track, detection } of candidates) {
      if (matchedTracks.has(track) || matchedDetections.has(detection)) continue;
      matchedTracks.add(track);
      matchedDetections.add(detection);
      this.refresh(track, detections[detection]!, at);
    }
    const kept = own.filter((track) => {
      if (matchedTracks.has(track)) return true;
      track.missed++;
      return track.missed < MISSES_TO_DROP && at - track.seenAt < MAX_UNSEEN_MS;
    });
    detections.forEach((d, i) => {
      if (matchedDetections.has(i)) return;
      kept.push({
        id: this.nextId++,
        kind,
        box: { x: d.x, y: d.y, w: d.w, h: d.h },
        score: d.score,
        vx: 0,
        vy: 0,
        seenAt: at,
        missed: 0,
        hits: 1,
        genderSamples: d.female === undefined ? 0 : 1,
        ...(d.female === undefined ? {} : { female: d.female, genderAt: at }),
      });
    });
    this.tracks = [...others, ...kept];
  }

  private refresh(track: Track, d: Region, at: number): void {
    const dt = at - track.seenAt;
    if (dt > 0) {
      const before = centre(track.box);
      const after = centre(d);
      const vx = clamp((after.x - before.x) / dt, -MAX_SPEED, MAX_SPEED);
      const vy = clamp((after.y - before.y) / dt, -MAX_SPEED, MAX_SPEED);
      track.vx = track.hits > 1 ? 0.5 * track.vx + 0.5 * vx : vx;
      track.vy = track.hits > 1 ? 0.5 * track.vy + 0.5 * vy : vy;
    }
    track.box = { x: d.x, y: d.y, w: d.w, h: d.h };
    track.score = d.score;
    track.seenAt = at;
    track.missed = 0;
    track.hits++;
    if (d.female !== undefined) {
      const n = Math.min(track.genderSamples, GENDER_WINDOW - 1);
      track.female = track.female === undefined ? d.female : (track.female * n + d.female) / (n + 1);
      track.genderSamples++;
      track.genderAt = at;
    }
  }

  /** Face tracks that have no gender estimate yet, or whose estimate is older than `maxAgeMs`. */
  needsGender(at: number, maxAgeMs: number): boolean {
    return this.of('faces').some((t) => t.genderAt === undefined || at - t.genderAt > maxAgeMs);
  }
}

// ── Geometry ────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Parses one CSS object-position component into a fraction of the free space (or px). */
function positionComponent(token: string | undefined): { frac: number } | { px: number } {
  switch (token) {
    case undefined:
    case 'center':
      return { frac: 0.5 };
    case 'left':
    case 'top':
      return { frac: 0 };
    case 'right':
    case 'bottom':
      return { frac: 1 };
  }
  if (token.endsWith('%')) return { frac: Number.parseFloat(token) / 100 };
  if (token.endsWith('px')) return { px: Number.parseFloat(token) };
  return { frac: 0.5 };
}

/**
 * Where the video frame is drawn inside an element's content box, per CSS
 * object-fit / object-position (videos default to `contain`, centred).
 */
export function drawnFrameRect(
  box: { width: number; height: number },
  videoWidth: number,
  videoHeight: number,
  objectFit = 'contain',
  objectPosition = '50% 50%',
): Rect {
  if (!videoWidth || !videoHeight) return { x: 0, y: 0, w: box.width, h: box.height };
  const contain = Math.min(box.width / videoWidth, box.height / videoHeight);
  const cover = Math.max(box.width / videoWidth, box.height / videoHeight);
  let w: number;
  let h: number;
  switch (objectFit) {
    case 'fill':
      return { x: 0, y: 0, w: box.width, h: box.height };
    case 'cover':
      w = videoWidth * cover;
      h = videoHeight * cover;
      break;
    case 'none':
      w = videoWidth;
      h = videoHeight;
      break;
    case 'scale-down':
      w = videoWidth * Math.min(1, contain);
      h = videoHeight * Math.min(1, contain);
      break;
    default:
      w = videoWidth * contain;
      h = videoHeight * contain;
  }
  const [px, py] = objectPosition.trim().split(/\s+/);
  const place = (token: string | undefined, free: number) => {
    const p = positionComponent(token);
    return 'px' in p ? p.px : free * p.frac;
  };
  return { x: place(px, box.width - w), y: place(py, box.height - h), w, h };
}

/** A normalised frame box, padded, in element-local pixels (unclipped). */
export function boxOnElement(frame: Rect, box: Box, pad: number): Rect {
  const x = box.x - box.w * pad;
  const y = box.y - box.h * pad;
  const w = box.w * (1 + 2 * pad);
  const h = box.h * (1 + 2 * pad);
  return { x: frame.x + x * frame.w, y: frame.y + y * frame.h, w: w * frame.w, h: h * frame.h };
}
