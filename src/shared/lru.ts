/**
 * Bounded LRU cache with optional per-entry TTL.
 *
 * Map iteration order is insertion order, so re-inserting on access keeps the
 * most recently used entries at the tail and eviction is O(1) from the head.
 */
export interface LruOptions {
  maxEntries: number;
  /** Time-to-live in milliseconds. 0 disables expiry. */
  ttlMs?: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;

  constructor(options: LruOptions) {
    if (options.maxEntries < 1) throw new RangeError('maxEntries must be >= 1');
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs ?? 0;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt && entry.expiresAt <= this.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  /** Reads without affecting recency or hit statistics. */
  peek(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry || (entry.expiresAt && entry.expiresAt <= this.now())) return undefined;
    return entry.value;
  }

  has(key: K): boolean {
    return this.peek(key) !== undefined;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.ttlMs ? this.now() + this.ttlMs : 0 });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Drops expired entries; call opportunistically (e.g. on idle). */
  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.map) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return { size: this.map.size, hits: this.hits, misses: this.misses, hitRate: total ? this.hits / total : 0 };
  }
}
