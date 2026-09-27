import { describe, expect, it } from 'vitest';
import { differenceHash, hammingDistance, hashString, rgbaToGray } from '../../src/shared/hash';
import { LruCache } from '../../src/shared/lru';
import { displayHost, hostnameOf, isHttpUrl, isPrivateHost, normalizeHostInput } from '../../src/shared/url';
import { retry, throttle, TimeoutError, withTimeout } from '../../src/shared/async';

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.size).toBe(2);
  });

  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new LruCache<string, number>({ maxEntries: 10, ttlMs: 100, now: () => now });
    cache.set('a', 1);
    now = 50;
    expect(cache.get('a')).toBe(1);
    now = 151;
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 2);
    now = 400;
    expect(cache.prune()).toBe(1);
  });

  it('tracks hit rate and ignores peeks', () => {
    const cache = new LruCache<string, number>({ maxEntries: 10 });
    cache.set('a', 1);
    cache.get('a');
    cache.get('missing');
    cache.peek('a');
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, hitRate: 0.5 });
  });

  it('rejects a zero-capacity cache', () => {
    expect(() => new LruCache({ maxEntries: 0 })).toThrow(RangeError);
  });
});

describe('hashing', () => {
  it('hashString is stable and spreads', () => {
    expect(hashString('https://a.com/x.png')).toBe(hashString('https://a.com/x.png'));
    expect(hashString('https://a.com/x.png')).not.toBe(hashString('https://a.com/y.png'));
    expect(hashString('')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differenceHash detects scene changes but tolerates brightness shifts', () => {
    const gradient = Array.from({ length: 72 }, (_, i) => (i % 9) * 20);
    const brighter = gradient.map((v) => v + 30);
    const reversed = gradient.map((v) => 200 - v);
    const a = differenceHash(gradient);
    expect(hammingDistance(a, differenceHash(brighter))).toBe(0);
    expect(hammingDistance(a, differenceHash(reversed))).toBeGreaterThan(40);
  });

  it('rgbaToGray uses luma weights', () => {
    expect(Array.from(rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255]))).toEqual([255, 0]);
  });
});

describe('url helpers', () => {
  it('extracts and normalises hosts', () => {
    expect(hostnameOf('https://WWW.Example.COM./a')).toBe('www.example.com');
    expect(hostnameOf('chrome://settings')).toBe('');
    expect(hostnameOf('not a url')).toBe('');
    expect(normalizeHostInput(' Example.com/path ')).toBe('example.com');
    expect(displayHost('www.example.com')).toBe('example.com');
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('https://a.com')).toBe(true);
  });

  it('recognises private network hosts', () => {
    for (const host of ['localhost', 'a.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.0.1', '169.254.1.1', '100.64.0.1', '::1', 'printer.local', 'fd12::1']) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', '']) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });
});

describe('async helpers', () => {
  it('withTimeout rejects slow promises', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10)).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(Promise.resolve(1), 10)).resolves.toBe(1);
  });

  it('retry stops on fatal errors and succeeds eventually', async () => {
    let calls = 0;
    await expect(retry(async () => (++calls < 3 ? Promise.reject(new Error('x')) : 'ok'), { attempts: 5, baseDelayMs: 1 })).resolves.toBe('ok');
    calls = 0;
    await expect(retry(async () => { calls++; throw new Error('fatal'); }, { attempts: 5, baseDelayMs: 1, shouldRetry: () => false })).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });

  it('throttle delivers the trailing call', async () => {
    const seen: number[] = [];
    const fn = throttle((n: number) => seen.push(n), 20);
    fn(1);
    fn(2);
    fn(3);
    await new Promise((r) => setTimeout(r, 40));
    expect(seen).toEqual([1, 3]);
  });
});
