/**
 * VisibilityTracker — viewport-aware prioritisation.
 *
 * Two IntersectionObservers classify each element as visible (priority 0),
 * near the viewport (priority 1, within 1.5 viewports) or elsewhere (2).
 * Their entries also give us rendered sizes without forcing layout.
 */
import type { Priority } from '../../ml/types';

export interface VisibilityInfo {
  priority: Priority;
  visible: boolean;
  /** Longest rendered side in CSS px (0 when not laid out). */
  size: number;
  width: number;
  height: number;
}

type Listener = (el: Element, info: VisibilityInfo) => void;

export class VisibilityTracker {
  private readonly state = new WeakMap<
    Element,
    { visible: boolean; near: boolean; width: number; height: number }
  >();
  private readonly viewport: IntersectionObserver;
  private readonly near: IntersectionObserver;

  constructor(private readonly listener: Listener) {
    this.viewport = new IntersectionObserver((entries) => this.update(entries, 'visible'), {
      threshold: [0, 0.01],
    });
    this.near = new IntersectionObserver((entries) => this.update(entries, 'near'), {
      rootMargin: '150% 0px 150% 0px',
    });
  }

  private update(entries: IntersectionObserverEntry[], which: 'visible' | 'near'): void {
    for (const entry of entries) {
      const current = this.state.get(entry.target) ?? { visible: false, near: false, width: 0, height: 0 };
      current[which] = entry.isIntersecting;
      current.width = entry.boundingClientRect.width;
      current.height = entry.boundingClientRect.height;
      this.state.set(entry.target, current);
      this.listener(entry.target, this.info(entry.target)!);
    }
  }

  info(el: Element): VisibilityInfo | null {
    const s = this.state.get(el);
    if (!s) return null;
    const priority: Priority = s.visible ? 0 : s.near ? 1 : 2;
    return {
      priority,
      visible: s.visible,
      size: Math.max(s.width, s.height),
      width: s.width,
      height: s.height,
    };
  }

  observe(el: Element): void {
    this.viewport.observe(el);
    this.near.observe(el);
  }

  unobserve(el: Element): void {
    this.viewport.unobserve(el);
    this.near.unobserve(el);
    this.state.delete(el);
  }

  disconnect(): void {
    this.viewport.disconnect();
    this.near.disconnect();
  }
}
