/**
 * MediaScanner — incremental discovery of media in the document and in
 * shadow roots.
 *
 * One MutationObserver per tree root (document + each shadow root) reports
 * added subtrees and source attribute changes. We never rescan the whole
 * document after startup: work is proportional to what changed.
 */
import { openOrClosedShadowRoot } from '../../browser/api';

export interface ScannerHandlers {
  image(img: HTMLImageElement): void;
  video(video: HTMLVideoElement): void;
  background(el: HTMLElement): void;
  /** src / srcset / poster / style changed on an element that may be tracked. */
  sourceChanged(el: HTMLElement, attribute: string): void;
  shadowRoot(root: ShadowRoot): void;
  /** Nodes were removed; the controller prunes on idle. */
  removed(): void;
}

const MEDIA_SELECTOR = 'img, video, [style*="url(" i]';
const ATTRIBUTES = ['src', 'srcset', 'poster'];

export class MediaScanner {
  private readonly observers: MutationObserver[] = [];
  private readonly knownRoots = new WeakSet<Node>();
  private readonly lateShadowChecks = new Set<Element>();
  private lateTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  /**
   * @param watchStyles observe inline `style` changes (needed for background
   *   images; skipped when background protection is off, since pages that
   *   animate through inline styles generate many mutation records).
   */
  constructor(
    private readonly handlers: ScannerHandlers,
    private readonly watchStyles: boolean,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.observeRoot(document);
    if (document.documentElement) this.scan(document.documentElement);
  }

  stop(): void {
    this.running = false;
    for (const observer of this.observers) observer.disconnect();
    this.observers.length = 0;
    clearTimeout(this.lateTimer);
    this.lateShadowChecks.clear();
  }

  private observeRoot(root: Document | ShadowRoot): void {
    const observer = new MutationObserver((records) => this.onMutations(records));
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: this.watchStyles ? [...ATTRIBUTES, 'style'] : ATTRIBUTES,
    });
    this.observers.push(observer);
    this.knownRoots.add(root);
  }

  private onMutations(records: MutationRecord[]): void {
    let removed = false;
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) this.scan(node as Element);
        }
        if (record.removedNodes.length) removed = true;
      } else if (record.type === 'attributes') {
        const target = record.target as HTMLElement;
        const name = record.attributeName ?? '';
        if (name === 'style') {
          // Cheap string check; most style mutations are unrelated animations.
          const style = target.getAttribute('style');
          if (style && /url\(/i.test(style)) this.handlers.background(target);
          else if (target.hasAttribute('data-veil')) this.handlers.sourceChanged(target, name);
        } else if (target.localName === 'source' && target.parentElement?.localName === 'picture') {
          const img = target.parentElement.querySelector('img');
          if (img) this.handlers.sourceChanged(img, 'srcset');
        } else {
          this.handlers.sourceChanged(target, name);
        }
      }
    }
    if (removed) this.handlers.removed();
  }

  /** Dispatches every media element in `root` (inclusive) and discovers shadow roots. */
  scan(root: Element): void {
    this.dispatch(root);
    if (root.firstElementChild) {
      for (const el of root.querySelectorAll(MEDIA_SELECTOR)) this.dispatch(el);
      this.findShadowRoots(root);
    }
    if (root.localName.includes('-')) this.checkShadow(root);
  }

  private dispatch(el: Element): void {
    switch (el.localName) {
      case 'img':
        this.handlers.image(el as HTMLImageElement);
        return;
      case 'video':
        this.handlers.video(el as HTMLVideoElement);
        return;
      default: {
        const style = el.getAttribute('style');
        if (style && /url\(/i.test(style)) this.handlers.background(el as HTMLElement);
      }
    }
  }

  private findShadowRoots(root: Element): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => ((node as Element).localName.includes('-') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) this.checkShadow(node as Element);
  }

  private checkShadow(host: Element): void {
    const shadow = openOrClosedShadowRoot(host);
    if (shadow) {
      if (this.knownRoots.has(shadow)) return;
      this.observeRoot(shadow);
      this.handlers.shadowRoot(shadow);
      for (const child of shadow.children) this.scan(child);
      return;
    }
    // Custom elements often attach their shadow root after insertion (on upgrade).
    if (this.lateShadowChecks.size < 500) {
      this.lateShadowChecks.add(host);
      this.scheduleLateChecks();
    }
  }

  private scheduleLateChecks(attempt = 0): void {
    if (this.lateTimer) return;
    this.lateTimer = setTimeout(
      () => {
        this.lateTimer = undefined;
        const hosts = [...this.lateShadowChecks];
        this.lateShadowChecks.clear();
        for (const host of hosts) {
          if (!host.isConnected) continue;
          const shadow = openOrClosedShadowRoot(host);
          if (shadow && !this.knownRoots.has(shadow)) {
            this.observeRoot(shadow);
            this.handlers.shadowRoot(shadow);
            for (const child of shadow.children) this.scan(child);
          } else if (!shadow && attempt < 2) {
            this.lateShadowChecks.add(host);
          }
        }
        if (this.lateShadowChecks.size && this.running) this.scheduleLateChecks(attempt + 1);
      },
      attempt === 0 ? 250 : 1500,
    );
  }
}
