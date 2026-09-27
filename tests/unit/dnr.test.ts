import { beforeAll, describe, expect, it } from 'vitest';
import { buildSiteRules, buildStrictBrowsingRules, patternToUrlRegex } from '../../src/background/dnr';
import type { SiteRule } from '../../src/sites/rules';
import { defaultSettings, mergeSettings } from '../../src/storage/schema';
import { installChromeMock } from '../helpers/chrome-mock';

const rule = (pattern: string, mode: SiteRule['mode'], expiresAt: number | null = null): SiteRule => ({ id: 'aaaaaaaa', pattern, mode, createdAt: 0, expiresAt });

describe('patternToUrlRegex', () => {
  const matches = (pattern: string, url: string) => new RegExp(patternToUrlRegex(pattern)!).test(url);

  it('matches domain patterns including subdomains, ports, paths and query', () => {
    expect(matches('example.com', 'https://example.com/')).toBe(true);
    expect(matches('example.com', 'http://www.example.com:8080/a?b#c')).toBe(true);
    expect(matches('example.com', 'https://example.com')).toBe(true);
    expect(matches('example.com', 'https://notexample.com/')).toBe(false);
    expect(matches('example.com', 'https://example.com.evil.net/')).toBe(false);
    expect(matches('example.com', 'https://evil.net/?next=https://example.com/')).toBe(false);
    expect(matches('example.com', 'https://user@evil.net/')).toBe(false);
  });

  it('respects exact and subdomain-only patterns', () => {
    expect(matches('=example.com', 'https://example.com/x')).toBe(true);
    expect(matches('=example.com', 'https://www.example.com/x')).toBe(false);
    expect(matches('*.example.com', 'https://example.com/x')).toBe(false);
    expect(matches('*.example.com', 'https://a.example.com/x')).toBe(true);
  });

  it('handles globs and rejects invalid patterns', () => {
    expect(matches('*.example.*', 'https://www.example.co.uk/')).toBe(true);
    expect(matches('*.example.*', 'https://www.examples.org/')).toBe(false);
    expect(patternToUrlRegex('not valid')).toBeNull();
  });
});

describe('rule builders', () => {
  beforeAll(() => installChromeMock());

  it('creates redirect rules only for active block/warn rules', () => {
    const rules = buildSiteRules([rule('a.com', 'block'), rule('b.com', 'warn'), rule('c.com', 'off'), rule('d.com', 'block', 10)], 100);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.action.redirect?.regexSubstitution).toContain('interstitial.html#block|\\0');
    expect(rules[1]!.action.redirect?.regexSubstitution).toContain('#warn|');
    expect(rules[0]!.priority).toBeGreaterThan(rules[1]!.priority!);
    expect(rules.every((r) => r.condition.resourceTypes?.length === 1 && r.condition.resourceTypes[0] === 'main_frame')).toBe(true);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  it('adds SafeSearch and YouTube rules only under Strict Browsing', () => {
    expect(buildStrictBrowsingRules(defaultSettings())).toEqual([]);
    const strict = mergeSettings(defaultSettings(), { strictBrowsing: { enabled: true } });
    const rules = buildStrictBrowsingRules(strict);
    const google = rules.find((r) => r.id === 1)!;
    expect(new RegExp(google.condition.regexFilter!).test('https://www.google.co.uk/search?q=x')).toBe(true);
    expect(new RegExp(google.condition.regexFilter!).test('https://www.google.com/maps')).toBe(false);
    expect(google.action.redirect?.transform?.queryTransform?.addOrReplaceParams).toEqual([{ key: 'safe', value: 'active' }]);
    expect(rules.find((r) => r.id === 20)?.action.requestHeaders?.[0]).toMatchObject({ header: 'YouTube-Restrict', value: 'Strict' });
    const noYoutube = buildStrictBrowsingRules(mergeSettings(strict, { strictBrowsing: { youtubeRestricted: false } }));
    expect(noYoutube.find((r) => r.id === 20)).toBeUndefined();
  });
});
