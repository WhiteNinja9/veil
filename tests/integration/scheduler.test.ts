import { describe, expect, it } from 'vitest';
import { AnalysisScheduler, type Task } from '../../src/content/engine/scheduler';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AnalysisScheduler', () => {
  it('runs visible work first and caps concurrency', async () => {
    const scheduler = new AnalysisScheduler(2);
    const started: number[] = [];
    let running = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const task = (id: number, priority: 0 | 1 | 2): Task => ({
      id,
      priority,
      seq: id,
      isValid: () => true,
      run: () =>
        new Promise<void>((resolve) => {
          started.push(id);
          running++;
          peak = Math.max(peak, running);
          release.push(() => {
            running--;
            resolve();
          });
        }),
    });
    scheduler.enqueue(task(1, 2));
    scheduler.enqueue(task(2, 1));
    scheduler.enqueue(task(3, 0));
    scheduler.enqueue(task(4, 0));
    await flush();
    expect(started).toEqual([3, 4]);
    release.shift()!();
    await flush();
    expect(started).toEqual([3, 4, 2]);
    while (release.length) {
      release.shift()!();
      await flush();
    }
    expect(started).toEqual([3, 4, 2, 1]);
    expect(peak).toBe(2);
  });

  it('drops obsolete tasks and honours reprioritisation', async () => {
    const scheduler = new AnalysisScheduler(1);
    const order: number[] = [];
    let block!: () => void;
    scheduler.enqueue({ id: 0, priority: 0, seq: 0, isValid: () => true, run: () => new Promise<void>((r) => (block = r)).then(() => void order.push(0)) });
    await flush();
    scheduler.enqueue({ id: 1, priority: 2, seq: 1, isValid: () => true, run: async () => void order.push(1) });
    scheduler.enqueue({ id: 2, priority: 1, seq: 2, isValid: () => false, run: async () => void order.push(2) });
    scheduler.enqueue({ id: 3, priority: 1, seq: 3, isValid: () => true, run: async () => void order.push(3) });
    scheduler.reprioritize(1, 0);
    block();
    for (let i = 0; i < 6; i++) await flush();
    expect(order).toEqual([0, 1, 3]);
    expect(scheduler.pending).toBe(0);
  });
});
