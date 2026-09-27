/**
 * ProtectionController — orchestrates protection for one frame.
 *
 *   MediaScanner ─► registry ─► VisibilityTracker (priority, size)
 *                        │
 *                        ▼
 *               AnalysisScheduler ─► EngineClient ─► background ─► engine
 *                        │
 *                        ▼
 *         PolicyEngine.evaluate(signals, context, policy)
 *                        │
 *                        ▼
 *       ProtectionRenderer / VideoProtectionManager / RevealController
 *
 * Signals (model outputs) are cached separately from decisions, so a
 * policy change re-decides every item instantly without new inference.
 */
import { evaluate, fallbackDecision, requiredSignals } from '../policy/engine';
import type { Decision, EffectivePolicy } from '../policy/types';
import type { DetectResponse, MediaSource, SignalKind, Signals } from '../ml/types';
import { pageTranslator } from '../i18n/page';
import type { Settings } from '../storage/schema';
import { hashString } from '../shared/hash';
import { LruCache } from '../shared/lru';
import { createLogger } from '../shared/logger';
import { looksLikeAd } from './context';
import {
  applyRootFlags,
  clearVeil,
  engageRoot,
  ensurePixelateFilters,
  releaseRoot,
  type RootFlags,
  rootGeneration,
  setState,
} from './dom';
import { EngineClient } from './engine/client';
import { AnalysisScheduler } from './engine/scheduler';
import { captureImage, captureUrlInPage, isPageReadable } from './media/capture';
import { createItem, type MediaItem, MediaRegistry } from './media/item';
import {
  backgroundUrl,
  imageAttributeSignature,
  imageSource,
  isFetchableUrl,
  isVectorSource,
} from './media/sources';
import { VideoProtectionManager } from './media/video';
import { ProtectionRenderer } from './render/renderer';
import { RevealController } from './render/reveal';
import { MediaScanner } from './scan/scanner';
import { type VisibilityInfo, VisibilityTracker } from './scan/visibility';
import { shadowCss } from './shadow-css';
import { StatsReporter } from './stats';

const log = createLogger('controller');

/** Images smaller than this (natural pixels) are tracking pixels/spacers. */
const MIN_NATURAL = 16;
/** Below this rendered size, media is a "thumbnail" for the thumbnails toggle. */
const THUMBNAIL_SIZE = 150;
const CAPTURE_SIDE = 320;
const CAPTURE_SIDE_REGIONS = 768;

interface ItemMeta {
  attrSig: string;
  measured: boolean;
  loadBound: boolean;
  source?: MediaSource;
}

export class ProtectionController {
  private policy: EffectivePolicy;
  private settings: Settings;
  private readonly registry = new MediaRegistry();
  private readonly meta = new WeakMap<MediaItem, ItemMeta>();
  private readonly engine: EngineClient;
  private readonly scheduler = new AnalysisScheduler(6);
  private readonly visibility: VisibilityTracker;
  private scanner: MediaScanner | null = null;
  private readonly renderer: ProtectionRenderer;
  private readonly reveal: RevealController;
  private readonly videos: VideoProtectionManager;
  private readonly stats: StatsReporter;
  private readonly signalCache = new LruCache<string, Signals>({ maxEntries: 800 });
  private readonly inflight = new Map<string, Promise<DetectResponse>>();
  private readonly manual = new Map<string, 'protect' | 'show'>();
  private readonly shadowStyles: WeakRef<HTMLStyleElement>[] = [];
  private active = false;
  private requestSeq = 0;
  private pruneScheduled = false;
  private flags: RootFlags | null = null;

  constructor(
    private readonly generation: string,
    settings: Settings,
    policy: EffectivePolicy,
    private readonly shortcut: string,
  ) {
    this.settings = settings;
    this.policy = policy;
    this.engine = new EngineClient(() => this.invalidate());
    this.visibility = new VisibilityTracker((el, info) => this.onVisibility(el, info));
    this.renderer = new ProtectionRenderer(this.engine, () => this.policy, location.href);
    this.reveal = new RevealController(
      this.registry,
      { reveal: (item) => this.revealItem(item), hide: (item) => this.hideItem(item) },
      () => this.policy,
      pageTranslator(settings.language),
      () => this.shortcut,
      () => this.settings.appearance.showChip,
    );
    this.videos = new VideoProtectionManager({
      policy: () => this.policy,
      detectFrame: (item, dataUrl, width, height, key) =>
        this.detect(
          item,
          { kind: 'pixels', dataUrl, width, height },
          key,
          requiredSignals(this.policy, 'video'),
        ),
      detectUrl: (item, url) =>
        this.detect(item, { kind: 'url', url }, hashString(url), requiredSignals(this.policy, 'video')),
      apply: (item, decision) => this.render(item, decision),
      pending: (item) => this.renderer.pending(item),
      fallback: (item) => {
        item.unverifiable = true;
        const decision = fallbackDecision(this.policy);
        item.decision = decision;
        this.render(item, decision);
      },
      onAnalyzed: (item, signals) => {
        item.signals = signals;
        this.stats.recordAnalysis(signals.ms);
      },
    });
    this.stats = new StatsReporter(
      this.registry,
      (stats) => this.engine.sendStats({ ...stats, url: undefined }),
      () => this.settings.stats.enabled,
      () => ({ active: this.policy.active, level: this.policy.level }),
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  start(): void {
    if (this.policy.active) this.activate();
    else this.deactivate();
  }

  private activate(): void {
    if (this.active) return;
    this.active = true;
    engageRoot(this.generation);
    this.applyFlags();
    this.scanner = new MediaScanner(
      {
        image: (img) => this.stats.measure(() => this.onImage(img)),
        video: (video) => this.stats.measure(() => this.onVideo(video)),
        background: (el) => this.stats.measure(() => this.onBackground(el)),
        sourceChanged: (el, attr) => this.stats.measure(() => this.onSourceChanged(el, attr)),
        shadowRoot: (root) => this.onShadowRoot(root),
        removed: () => this.schedulePrune(),
      },
      this.policy.media.backgrounds,
    );
    this.scanner.start();
    this.reveal.start();
    this.videos.setActive(true);
    const signals = requiredSignals(this.policy, 'image');
    if (signals.length) this.engine.hello(signals);
  }

  private deactivate(): void {
    this.active = false;
    this.scanner?.stop();
    this.scanner = null;
    this.scheduler.clear();
    this.videos.setActive(false);
    this.reveal.dismiss();
    releaseRoot(this.generation);
    this.updateShadowStyles(null);
    this.stats.markDirty();
  }

  /**
   * Extension reloaded, updated or disabled. After an update the new content
   * script takes over the page within milliseconds (it is re-injected); keep
   * the gate briefly so protected media does not flash in between, then
   * release it if nobody took over (extension disabled or removed).
   */
  private invalidate(): void {
    this.active = false;
    this.scanner?.stop();
    this.scheduler.clear();
    this.videos.stop();
    this.reveal.stop();
    this.visibility.disconnect();
    setTimeout(() => {
      releaseRoot(this.generation);
      if (!rootGeneration()) this.updateShadowStyles(null);
    }, 3000);
  }

  updateSettings(settings: Settings, policy: EffectivePolicy): void {
    const previous = this.policy;
    const languageChanged = settings.language !== this.settings.language;
    this.settings = settings;
    this.policy = policy;
    if (languageChanged) this.reveal.setTranslator(pageTranslator(settings.language));
    if (!policy.active) {
      this.deactivate();
      return;
    }
    if (!this.active) {
      this.activate();
      return;
    }
    // Restart discovery if the set of media types changed.
    if (
      previous.media.backgrounds !== policy.media.backgrounds ||
      previous.media.images !== policy.media.images ||
      previous.media.videos !== policy.media.videos
    ) {
      this.deactivate();
      this.activate();
    }
    this.applyFlags();
    this.reevaluateAll();
    this.videos.reevaluate();
  }

  private applyFlags(): void {
    this.flags = {
      style: this.policy.style,
      images: this.policy.media.images,
      videos: this.policy.media.videos,
      backgrounds: this.policy.media.backgrounds,
    };
    applyRootFlags(this.flags);
    if (this.policy.style === 'pixelate') ensurePixelateFilters();
    this.updateShadowStyles(this.flags);
  }

  private reevaluateAll(): void {
    for (const item of this.registry.all()) {
      if (item.kind === 'video') continue;
      if (item.state !== 'decided') {
        this.consider(item);
        continue;
      }
      if (item.signals) {
        const needed = requiredSignals(this.policy, item.kind);
        const missing = needed.filter((kind) => item.signals![kind] === undefined);
        if (missing.length) this.enqueue(item);
        else this.decide(item);
      } else if (item.unverifiable) this.decide(item);
    }
  }

  // ── Discovery ────────────────────────────────────────────────────────

  private track(el: HTMLElement, kind: MediaItem['kind']): MediaItem {
    let item = this.registry.get(el);
    if (!item) {
      item = this.registry.add(createItem(el, kind));
      this.meta.set(item, { attrSig: '', measured: false, loadBound: false });
      this.visibility.observe(el);
    }
    return item;
  }

  private skip(item: MediaItem): void {
    item.state = 'skipped';
    setState(item.el, 'ok');
  }

  private onImage(img: HTMLImageElement): void {
    if (!this.policy.media.images) return;
    const item = this.track(img, 'image');
    const meta = this.meta.get(item)!;
    if (!meta.loadBound) {
      meta.loadBound = true;
      img.addEventListener('load', () => this.stats.measure(() => this.onImageLoad(item)), { passive: true });
      img.addEventListener('error', () => this.skip(item), { passive: true });
    }
    const signature = imageAttributeSignature(img);
    if (meta.attrSig && meta.attrSig === signature && item.src) return; // already known
    meta.attrSig = signature;
    if (img.complete) this.onImageLoad(item);
    else if (!img.getAttribute('src') && !img.getAttribute('srcset')) this.skip(item);
    else item.state = 'waiting';
  }

  private onImageLoad(item: MediaItem): void {
    const img = item.el as HTMLImageElement;
    const src = imageSource(img);
    if (!src || !img.naturalWidth) {
      this.skip(item);
      return;
    }
    if (
      src === item.src &&
      (item.state === 'decided' || item.state === 'queued' || item.state === 'analyzing')
    )
      return;
    const meta = this.meta.get(item)!;
    const signature = imageAttributeSignature(img);
    // Same attributes, new currentSrc: the browser picked another srcset
    // candidate (e.g. after a resize). Same picture — re-verify quietly.
    const responsiveSwap =
      item.state === 'decided' && item.decision?.action === 'allow' && meta.attrSig === signature;
    meta.attrSig = signature;
    this.resetItem(item, src, !responsiveSwap);
    if (isVectorSource(src) || img.naturalWidth < MIN_NATURAL || img.naturalHeight < MIN_NATURAL) {
      this.skip(item);
      return;
    }
    this.consider(item);
  }

  private onBackground(el: HTMLElement): void {
    if (!this.policy.media.backgrounds || el.localName === 'img' || el.localName === 'video') return;
    const url = backgroundUrl(el);
    const existing = this.registry.get(el);
    if (!url) {
      if (existing) this.skip(existing);
      else setState(el, 'ok');
      return;
    }
    const item = this.track(el, 'background');
    if (url === item.src && item.state !== 'waiting') return;
    this.resetItem(item, url, true);
    if (isVectorSource(url)) {
      this.skip(item);
      return;
    }
    this.consider(item);
  }

  private onVideo(video: HTMLVideoElement): void {
    if (!this.policy.media.videos) return;
    const item = this.track(video, 'video');
    item.isAd = looksLikeAd(video);
    this.videos.track(item);
  }

  private onSourceChanged(el: HTMLElement, attribute: string): void {
    const item = this.registry.get(el);
    if (el.localName === 'img') {
      const meta = item && this.meta.get(item);
      if (!item || !meta) {
        this.onImage(el as HTMLImageElement);
        return;
      }
      const signature = imageAttributeSignature(el as HTMLImageElement);
      if (signature === meta.attrSig) return;
      meta.attrSig = signature;
      // Hide synchronously (this runs before the next paint), verify on load.
      this.resetItem(item, '', true);
      item.state = 'waiting';
      if ((el as HTMLImageElement).complete) this.onImageLoad(item);
      return;
    }
    if (el.localName === 'video') {
      if (attribute === 'src' || attribute === 'poster') this.videos.sourceChanged(el as HTMLVideoElement);
      return;
    }
    if (attribute === 'style') this.onBackground(el);
  }

  private onShadowRoot(root: ShadowRoot): void {
    const style = document.createElement('style');
    style.setAttribute('data-veil-style', '');
    style.textContent = shadowCss(this.flags);
    root.append(style);
    this.shadowStyles.push(new WeakRef(style));
  }

  private updateShadowStyles(flags: RootFlags | null): void {
    const css = shadowCss(flags);
    for (let i = this.shadowStyles.length - 1; i >= 0; i--) {
      const style = this.shadowStyles[i]!.deref();
      if (!style || !style.isConnected) this.shadowStyles.splice(i, 1);
      else if (style.textContent !== css) style.textContent = css;
    }
  }

  private schedulePrune(): void {
    if (this.pruneScheduled) return;
    this.pruneScheduled = true;
    const run = () => {
      this.pruneScheduled = false;
      for (const item of this.registry.prune()) {
        this.visibility.unobserve(item.el);
        this.scheduler.remove(item.seq);
        if (item.requestId) this.engine.cancel(item.requestId);
        if (item.kind === 'video') this.videos.untrack(item.el as HTMLVideoElement);
      }
      this.stats.markDirty();
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 500);
  }

  // ── Visibility & scheduling ──────────────────────────────────────────

  private onVisibility(el: Element, info: VisibilityInfo): void {
    const item = this.registry.get(el);
    if (!item) return;
    item.priority = info.priority;
    item.visible = info.visible;
    if (info.size > 0) item.renderedSize = info.size;
    const meta = this.meta.get(item);
    if (meta && !meta.measured) {
      meta.measured = true;
      if (item.kind !== 'video') this.consider(item);
    } else if (item.state === 'queued') {
      this.scheduler.reprioritize(item.seq, info.priority);
    }
  }

  private resetItem(item: MediaItem, src: string, hide: boolean): void {
    if (item.requestId) {
      this.engine.cancel(item.requestId);
      item.requestId = undefined;
    }
    this.scheduler.remove(item.seq);
    clearTimeout(item.revealTimer);
    item.src = src;
    item.key = src ? hashString(src) : '';
    item.signals = undefined;
    item.decision = undefined;
    item.revealed = false;
    item.unverifiable = false;
    item.manual = undefined;
    item.state = 'waiting';
    if (hide) this.renderer.pending(item);
  }

  /** Decides whether an item needs analysis now; uses cached signals when possible. */
  private consider(item: MediaItem): void {
    if (!this.active || !item.src) return;
    if (item.state === 'queued' || item.state === 'analyzing' || item.state === 'skipped') return;
    const meta = this.meta.get(item);
    if (!meta?.measured) return; // wait for the first visibility entry (gives us size without layout)

    const natural =
      item.kind === 'image'
        ? Math.max((item.el as HTMLImageElement).naturalWidth, (item.el as HTMLImageElement).naturalHeight)
        : 0;
    const size = item.renderedSize || natural;
    if (size > 0 && size < this.policy.media.minSize) {
      this.skip(item);
      return;
    }
    if (!this.policy.media.thumbnails && size > 0 && size < THUMBNAIL_SIZE) {
      this.skip(item);
      return;
    }
    if (item.isAd === undefined) item.isAd = looksLikeAd(item.el);

    const manual = this.manual.get(item.src);
    if (manual) {
      item.manual = manual;
      this.decide(item);
      return;
    }
    const needed = requiredSignals(this.policy, item.kind);
    if (!needed.length) {
      this.render(item, { action: 'allow', reasons: [], confidence: 1, pressure: 0 });
      item.state = 'decided';
      return;
    }
    const cached = this.cachedSignals(item.key, needed);
    if (cached) {
      item.signals = cached;
      this.decide(item);
      return;
    }
    this.enqueue(item);
  }

  private cachedSignals(key: string, needed: SignalKind[]): Signals | null {
    const cached = this.signalCache.get(key);
    return cached && needed.every((kind) => cached[kind] !== undefined) ? cached : null;
  }

  private enqueue(item: MediaItem): void {
    item.state = 'queued';
    const src = item.src;
    this.scheduler.enqueue({
      id: item.seq,
      priority: item.priority,
      seq: item.seq,
      isValid: () => item.el.isConnected && item.src === src && item.state === 'queued',
      run: () => this.analyze(item),
    });
    this.stats.markDirty();
  }

  private async analyze(item: MediaItem): Promise<void> {
    const src = item.src;
    item.state = 'analyzing';
    const needed = requiredSignals(this.policy, item.kind);
    const regionsWanted = needed.includes('faces') || needed.includes('people') || needed.includes('gender');
    if (item.key && this.capturesPixels(item)) {
      // Capturing and encoding pixels is the costly part of a cache hit;
      // ask the background first.
      const probe = await this.engine.probe(
        `${this.generation.slice(0, 6)}-p${++this.requestSeq}`,
        item.key,
        needed,
      );
      if (item.src !== src || !item.el.isConnected) return;
      if (probe.ok) {
        this.signalCache.set(item.key, { ...this.signalCache.peek(item.key), ...probe.signals });
        item.signals = probe.signals;
        this.decide(item);
        return;
      }
    }
    const source = await this.sourceFor(item, regionsWanted ? CAPTURE_SIDE_REGIONS : CAPTURE_SIDE);
    if (item.src !== src) return;
    if (!source) {
      item.unverifiable = true;
      this.decide(item);
      return;
    }
    this.meta.get(item)!.source = source;
    const response = await this.detect(item, source, item.key, needed);
    if (item.src !== src || !item.el.isConnected) return;
    if (response.ok) {
      item.signals = response.signals;
      if (!response.cached) this.stats.recordAnalysis(response.signals.ms);
    } else {
      if (__DEV__)
        log.debug('detect failed', src.slice(-50), source.kind, response.error, response.message ?? '');
      item.unverifiable = true;
    }
    this.decide(item);
  }

  /** Whether analysing this item means capturing pixels in the page (vs. sending a URL). */
  private capturesPixels(item: MediaItem): boolean {
    if (item.kind === 'image') return isPageReadable(item.src, item.el as HTMLImageElement);
    return item.src.startsWith('data:') || item.src.startsWith('blob:');
  }

  private async sourceFor(item: MediaItem, maxSide: number): Promise<MediaSource | null> {
    const src = item.src;
    if (item.kind === 'image') {
      const img = item.el as HTMLImageElement;
      if (isPageReadable(src, img)) {
        const capture = await captureImage(img, img.naturalWidth, img.naturalHeight, maxSide);
        if (capture && capture !== 'tainted') return { kind: 'pixels', ...capture };
      }
    } else if (src.startsWith('data:') || src.startsWith('blob:')) {
      const capture = await captureUrlInPage(src, maxSide);
      return capture && capture !== 'tainted' ? { kind: 'pixels', ...capture } : null;
    }
    return isFetchableUrl(src) ? { kind: 'url', url: src } : null;
  }

  /** Detection with page-level caching and in-flight de-duplication. */
  private detect(
    item: MediaItem,
    source: MediaSource,
    key: string,
    signals: SignalKind[],
  ): Promise<DetectResponse> {
    const cached = this.cachedSignals(key, signals);
    if (cached) return Promise.resolve({ id: 'cache', ok: true, signals: cached, cached: true });
    const dedupeKey = `${key}|${signals.join(',')}`;
    let pending = this.inflight.get(dedupeKey);
    if (!pending) {
      const id = `${this.generation.slice(0, 6)}-${++this.requestSeq}`;
      item.requestId = id;
      pending = this.engine
        .detect({ id, key, source, signals, priority: item.priority, initiator: location.href })
        .then((response) => {
          if (response.ok) this.signalCache.set(key, { ...this.signalCache.peek(key), ...response.signals });
          return response;
        })
        .finally(() => {
          this.inflight.delete(dedupeKey);
          if (item.requestId === id) item.requestId = undefined;
        });
      this.inflight.set(dedupeKey, pending);
    }
    return pending;
  }

  // ── Decisions ────────────────────────────────────────────────────────

  private decide(item: MediaItem): void {
    let decision: Decision;
    if (item.manual === 'protect')
      decision = {
        action: 'protect',
        reasons: [{ category: 'manual', score: 1, threshold: 0 }],
        confidence: 1,
        pressure: 1,
      };
    else if (item.manual === 'show')
      decision = {
        action: 'allow',
        reasons: [{ category: 'manual', score: 0, threshold: 0 }],
        confidence: 1,
        pressure: 0,
      };
    else if (item.signals) {
      decision = evaluate(
        item.signals,
        { kind: item.kind, renderedSize: item.renderedSize, isAd: Boolean(item.isAd) },
        this.policy,
      );
    } else if (item.unverifiable) decision = fallbackDecision(this.policy);
    else return;
    item.decision = decision;
    item.state = 'decided';
    if (__DEV__) {
      const c = item.signals?.classifier;
      log.debug(
        'decide',
        item.src.slice(-60),
        decision.action,
        c
          ? `porn=${c.porn.toFixed(2)} sexy=${c.sexy.toFixed(2)} neutral=${c.neutral.toFixed(2)}`
          : 'no-signals',
        item.unverifiable ? 'unverifiable' : '',
      );
    }
    this.render(item, decision);
  }

  private render(item: MediaItem, decision: Decision): void {
    const meta = this.meta.get(item);
    if (meta?.source && item.kind === 'image') this.renderer.setSource(item, meta.source);
    this.renderer.apply(item, decision);
    this.reveal.refresh(item);
    this.stats.markDirty();
  }

  private revealItem(item: MediaItem): void {
    item.revealed = true;
    setState(item.el, 'r');
    clearTimeout(item.revealTimer);
    const after = this.policy.reveal.reprotectAfterSec;
    if (after > 0) item.revealTimer = setTimeout(() => this.hideItem(item), after * 1000);
    this.stats.markDirty();
  }

  private hideItem(item: MediaItem): void {
    item.revealed = false;
    clearTimeout(item.revealTimer);
    if (item.decision) this.render(item, item.decision);
    this.stats.markDirty();
  }

  // ── Commands ─────────────────────────────────────────────────────────

  revealFocused(): void {
    this.reveal.revealFromShortcut();
  }

  applyManual(srcUrl: string, action: 'protect' | 'show'): void {
    // "Show" from the context menu is a reveal: it obeys the reveal policy.
    if (action === 'show' && this.policy.reveal.mode === 'disabled') {
      this.reveal.announce(pageTranslator(this.settings.language).t('announce.disabled'));
      return;
    }
    this.manual.set(srcUrl, action);
    for (const item of this.registry.all()) {
      const current = item.kind === 'image' ? imageSource(item.el as HTMLImageElement) : item.src;
      if (current === srcUrl || item.src === srcUrl || (item.el as HTMLImageElement).src === srcUrl) {
        item.manual = action;
        item.revealed = false;
        this.decide(item);
      }
    }
  }

  /** Owner check used by the bootstrap to avoid double instances after re-injection. */
  ownsPage(): boolean {
    return rootGeneration() === this.generation;
  }

  release(): void {
    this.invalidate();
    for (const item of this.registry.all()) clearVeil(item.el);
  }
}
