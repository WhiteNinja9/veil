import { describe, expect, it } from 'vitest';
import { categoriesForLevel } from '../../src/policy/presets';
import { requiresUnlock, weakenedScopes } from '../../src/security/weakening';
import { defaultSettings, mergeSettings, type Settings } from '../../src/storage/schema';
import type { LockRecord } from '../../src/security/lock';

const base = (): Settings => defaultSettings();
const lock = (scope: LockRecord['scope']): LockRecord => ({
  version: 1,
  algorithm: 'PBKDF2-SHA-256',
  iterations: 600000,
  salt: '',
  verifier: '',
  createdAt: 0,
  scope,
  failures: 0,
  lockedOutUntil: null,
});
const NOW = 1_000_000;

describe('weakenedScopes', () => {
  it('flags turning off, pausing and disabling Strict Browsing as "disable"', () => {
    const s = base();
    expect(weakenedScopes(s, mergeSettings(s, { enabled: false }), NOW)).toEqual(new Set(['disable']));
    expect(weakenedScopes(s, mergeSettings(s, { pausedUntil: NOW + 1000 }), NOW).has('disable')).toBe(true);
    const strict = mergeSettings(s, { strictBrowsing: { enabled: true } });
    expect(
      weakenedScopes(strict, mergeSettings(strict, { strictBrowsing: { enabled: false } }), NOW).has(
        'disable',
      ),
    ).toBe(true);
  });

  it('flags lower levels, higher thresholds and weaker reveal as "settings"', () => {
    const s = mergeSettings(base(), { strictness: 'strict', categories: categoriesForLevel('strict') });
    expect(weakenedScopes(s, mergeSettings(s, { strictness: 'balanced' }), NOW).has('settings')).toBe(true);
    expect(
      weakenedScopes(s, mergeSettings(s, { categories: { explicit: { threshold: 0.9 } } }), NOW).has(
        'settings',
      ),
    ).toBe(true);
    expect(
      weakenedScopes(s, mergeSettings(s, { categories: { suggestive: { enabled: false } } }), NOW).has(
        'settings',
      ),
    ).toBe(true);
    expect(weakenedScopes(s, mergeSettings(s, { reveal: { mode: 'hover' } }), NOW).has('settings')).toBe(
      true,
    );
    expect(weakenedScopes(s, mergeSettings(s, { media: { videos: false } }), NOW).has('settings')).toBe(true);
  });

  it('never requires unlocking to be stricter', () => {
    const s = base();
    const stricter = mergeSettings(s, {
      strictness: 'maximum',
      categories: categoriesForLevel('maximum'),
      reveal: { mode: 'disabled' },
      fallback: 'protect',
      strictBrowsing: { enabled: true },
    });
    expect(weakenedScopes(s, stricter, NOW).size).toBe(0);
    const blocked = mergeSettings(s, {
      sites: [{ id: 'aaaaaaaa', pattern: 'a.com', mode: 'block', createdAt: 0, expiresAt: null }],
    });
    expect(weakenedScopes(s, blocked, NOW).size).toBe(0);
  });

  it('flags site exceptions and rule removals as "sites"', () => {
    const s = base();
    const paused = mergeSettings(s, {
      sites: [{ id: 'aaaaaaaa', pattern: 'a.com', mode: 'off', createdAt: 0, expiresAt: null }],
    });
    expect(weakenedScopes(s, paused, NOW).has('sites')).toBe(true);
    const blocked = mergeSettings(s, {
      sites: [{ id: 'bbbbbbbb', pattern: 'b.com', mode: 'block', createdAt: 0, expiresAt: null }],
    });
    expect(weakenedScopes(blocked, mergeSettings(blocked, { sites: [] }), NOW).has('sites')).toBe(true);
  });

  it('requiresUnlock honours the lock scope', () => {
    const s = base();
    const off = mergeSettings(s, { enabled: false });
    expect(requiresUnlock(null, s, off, NOW)).toBe(false);
    expect(requiresUnlock(lock({ settings: true, disable: false, sites: true }), s, off, NOW)).toBe(false);
    expect(requiresUnlock(lock({ settings: false, disable: true, sites: false }), s, off, NOW)).toBe(true);
  });
});
