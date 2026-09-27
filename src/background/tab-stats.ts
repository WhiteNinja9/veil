/**
 * Per-tab statistics for the popup, aggregated from each frame's reports.
 * Counts only; kept in memory and mirrored to session storage (cleared when
 * the browser closes) so a service-worker restart does not zero the popup.
 */
import { ext } from '../browser/api';
import type { FrameStats } from '../shared/messages';

const SESSION_KEY = 'veil.tabStats';

export interface TabStats {
  scanned: number;
  images: number;
  videos: number;
  protected: number;
  revealed: number;
  unverified: number;
  pending: number;
  pageMs: number;
  engineMs: number;
  frames: number;
  updatedAt: number;
}

export function emptyTabStats(): TabStats {
  return { scanned: 0, images: 0, videos: 0, protected: 0, revealed: 0, unverified: 0, pending: 0, pageMs: 0, engineMs: 0, frames: 0, updatedAt: 0 };
}

export class TabStatsStore {
  private readonly tabs = new Map<number, Map<number, FrameStats>>();
  private mirrorTimer: ReturnType<typeof setTimeout> | undefined;
  private restored = false;

  constructor(private readonly onChange: (tabId: number, stats: TabStats) => void) {}

  async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    const session = (ext().storage as Partial<typeof chrome.storage>).session;
    if (!session) return;
    try {
      const stored = (await session.get(SESSION_KEY))[SESSION_KEY] as Record<string, Record<string, FrameStats>> | undefined;
      for (const [tabId, frames] of Object.entries(stored ?? {})) {
        const map = new Map<number, FrameStats>();
        for (const [frameId, stats] of Object.entries(frames)) map.set(Number(frameId), stats);
        if (!this.tabs.has(Number(tabId))) this.tabs.set(Number(tabId), map);
      }
    } catch {
      // Stats are best-effort.
    }
  }

  update(tabId: number, frameId: number, stats: FrameStats): void {
    let frames = this.tabs.get(tabId);
    if (!frames) this.tabs.set(tabId, (frames = new Map()));
    frames.set(frameId, stats);
    this.onChange(tabId, this.get(tabId));
    this.scheduleMirror();
  }

  removeFrame(tabId: number, frameId: number): void {
    const frames = this.tabs.get(tabId);
    if (!frames) return;
    frames.delete(frameId);
    if (frameId === 0) frames.clear(); // top frame navigated: the page is gone
    this.onChange(tabId, this.get(tabId));
    this.scheduleMirror();
  }

  removeTab(tabId: number): void {
    this.tabs.delete(tabId);
    this.scheduleMirror();
  }

  get(tabId: number): TabStats {
    const total = emptyTabStats();
    const frames = this.tabs.get(tabId);
    if (!frames) return total;
    for (const s of frames.values()) {
      total.scanned += s.scanned;
      total.images += s.images;
      total.videos += s.videos;
      total.protected += s.protected;
      total.revealed += s.revealed;
      total.unverified += s.unverified;
      total.pending += s.pending;
      total.pageMs += s.pageMs;
      total.engineMs += s.engineMs;
      total.frames++;
    }
    total.updatedAt = Date.now();
    return total;
  }

  private scheduleMirror(): void {
    if (this.mirrorTimer) return;
    this.mirrorTimer = setTimeout(() => {
      this.mirrorTimer = undefined;
      const session = (ext().storage as Partial<typeof chrome.storage>).session;
      if (!session) return;
      const out: Record<string, Record<string, FrameStats>> = {};
      for (const [tabId, frames] of this.tabs) out[tabId] = Object.fromEntries(frames);
      void session.set({ [SESSION_KEY]: out }).catch(() => undefined);
    }, 1000);
  }
}
