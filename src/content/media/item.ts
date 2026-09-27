import type { Decision, MediaKind } from '../../policy/types';
import type { Priority, Signals } from '../../ml/types';

export type ItemState =
  /** Discovered, waiting for pixels (image loading, video without data). */
  | 'waiting'
  /** In the scheduler queue. */
  | 'queued'
  /** Request in flight. */
  | 'analyzing'
  /** Decision applied. */
  | 'decided'
  /** Not analysed (too small, vector, disabled media type). */
  | 'skipped';

export interface MediaItem {
  readonly el: HTMLElement;
  readonly kind: MediaKind;
  /** Source currently associated with the element (currentSrc, bg URL or poster). */
  src: string;
  key: string;
  state: ItemState;
  priority: Priority;
  /** Rendered size from the latest IntersectionObserver entry (CSS px, longest side). */
  renderedSize: number;
  visible: boolean;
  signals?: Signals;
  decision?: Decision;
  /** User revealed this item; cleared when the source changes. */
  revealed: boolean;
  revealTimer?: ReturnType<typeof setTimeout>;
  /** Manual override from the context menu. */
  manual?: 'protect' | 'show';
  requestId?: string;
  isAd?: boolean;
  unverifiable?: boolean;
  seq: number;
}

let seq = 0;

export function createItem(el: HTMLElement, kind: MediaKind): MediaItem {
  return {
    el,
    kind,
    src: '',
    key: '',
    state: 'waiting',
    priority: 2,
    renderedSize: 0,
    visible: false,
    revealed: false,
    seq: seq++,
  };
}

/**
 * Registry of tracked media. A WeakMap gives O(1) element lookup without
 * retaining detached nodes; the Set is pruned of disconnected elements on
 * idle so iteration stays proportional to what is on the page.
 */
export class MediaRegistry {
  private readonly byElement = new WeakMap<Element, MediaItem>();
  private readonly items = new Set<MediaItem>();

  get(el: Element): MediaItem | undefined {
    return this.byElement.get(el);
  }

  add(item: MediaItem): MediaItem {
    this.byElement.set(item.el, item);
    this.items.add(item);
    return item;
  }

  delete(item: MediaItem): void {
    this.byElement.delete(item.el);
    this.items.delete(item);
  }

  all(): IterableIterator<MediaItem> {
    return this.items.values();
  }

  get size(): number {
    return this.items.size;
  }

  /** Removes items whose element left the document; returns them for cleanup. */
  prune(): MediaItem[] {
    const removed: MediaItem[] = [];
    for (const item of this.items) {
      if (!item.el.isConnected) {
        this.items.delete(item);
        this.byElement.delete(item.el);
        removed.push(item);
      }
    }
    return removed;
  }
}
