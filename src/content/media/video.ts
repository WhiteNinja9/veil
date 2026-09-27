/**
 * VideoProtectionManager — continuous, budgeted protection for <video>.
 *
 * Nothing runs inference on every frame. Each tick (5 Hz) we compute a
 * 64-bit perceptual signature of each *visible, playing* video from a 9×8
 * thumbnail (microseconds), and only send a frame for inference when:
 *   - the scene changed (signature Hamming distance above threshold), or
 *   - the adaptive interval elapsed.
 *
 * The interval adapts to what we see: suspicious frames (high "pressure"
 * relative to thresholds) drop it to ¼ of the base; a long run of clearly
 * safe frames stretches it to 3×. Paused, hidden or off-screen videos cost
 * nothing. A global token bucket caps inference per frame (the page) so
 * feeds with many autoplaying videos stay smooth; fullscreen and larger
 * videos are served first.
 *
 * Protection engages on a single unsafe frame (fast onset) and — when
 * auto-restore is enabled — lifts only after several consecutive safe
 * frames whose smoothed scores are also safe (hysteresis), so rapid cuts
 * cannot flicker content into view.
 */
import { evaluate } from '../../policy/engine';
import type { Decision, EffectivePolicy } from '../../policy/types';
import type { ClassifierScores, DetectResponse, Signals } from '../../ml/types';
import { emaScores } from '../../ml/postprocess';
import { colorDistance, type FrameSignature, hammingDistance, hashString } from '../../shared/hash';
import { createLogger } from '../../shared/logger';
import { captureElement, frameSignature } from './capture';

const log = createLogger('video');
import type { MediaItem } from './item';

export const TICK_MS = 200;
export const SCENE_CHANGE_BITS = 12;
/** Mean-colour shift (0–255 per channel) that also counts as a scene change. */
export const SCENE_CHANGE_COLOR = 12;
export const SAFE_FRAMES_TO_RESTORE = 3;
export const MIN_PROTECTED_MS = 2000;
/** Even on scene changes, a video is analysed at most this often. */
export const MIN_GAP_MS = 250;
const TOKENS_PER_SECOND = 4;
const FRAME_MAX_SIDE = 256;

export interface VideoHost {
  policy(): EffectivePolicy;
  detectFrame(
    item: MediaItem,
    dataUrl: string,
    width: number,
    height: number,
    key: string,
  ): Promise<DetectResponse>;
  detectUrl(item: MediaItem, url: string): Promise<DetectResponse>;
  apply(item: MediaItem, decision: Decision): void;
  pending(item: MediaItem): void;
  fallback(item: MediaItem): void;
  onAnalyzed(item: MediaItem, signals: Signals): void;
}

interface VideoState {
  item: MediaItem;
  video: HTMLVideoElement;
  signature: FrameSignature | null;
  lastAnalyzedAt: number;
  interval: number;
  inflight: boolean;
  safeStreak: number;
  ema: ClassifierScores | null;
  protectedAt: number;
  tainted: boolean;
  /** currentSrc for which a first verdict exists. */
  verifiedSrc: string | null;
  abort: AbortController;
}

export class VideoProtectionManager {
  private readonly videos = new Map<HTMLVideoElement, VideoState>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tokens = TOKENS_PER_SECOND;
  private lastRefill = performance.now();
  private active = true;

  constructor(private readonly host: VideoHost) {}

  get count(): number {
    return this.videos.size;
  }

  track(item: MediaItem): void {
    const video = item.el as HTMLVideoElement;
    if (this.videos.has(video)) return;
    const state: VideoState = {
      item,
      video,
      signature: null,
      lastAnalyzedAt: 0,
      interval: this.host.policy().video.baseIntervalMs,
      inflight: false,
      safeStreak: 0,
      ema: null,
      protectedAt: 0,
      tainted: false,
      verifiedSrc: null,
      abort: new AbortController(),
    };
    this.videos.set(video, state);
    const opts = { signal: state.abort.signal, passive: true } as const;
    // `play` fires before the first new frame is presented: hide first, verify, then show.
    video.addEventListener('play', () => this.onPlaybackIntent(state), opts);
    video.addEventListener('loadeddata', () => this.onFrameAvailable(state), opts);
    video.addEventListener('playing', () => this.onFrameAvailable(state), opts);
    video.addEventListener('seeked', () => this.sampleSoon(state), opts);
    video.addEventListener('pause', () => this.sampleSoon(state), opts);
    video.addEventListener('emptied', () => this.reset(state), opts);
    this.initial(state);
    this.ensureTicking();
  }

  untrack(video: HTMLVideoElement): void {
    const state = this.videos.get(video);
    if (!state) return;
    state.abort.abort();
    this.videos.delete(video);
  }

  /** Source attribute changed (src / poster). */
  sourceChanged(video: HTMLVideoElement): void {
    const state = this.videos.get(video);
    if (state) this.reset(state);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.ensureTicking();
    else clearTimeout(this.timer);
  }

  /** Re-applies the current policy to every tracked video (e.g. strictness changed). */
  reevaluate(): void {
    for (const state of this.videos.values()) {
      state.interval = this.host.policy().video.baseIntervalMs;
      state.lastAnalyzedAt = 0;
    }
  }

  stop(): void {
    clearTimeout(this.timer);
    for (const state of this.videos.values()) state.abort.abort();
    this.videos.clear();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  private initial(state: VideoState): void {
    const { video, item } = state;
    item.src = video.currentSrc || video.src || video.poster || '';
    if (video.readyState >= 2 && video.videoWidth) {
      this.host.pending(item);
      this.sampleSoon(state, true);
    } else if (video.poster) {
      this.host.pending(item);
      void this.analyzePoster(state);
    } else {
      // Nothing can be displayed yet; show the (empty) element and verify on playback.
      this.host.apply(item, { action: 'allow', reasons: [], confidence: 0, pressure: 0 });
    }
  }

  private reset(state: VideoState): void {
    state.signature = null;
    state.ema = null;
    state.safeStreak = 0;
    state.verifiedSrc = null;
    state.tainted = false;
    state.item.revealed = false;
    state.item.decision = undefined;
    this.initial(state);
  }

  private onPlaybackIntent(state: VideoState): void {
    const src = state.video.currentSrc;
    // Unreadable (cross-origin) video keeps its fallback decision across loops/replays.
    if (state.tainted || state.item.revealed || (state.verifiedSrc && state.verifiedSrc === src)) return;
    this.host.pending(state.item);
    if (state.video.readyState >= 2) this.sampleSoon(state, true);
  }

  private onFrameAvailable(state: VideoState): void {
    if (state.item.revealed || state.tainted) return;
    if (state.verifiedSrc !== state.video.currentSrc) {
      this.host.pending(state.item);
      this.sampleSoon(state, true);
    }
  }

  private sampleSoon(state: VideoState, force = false): void {
    if (force) state.lastAnalyzedAt = 0;
    queueMicrotask(() => void this.sample(state, force));
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

  private ensureTicking(): void {
    if (this.timer || !this.active || !this.videos.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.tick();
      this.ensureTicking();
    }, TICK_MS);
  }

  private refill(): void {
    const now = performance.now();
    this.tokens = Math.min(
      TOKENS_PER_SECOND,
      this.tokens + ((now - this.lastRefill) / 1000) * TOKENS_PER_SECOND,
    );
    this.lastRefill = now;
  }

  private tick(): void {
    if (document.visibilityState !== 'visible') return;
    for (const video of [...this.videos.keys()]) {
      if (!video.isConnected) this.untrack(video);
    }
    // Fullscreen first, then the most overdue (relative to its own interval),
    // so one busy video cannot starve the others of the shared budget.
    const fullscreen = document.fullscreenElement;
    const now = performance.now();
    const candidates = [...this.videos.values()]
      .filter(
        (s) =>
          !s.video.paused &&
          !s.video.ended &&
          (s.item.visible || (fullscreen && fullscreen.contains(s.video))),
      )
      .sort((a, b) => urgency(b, fullscreen, now) - urgency(a, fullscreen, now));
    for (const state of candidates) void this.sample(state, false);
  }

  private async sample(state: VideoState, force: boolean): Promise<void> {
    const { video, item } = state;
    if (state.inflight || state.tainted || item.revealed) return;
    if (!force && !item.visible && !(document.fullscreenElement?.contains(video) ?? false)) return;

    const signature = frameSignature(video);
    if (signature === 'tainted') {
      this.onTainted(state);
      return;
    }
    if (!signature) return;

    const now = performance.now();
    if (!force && now - state.lastAnalyzedAt < MIN_GAP_MS) return;
    const changed =
      !state.signature ||
      hammingDistance(signature, state.signature) > SCENE_CHANGE_BITS ||
      colorDistance(signature, state.signature) > SCENE_CHANGE_COLOR;
    const due = now - state.lastAnalyzedAt >= state.interval;
    if (!force && !changed && !due) return;

    this.refill();
    if (!force && this.tokens < 1) return;
    this.tokens = Math.max(0, this.tokens - 1);

    const capture = await captureElement(video, FRAME_MAX_SIDE, 0.8);
    if (capture === 'tainted') {
      this.onTainted(state);
      return;
    }
    if (!capture) return;

    state.inflight = true;
    state.signature = signature;
    state.lastAnalyzedAt = now;
    const src = video.currentSrc;
    try {
      // Frames are keyed by source and timestamp — never by perceptual hash:
      // two different frames can share a hash, and reusing a safe verdict for
      // an unsafe frame is exactly the failure this component exists to prevent.
      const key = `vf:${hashString(src)}:${video.currentTime.toFixed(2)}`;
      const response = await this.host.detectFrame(item, capture.dataUrl, capture.width, capture.height, key);
      if (video.currentSrc !== src) return; // source switched while analysing
      if (!response.ok) {
        if (!state.verifiedSrc) this.host.fallback(item);
        return;
      }
      this.onSignals(state, response.signals);
    } finally {
      state.inflight = false;
    }
  }

  // ── Decisions ──────────────────────────────────────────────────────────

  private onSignals(state: VideoState, signals: Signals): void {
    const policy = this.host.policy();
    const context = {
      kind: 'video' as const,
      renderedSize: state.item.renderedSize,
      isAd: Boolean(state.item.isAd),
    };
    const now = performance.now();
    const current = evaluate(signals, context, policy);
    if (signals.classifier) state.ema = emaScores(state.ema, signals.classifier, 0.5);
    const smoothed = state.ema ? evaluate({ ...signals, classifier: state.ema }, context, policy) : current;

    this.host.onAnalyzed(state.item, signals);
    if (__DEV__)
      log.debug(
        'frame',
        state.video.id || state.video.currentSrc.slice(-30),
        current.action,
        `porn=${signals.classifier?.porn.toFixed(2)}`,
        `interval=${state.interval}`,
      );
    const wasProtected = state.item.decision?.action === 'protect' && state.verifiedSrc !== null;
    state.verifiedSrc = state.video.currentSrc;

    if (current.action !== 'allow') {
      state.safeStreak = 0;
      if (!wasProtected) state.protectedAt = now;
      state.item.decision = current;
      this.host.apply(state.item, current);
    } else if (wasProtected) {
      state.safeStreak++;
      const canRestore =
        policy.video.autoRestore &&
        state.safeStreak >= SAFE_FRAMES_TO_RESTORE &&
        now - state.protectedAt >= MIN_PROTECTED_MS &&
        smoothed.action === 'allow';
      if (canRestore) {
        state.item.decision = current;
        this.host.apply(state.item, current);
      }
    } else {
      state.safeStreak++;
      state.item.decision = current;
      this.host.apply(state.item, current);
    }

    state.interval = adaptiveInterval(
      policy.video.baseIntervalMs,
      Math.max(current.pressure, smoothed.pressure),
      state.safeStreak,
    );
  }

  private async analyzePoster(state: VideoState): Promise<void> {
    const poster = state.video.poster;
    if (!poster) return;
    const response = await this.host.detectUrl(state.item, poster);
    if (state.video.poster !== poster || state.verifiedSrc) return;
    if (!response.ok) {
      this.host.fallback(state.item);
      return;
    }
    this.host.onAnalyzed(state.item, response.signals);
    const decision = evaluate(
      response.signals,
      { kind: 'video', renderedSize: state.item.renderedSize, isAd: Boolean(state.item.isAd) },
      this.host.policy(),
    );
    state.item.decision = decision;
    this.host.apply(state.item, decision);
  }

  private onTainted(state: VideoState): void {
    // Cross-origin video without CORS: frames are unreadable by design.
    // The user's fallback policy decides (Balanced: show; Strict: protect).
    if (state.tainted) return;
    state.tainted = true;
    state.verifiedSrc = state.video.currentSrc;
    state.item.unverifiable = true;
    this.host.fallback(state.item);
  }
}

function urgency(state: VideoState, fullscreen: Element | null, now: number): number {
  if (fullscreen && fullscreen.contains(state.video)) return Number.MAX_SAFE_INTEGER;
  // Overdue ratio, with a mild preference for larger videos.
  return (
    ((now - state.lastAnalyzedAt) / state.interval) * (1 + Math.min(state.item.renderedSize, 1200) / 2400)
  );
}

/** Adaptive sampling interval (exported for tests). */
export function adaptiveInterval(base: number, pressure: number, safeStreak: number): number {
  if (pressure >= 0.5) return Math.max(250, Math.round(base / 4));
  if (pressure >= 0.3) return Math.max(250, Math.round(base / 2));
  if (safeStreak >= 10) return base * 3;
  if (safeStreak >= 5) return base * 2;
  return base;
}
