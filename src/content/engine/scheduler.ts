/**
 * AnalysisScheduler — bounded, priority-ordered dispatch of analysis work.
 *
 * Visible media first, then near-viewport, then the rest. At most
 * `concurrency` requests are in flight per frame so a page with hundreds of
 * thumbnails never floods the engine; obsolete work (element removed, source
 * changed, scrolled far away before dispatch) is dropped before it costs
 * anything.
 */
import type { Priority } from '../../ml/types';

export interface Task {
  id: number;
  priority: Priority;
  seq: number;
  run: () => Promise<void>;
  /** Re-checked right before dispatch; false drops the task. */
  isValid: () => boolean;
}

export class AnalysisScheduler {
  private readonly queue: Task[] = [];
  private inFlight = 0;
  private scheduled = false;

  constructor(private readonly concurrency = 6) {}

  enqueue(task: Task): void {
    const existing = this.queue.findIndex((t) => t.id === task.id);
    if (existing >= 0) this.queue.splice(existing, 1);
    this.queue.push(task);
    this.schedule();
  }

  /** Updates a queued task's priority (e.g. it scrolled into view). */
  reprioritize(id: number, priority: Priority): void {
    const task = this.queue.find((t) => t.id === id);
    if (task && task.priority !== priority) {
      task.priority = priority;
      this.schedule();
    }
  }

  remove(id: number): void {
    const index = this.queue.findIndex((t) => t.id === id);
    if (index >= 0) this.queue.splice(index, 1);
  }

  get pending(): number {
    return this.queue.length + this.inFlight;
  }

  clear(): void {
    this.queue.length = 0;
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.inFlight >= this.concurrency || !this.queue.length) return;
    this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    while (this.inFlight < this.concurrency && this.queue.length) {
      const task = this.queue.shift()!;
      if (!task.isValid()) continue;
      // Off-screen work only runs when nothing more important is waiting.
      if (task.priority === 2 && this.inFlight >= Math.ceil(this.concurrency / 2)) {
        this.queue.unshift(task);
        break;
      }
      this.inFlight++;
      task
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.inFlight--;
          this.schedule();
        });
    }
  }
}
