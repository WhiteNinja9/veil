/**
 * Per-frame statistics, reported to the background (aggregated per tab for
 * the popup). Counts only — never URLs of media or what was detected — and
 * only while stats are enabled. Reports are sent when something changed and
 * at most every two seconds, so an idle page sends nothing.
 */
import type { FrameStats } from '../shared/messages';
import type { MediaItem, MediaRegistry } from './media/item';

const REPORT_INTERVAL_MS = 2000;
const FIRST_REPORT_MS = 400;

export class StatsReporter {
  private scanned = 0;
  private engineMs = 0;
  private pageMs = 0;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastUrl = location.href;
  private reported = false;

  constructor(
    private readonly registry: MediaRegistry,
    private readonly send: (stats: FrameStats) => void,
    private readonly enabled: () => boolean,
    private readonly meta: () => { active: boolean; level: string },
  ) {}

  recordAnalysis(engineMs: number): void {
    this.scanned++;
    this.engineMs += engineMs;
    this.markDirty();
  }

  /** Measures synchronous work done on the page's main thread. */
  measure<T>(fn: () => T): T {
    const started = performance.now();
    try {
      return fn();
    } finally {
      this.pageMs += performance.now() - started;
    }
  }

  addPageTime(ms: number): void {
    this.pageMs += ms;
  }

  markDirty(): void {
    this.dirty = true;
    if (this.timer || !this.enabled()) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.reported = true;
        this.flush();
      },
      this.reported ? REPORT_INTERVAL_MS : FIRST_REPORT_MS,
    );
  }

  flush(): void {
    if (!this.dirty || !this.enabled()) return;
    this.dirty = false;
    if (location.href !== this.lastUrl) {
      // SPA navigation: counts restart for the new page.
      this.lastUrl = location.href;
      this.scanned = 0;
      this.engineMs = 0;
      this.pageMs = 0;
    }
    this.send(this.snapshot());
  }

  snapshot(): FrameStats {
    let images = 0;
    let videos = 0;
    let protectedCount = 0;
    let revealed = 0;
    let unverified = 0;
    let pending = 0;
    for (const item of this.registry.all()) {
      if (!item.el.isConnected) continue;
      if (item.kind === 'video') videos++;
      else if (item.state !== 'skipped') images++;
      if (isProtected(item)) protectedCount++;
      if (item.revealed) revealed++;
      if (item.unverifiable) unverified++;
      if (item.state === 'queued' || item.state === 'analyzing' || item.state === 'waiting') pending++;
    }
    const { active, level } = this.meta();
    return {
      scanned: this.scanned,
      images,
      videos,
      protected: protectedCount,
      revealed,
      unverified,
      pending,
      pageMs: Math.round(this.pageMs * 10) / 10,
      engineMs: Math.round(this.engineMs),
      active,
      level,
    };
  }
}

function isProtected(item: MediaItem): boolean {
  return !item.revealed && (item.decision?.action === 'protect' || item.decision?.action === 'regions');
}
