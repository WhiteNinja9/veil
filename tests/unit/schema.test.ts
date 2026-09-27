import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  mergeSettings,
  sanitizeSettings,
  sanitizeSiteRules,
} from '../../src/storage/schema';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    for (const input of [undefined, null, 42, 'x', [], { enabled: 'yes' }]) {
      const s = sanitizeSettings(input);
      expect(s.enabled).toBe(true);
      expect(s.strictness).toBe('balanced');
    }
  });

  it('clamps numbers and rejects unknown enum values field by field', () => {
    const s = sanitizeSettings({
      strictness: 'strict',
      categories: {
        explicit: { enabled: true, threshold: 7 },
        suggestive: { enabled: 'no', threshold: 0.5 },
      },
      media: { minSize: -10 },
      appearance: { style: 'glitter', theme: 'dark' },
      reveal: { mode: 'telepathy', reprotectAfterSec: 1e9 },
    });
    expect(s.strictness).toBe('strict');
    expect(s.categories.explicit.threshold).toBe(0.99);
    expect(s.categories.suggestive.enabled).toBe(true); // falls back to the strict preset default
    expect(s.categories.suggestive.threshold).toBe(0.5);
    expect(s.media.minSize).toBe(16);
    expect(s.appearance.style).toBe('blur-strong');
    expect(s.appearance.theme).toBe('dark');
    expect(s.reveal.mode).toBe('click');
    expect(s.reveal.reprotectAfterSec).toBe(3600);
  });

  it('drops invalid and duplicate site rules', () => {
    const rules = sanitizeSiteRules([
      { pattern: 'example.com', mode: 'block' },
      { pattern: 'EXAMPLE.com', mode: 'off' },
      { pattern: 'bad domain', mode: 'off' },
      { pattern: 'ok.org', mode: 'nonsense' },
      { pattern: 'x.org', mode: 'warn', expiresAt: 5, id: 'abcdef12' },
      'string',
    ]);
    expect(rules.map((r) => r.pattern)).toEqual(['example.com', 'x.org']);
    expect(rules[1]!.id).toBe('abcdef12');
    expect(rules[1]!.expiresAt).toBe(5);
  });

  it('is idempotent', () => {
    const once = sanitizeSettings({ strictness: 'maximum', sites: [{ pattern: 'a.com', mode: 'off' }] });
    expect(sanitizeSettings(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe('mergeSettings', () => {
  it('deep-merges objects and replaces arrays', () => {
    const base = defaultSettings();
    const next = mergeSettings(base, { media: { videos: false }, sites: [] });
    expect(next.media.videos).toBe(false);
    expect(next.media.images).toBe(true);
    expect(next.sites).toEqual([]);
  });

  it('never lets a patch smuggle invalid values', () => {
    const next = mergeSettings(defaultSettings(), { strictness: 'ultra' as never });
    expect(next.strictness).toBe('balanced');
  });
});
