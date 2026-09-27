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
 *
 * Region mode (Faces / People with "Also in videos", scope "regions"):
 * matching people are blurred while the video plays, instead of the whole
 * video being hidden. A per-frame callback watches for scene cuts (the
 * frame is covered until the new shot is analysed) and paces analyses at
 * up to ~5 per second; faces are tracked between analyses (tracks.ts) and
 * drawn over by VideoRegionOverlay. Apparent gender is estimated once per
 * new face and refreshed every few seconds, not on every frame.
 */
import { evaluate, requiredSignals, selectRegions } from '../../policy/engine';
import type { Decision, EffectivePolicy, Reason } from '../../policy/types';
import type { ClassifierScores, DetectResponse, Region, SignalKind, Signals } from '../../ml/types';
import { emaScores } from '../../ml/postprocess';
import { colorDistance, type FrameSignature, hammingDistance, hashString } from '../../shared/hash';
import { createLogger } from '../../shared/logger';
import { VideoRegionOverlay } from '../render/video-overlay';
import { captureElement, frameSignature } from './capture';
import { MAX_UNSEEN_MS, predictBox, type Track, Tracker } from './tracks';

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
/**
 * Region tracking needs more frequent analyses, mostly face detection only:
 * its own page-wide budget, shared by every video in region mode.
 */
const REGION_TOKENS_PER_SECOND = 10;
const FRAME_MAX_SIDE = 256;
/**
 * Frames for face / person / gender analysis need more detail. 480 px keeps
 * each frame to a single face-detection pass (the worker tiles above that).
 */
const FRAME_MAX_SIDE_REGIONS = 480;
/** Region mode: media time between analyses (at most ~5 per second per video). */
export const TRACK_INTERVAL_MS = 200;
/** Region mode: people (bodies) are detected less often and extrapolated in between. */
export const PEOPLE_INTERVAL_MS = 600;
/** Region mode: a face's apparent gender is re-estimated this often. */
export const GENDER_REFRESH_MS = 3000;
/** Frame-to-frame change that counts as a cut (stricter than the sampling threshold). */
export const CUT_BITS = 20;
export const CUT_COLOR = 28;
const FACE_PAD = 0.28;
const BODY_PAD = 0.08;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Faces / People blur regions of the video rather than hiding all of it. */
export function videoRegionMode(policy: EffectivePolicy): boolean {
  const { faces, people } = policy.categories;
  return (
    policy.video.peopleInVideos &&
    ((faces.enabled && faces.scope === 'regions') || (people.enabled && people.scope === 'regions'))
  );
}

/**
 * The frame on screen is far from the last analysed one: the video looped or
 * was seeked, and the browser can present that frame before the `seeking`
 * event arrives. The tracks describe another moment, so the frame is covered.
 */
function timeJumped(state: { lastTrackAt: number }, at: number): boolean {
  if (!Number.isFinite(state.lastTrackAt)) return false;
  return at < state.lastTrackAt - 50 || at - state.lastTrackAt > MAX_UNSEEN_MS;
}

/** The policy for whole-video decisions when region-scoped categories are drawn as regions. */
function wholeOnly(policy: EffectivePolicy): EffectivePolicy {
  const { faces, people } = policy.categories;
  return {
    ...policy,
    categories: {
      ...policy.categories,
      faces: faces.scope === 'regions' ? { ...faces, enabled: false } : faces,
      people: people.scope === 'regions' ? { ...people, enabled: false } : people,
    },
  };
}

export interface VideoHost {
  policy(): EffectivePolicy;
  detectFrame(
    item: MediaItem,
    dataUrl: string,
    width: number,
    height: number,
    key: string,
    signals?: SignalKind[],
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
  // Region mode
  tracker: Tracker;
  /** Track ids currently blurred. */
  selected: Set<number>;
  /** Media time (ms) of the last region analysis frame. */
  lastTrackAt: number;
  lastPeopleAt: number;
  peopleSeen: boolean;
  lastClassifierAt: number;
  lastClassifier: ClassifierScores | null;
  /** Whole frame covered after a cut or seek, until a frame from after it is analysed. */
  cover: boolean;
  coverAt: number;
  frameSig: FrameSignature | null;
  frameLoop: number | null;
  /** Bumped on every seek: analyses of frames from before it are dropped. */
  seekEpoch: number;
  /** A forced analysis arrived while another was running; run it when that one ends. */
  resample: boolean;
}

export class VideoProtectionManager {
  private readonly videos = new Map<HTMLVideoElement, VideoState>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tokens = TOKENS_PER_SECOND;
  private regionTokens = REGION_TOKENS_PER_SECOND;
  private lastRegionRefill = performance.now();
  private lastRefill = performance.now();
  private active = true;
  private readonly overlay: VideoRegionOverlay;

  constructor(private readonly host: VideoHost) {
    this.overlay = new VideoRegionOverlay(() => this.host.policy().style);
  }

  /** Boxes currently drawn over a video (diagnostics, tests). */
  regionsDrawn(video: HTMLVideoElement): number {
    return this.overlay.drawn(video);
  }

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
      tracker: new Tracker(),
      selected: new Set(),
      lastTrackAt: -Infinity,
      lastPeopleAt: -Infinity,
      peopleSeen: false,
      lastClassifierAt: -Infinity,
      lastClassifier: null,
      cover: false,
      coverAt: 0,
      frameSig: null,
      frameLoop: null,
      seekEpoch: 0,
      resample: false,
    };
    this.videos.set(video, state);
    const opts = { signal: state.abort.signal, passive: true } as const;
    // `play` fires before the first new frame is presented: hide first, verify, then show.
    video.addEventListener('play', () => this.onPlaybackIntent(state), opts);
    video.addEventListener('loadeddata', () => this.onFrameAvailable(state), opts);
    video.addEventListener('playing', () => this.onFrameAvailable(state), opts);
    // After a seek the tracks are gone: re-check the new frame even when paused.
    video.addEventListener('seeked', () => this.sampleSoon(state, videoRegionMode(this.host.policy())), opts);
    video.addEventListener('pause', () => this.sampleSoon(state), opts);
    video.addEventListener('emptied', () => this.reset(state), opts);
    video.addEventListener('seeking', () => this.onSeeking(state), opts);
    this.syncRegionMode(state);
    this.initial(state);
    this.ensureTicking();
  }

  untrack(video: HTMLVideoElement): void {
    const state = this.videos.get(video);
    if (!state) return;
    state.abort.abort();
    this.stopFrames(state);
    this.overlay.detach(video);
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
      state.lastTrackAt = -Infinity;
      state.lastClassifierAt = -Infinity;
      this.syncRegionMode(state);
      // Re-decide now, even when paused (e.g. the people filter changed).
      if (state.video.readyState >= 2 && !state.tainted) this.sampleSoon(state, true);
    }
  }

  stop(): void {
    clearTimeout(this.timer);
    for (const state of this.videos.values()) {
      state.abort.abort();
      this.stopFrames(state);
    }
    this.overlay.stop();
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
    state.tracker.reset();
    state.selected.clear();
    state.lastTrackAt = -Infinity;
    state.lastPeopleAt = -Infinity;
    state.peopleSeen = false;
    state.lastClassifier = null;
    state.lastClassifierAt = -Infinity;
    state.cover = false;
    state.frameSig = null;
    state.seekEpoch++;
    state.resample = false;
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

  // ── Region mode ────────────────────────────────────────────────────────

  /** Starts or stops region tracking for a video as the policy changes. */
  private syncRegionMode(state: VideoState): void {
    if (videoRegionMode(this.host.policy())) {
      this.overlay.attach(state.video, {
        boxes: (at) => this.boxesFor(state, at),
        cover: (at) => state.item.decision?.action !== 'protect' && (state.cover || timeJumped(state, at)),
        hidden: () => state.item.revealed || state.item.decision?.action === 'protect',
      });
      this.watchFrames(state);
    } else {
      this.overlay.detach(state.video);
      this.stopFrames(state);
      state.selected.clear();
    }
  }

  private boxesFor(state: VideoState, at: number) {
    if (state.item.decision?.action !== 'regions' || state.item.revealed) return [];
    return state.tracker.all
      .filter((track) => state.selected.has(track.id))
      .map((track) => ({
        id: track.id,
        box: predictBox(track, at),
        pad: track.kind === 'faces' ? FACE_PAD : BODY_PAD,
        shape: track.kind === 'faces' ? ('face' as const) : ('body' as const),
      }));
  }

  /** Per presented frame: detect cuts, and pace analyses in media time. */
  private watchFrames(state: VideoState): void {
    const video = state.video as VideoWithFrameCallback;
    if (!video.requestVideoFrameCallback || state.frameLoop !== null) return;
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      state.frameLoop = null;
      if (!this.videos.has(state.video) || !videoRegionMode(this.host.policy())) return;
      if (!state.tainted && !state.item.revealed) this.onPresentedFrame(state, metadata.mediaTime * 1000);
      state.frameLoop = video.requestVideoFrameCallback!(onFrame);
    };
    state.frameLoop = video.requestVideoFrameCallback(onFrame);
  }

  private stopFrames(state: VideoState): void {
    const video = state.video as VideoWithFrameCallback;
    if (state.frameLoop !== null) video.cancelVideoFrameCallback?.(state.frameLoop);
    state.frameLoop = null;
  }

  private onPresentedFrame(state: VideoState, at: number): void {
    const signature = frameSignature(state.video);
    if (signature === 'tainted') {
      this.onTainted(state);
      return;
    }
    if (signature) {
      const cut =
        state.frameSig !== null &&
        (hammingDistance(signature, state.frameSig) > CUT_BITS ||
          colorDistance(signature, state.frameSig) > CUT_COLOR);
      state.frameSig = signature;
      if (cut && state.item.decision) {
        // A new shot: whoever is in it hasn't been checked yet.
        state.cover = true;
        state.coverAt = at;
        state.tracker.reset();
        void this.sampleRegions(state, true);
        return;
      }
    }
    void this.sampleRegions(state, false);
  }

  private onSeeking(state: VideoState): void {
    if (!videoRegionMode(this.host.policy())) return;
    state.tracker.reset();
    state.cover = true;
    state.coverAt = state.video.currentTime * 1000;
    state.lastTrackAt = -Infinity;
    state.seekEpoch++;
  }

  private regionSignals(
    state: VideoState,
    policy: EffectivePolicy,
    at: number,
    force: boolean,
  ): SignalKind[] {
    const kinds: SignalKind[] = [];
    const c = policy.categories;
    const who = policy.peopleFilter.who;
    const classifierDue =
      !state.lastClassifier || performance.now() - state.lastClassifierAt >= state.interval;
    if ((c.explicit.enabled || c.illustrated.enabled || c.suggestive.enabled) && (force || classifierDue))
      kinds.push('classifier');
    if (c.faces.enabled || (c.people.enabled && who !== 'everyone')) {
      const gender = who !== 'everyone' && (force || state.tracker.needsGender(at, GENDER_REFRESH_MS));
      kinds.push(gender ? 'gender' : 'faces');
    }
    if (
      c.people.enabled &&
      (force || !state.peopleSeen || Math.abs(at - state.lastPeopleAt) >= PEOPLE_INTERVAL_MS)
    )
      kinds.push('people');
    return kinds;
  }

  private async sampleRegions(state: VideoState, force: boolean): Promise<void> {
    const { video, item } = state;
    if (state.tainted || item.revealed) return;
    if (state.inflight) {
      if (force) state.resample = true;
      return;
    }
    if (!force && (video.paused || video.ended)) return;
    // Off-screen videos aren't analysed; when they come back, the jump in
    // media time covers the frame until they are.
    if (!force && !item.visible && !(document.fullscreenElement?.contains(video) ?? false)) return;
    const at = video.currentTime * 1000;
    if (!force && at >= state.lastTrackAt && at - state.lastTrackAt < TRACK_INTERVAL_MS) return;
    const epoch = state.seekEpoch;
    const policy = this.host.policy();
    const kinds = this.regionSignals(state, policy, at, force);
    if (!kinds.length || !this.takeRegionToken(force)) return;
    state.inflight = true;
    try {
      const capture = await captureElement(video, FRAME_MAX_SIDE_REGIONS, 0.8);
      if (capture === 'tainted') {
        this.onTainted(state);
        return;
      }
      if (!capture) return;
      state.lastTrackAt = at;
      state.lastAnalyzedAt = performance.now();
      const src = video.currentSrc;
      const key = `vr:${hashString(src)}:${Math.round(at)}`;
      const response = await this.host.detectFrame(
        item,
        capture.dataUrl,
        capture.width,
        capture.height,
        key,
        kinds,
      );
      if (video.currentSrc !== src) return;
      if (state.seekEpoch !== epoch) {
        // The video was seeked meanwhile: this frame is no longer the one on screen.
        state.resample = true;
        return;
      }
      if (!response.ok) {
        if (!state.verifiedSrc) this.host.fallback(item);
        return;
      }
      if (kinds.includes('classifier')) state.lastClassifierAt = performance.now();
      if (kinds.includes('people')) state.lastPeopleAt = at;
      this.onRegionSignals(state, response.signals, at);
    } finally {
      state.inflight = false;
      if (state.resample) {
        state.resample = false;
        this.sampleSoon(state, true);
      }
    }
  }

  /** Tracked faces and people as signals the policy engine understands, with their owners. */
  private trackedSignals(state: VideoState, frame: Signals): { signals: Signals; owner: Map<Region, Track> } {
    const owner = new Map<Region, Track>();
    const asRegion = (track: Track): Region => {
      const region: Region = {
        ...track.box,
        score: track.score,
        ...(track.female === undefined ? {} : { female: track.female }),
      };
      owner.set(region, track);
      return region;
    };
    const faces = state.tracker.of('faces').map(asRegion);
    const people = state.peopleSeen ? state.tracker.of('people').map(asRegion) : undefined;
    const signals: Signals = { ...frame, faces, gender: faces };
    if (people) signals.people = people;
    const classifier = frame.classifier ?? state.lastClassifier;
    if (classifier) signals.classifier = classifier;
    return { signals, owner };
  }

  private onRegionSignals(state: VideoState, frame: Signals, at: number): void {
    const policy = this.host.policy();
    const { item, video } = state;
    if (frame.classifier) {
      state.lastClassifier = frame.classifier;
      state.ema = emaScores(state.ema, frame.classifier, 0.5);
    }
    const faces = frame.gender ?? frame.faces;
    if (faces) state.tracker.update('faces', faces, at);
    if (frame.people) {
      state.tracker.update('people', frame.people, at);
      state.peopleSeen = true;
    }
    if (state.cover && at >= state.coverAt) state.cover = false;

    const { signals, owner } = this.trackedSignals(state, frame);
    const context = { kind: 'video' as const, renderedSize: item.renderedSize, isAd: Boolean(item.isAd) };
    const overlay = this.overlay.canOverlay(video);
    const wholePolicy = overlay ? wholeOnly(policy) : policy;
    const whole = evaluate(signals, context, wholePolicy);
    this.host.onAnalyzed(item, frame);

    const now = performance.now();
    const wasProtected = item.decision?.action === 'protect' && state.verifiedSrc !== null;
    state.verifiedSrc = video.currentSrc;
    if (whole.action === 'protect') {
      state.safeStreak = 0;
      if (!wasProtected) state.protectedAt = now;
      item.decision = whole;
      this.host.apply(item, whole);
      if (frame.classifier) state.interval = adaptiveInterval(policy.video.baseIntervalMs, whole.pressure, 0);
      return;
    }
    if (wasProtected) {
      // Only frames the content classifier looked at can lift whole-video protection.
      if (!frame.classifier) return;
      state.safeStreak++;
      const smoothed = state.ema
        ? evaluate({ ...signals, classifier: state.ema }, context, wholePolicy)
        : whole;
      const canRestore =
        policy.video.autoRestore &&
        state.safeStreak >= SAFE_FRAMES_TO_RESTORE &&
        now - state.protectedAt >= MIN_PROTECTED_MS &&
        smoothed.action === 'allow';
      if (!canRestore) return;
    } else if (frame.classifier) {
      state.safeStreak++;
    }

    state.selected.clear();
    const reasons: Reason[] = [];
    if (overlay) {
      for (const id of ['faces', 'people'] as const) {
        const setting = policy.categories[id];
        if (!setting.enabled || setting.scope !== 'regions') continue;
        const picked = selectRegions(id, signals, policy) ?? [];
        for (const region of picked) {
          const track = owner.get(region);
          if (track) state.selected.add(track.id);
        }
        if (picked.length)
          reasons.push({
            category: id,
            score: Math.max(...picked.map((r) => r.score)),
            threshold: setting.threshold,
          });
      }
    }
    const decision: Decision = state.selected.size
      ? { action: 'regions', regions: [], reasons, confidence: whole.confidence, pressure: whole.pressure }
      : whole;
    item.decision = decision;
    this.host.apply(item, decision);
    if (frame.classifier)
      state.interval = adaptiveInterval(policy.video.baseIntervalMs, whole.pressure, state.safeStreak);
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

  /** One analysis from the region budget; forced ones (seek, cut, settings change) always run. */
  private takeRegionToken(force: boolean): boolean {
    const now = performance.now();
    this.regionTokens = Math.min(
      REGION_TOKENS_PER_SECOND,
      this.regionTokens + ((now - this.lastRegionRefill) / 1000) * REGION_TOKENS_PER_SECOND,
    );
    this.lastRegionRefill = now;
    if (!force && this.regionTokens < 1) return false;
    this.regionTokens = Math.max(0, this.regionTokens - 1);
    return true;
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
    const regions = videoRegionMode(this.host.policy());
    for (const state of candidates) {
      // Region mode is paced per presented frame where the browser supports it.
      if (regions && (state.video as VideoWithFrameCallback).requestVideoFrameCallback) continue;
      void this.sample(state, false);
    }
  }

  private async sample(state: VideoState, force: boolean): Promise<void> {
    if (videoRegionMode(this.host.policy())) return this.sampleRegions(state, force);
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

    const regions = requiredSignals(this.host.policy(), 'video').some((kind) => kind !== 'classifier');
    const capture = await captureElement(video, regions ? FRAME_MAX_SIDE_REGIONS : FRAME_MAX_SIDE, 0.8);
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
