/**
 * ProtectionRenderer — turns decisions into page state.
 *
 * Whole-element protection is pure CSS (attribute switch, compositor-only
 * filters). Region protection for <img> swaps in a rendering produced by
 * the engine, displayed through CSS custom properties so the element, its
 * box and the page's layout are untouched. If the page's Content Security
 * Policy forbids data: images, region protection degrades to whole-image
 * protection — never to showing the original.
 */
import type { MediaSource, Region, RenderStyle } from '../../ml/types';
import type { Decision, EffectivePolicy, ProtectionStyle } from '../../policy/types';
import { LruCache } from '../../shared/lru';
import { hashString } from '../../shared/hash';
import { cornerRadius, setSizeBucket, setState, setVar } from '../dom';
import type { EngineClient } from '../engine/client';
import type { MediaItem } from '../media/item';

const FIT_TO_SIZE: Record<string, string> = {
  fill: '100% 100%',
  contain: 'contain',
  cover: 'cover',
  none: 'auto',
  'scale-down': 'contain',
};

export function renderStyleFor(style: ProtectionStyle): RenderStyle {
  if (style === 'pixelate') return 'pixelate';
  if (style === 'blur-soft' || style === 'blur-strong') return 'blur';
  return 'solid';
}

export class ProtectionRenderer {
  private readonly renders = new LruCache<string, string>({ maxEntries: 48 });
  /** Source used for detection, reused for rendering (pixels for page-readable media). */
  private readonly sources = new WeakMap<MediaItem, MediaSource>();
  private regionsBlocked = false;
  private renderSeq = 0;

  constructor(
    private readonly engine: EngineClient,
    private readonly policy: () => EffectivePolicy,
    private readonly initiator: string,
  ) {
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        if (event.blockedURI === 'data' || event.blockedURI.startsWith('data:')) this.onRegionsBlocked();
      },
      { capture: true, passive: true },
    );
  }

  setSource(item: MediaItem, source: MediaSource): void {
    this.sources.set(item, source);
  }

  pending(item: MediaItem): void {
    setState(item.el, 'p');
  }

  apply(item: MediaItem, decision: Decision): void {
    if (item.revealed) {
      setState(item.el, 'r');
      return;
    }
    switch (decision.action) {
      case 'allow':
        setVar(item.el, '--veil-render', null);
        setState(item.el, 'ok');
        return;
      case 'protect':
        this.protectWhole(item);
        return;
      case 'regions':
        if (item.kind === 'video') {
          // Drawn over the playing video by VideoRegionOverlay (media/video.ts).
          setState(item.el, 'rg');
          return;
        }
        if (item.kind !== 'image' || this.regionsBlocked || !decision.regions?.length) {
          this.protectWhole(item);
          return;
        }
        // Stay fully protected until the concealed rendering is ready.
        if (item.el.getAttribute('data-veil') !== 'rg') this.protectWhole(item);
        void this.renderRegions(item, decision.regions);
        return;
    }
  }

  private protectWhole(item: MediaItem): void {
    const size = item.renderedSize || Math.max(item.el.clientWidth, item.el.clientHeight);
    setSizeBucket(item.el, size);
    const radius = cornerRadius(item.el);
    setVar(item.el, '--veil-radius', radius);
    setState(item.el, 'x');
  }

  private async renderRegions(item: MediaItem, regions: Region[]): Promise<void> {
    const style = renderStyleFor(this.policy().style);
    const src = item.src;
    const cacheKey = `${item.key}|${style}|${hashString(JSON.stringify(regions.map((r) => [r.x, r.y, r.w, r.h].map((v) => v.toFixed(3)))))}`;
    let dataUrl = this.renders.get(cacheKey);
    if (!dataUrl) {
      const response = await this.engine.render({
        id: `r${++this.renderSeq}`,
        key: item.key,
        source: this.sources.get(item) ?? { kind: 'url', url: src },
        regions,
        style,
        initiator: this.initiator,
      });
      if (!response.ok) return; // stays whole-protected
      dataUrl = response.dataUrl;
      this.renders.set(cacheKey, dataUrl);
    }
    // The element may have changed source or decision while we waited.
    if (item.src !== src || item.decision?.action !== 'regions' || item.revealed || this.regionsBlocked)
      return;
    const computed = getComputedStyle(item.el);
    setVar(item.el, '--veil-fit', FIT_TO_SIZE[computed.objectFit] ?? 'cover');
    setVar(item.el, '--veil-pos', computed.objectPosition || '50% 50%');
    setVar(item.el, '--veil-render', `url("${dataUrl}")`);
    setState(item.el, 'rg');
  }

  private onRegionsBlocked(): void {
    if (this.regionsBlocked) return;
    this.regionsBlocked = true;
    for (const el of document.querySelectorAll('[data-veil="rg"]')) {
      setVar(el, '--veil-render', null);
      setState(el, 'x');
    }
  }

  get supportsRegions(): boolean {
    return !this.regionsBlocked;
  }
}
