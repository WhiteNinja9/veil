import { describe, expect, it } from 'vitest';
import { categoriesForLevel } from '../../src/policy/presets';
import { resolvePolicy } from '../../src/policy/resolve';
import type { SiteRule } from '../../src/sites/rules';
import { defaultSettings } from '../../src/storage/schema';

const rule = (pattern: string, mode: SiteRule['mode'], expiresAt: number | null = null): SiteRule => ({
  id: pattern.replace(/\W/g, '').padEnd(8, '0'),
  pattern,
  mode,
  createdAt: 0,
  expiresAt,
});
const NOW = 1_700_000_000_000;

describe('resolvePolicy', () => {
  it('uses global settings by default', () => {
    const { policy, rule: matched } = resolvePolicy(defaultSettings(), 'example.com', NOW);
    expect(policy.active).toBe(true);
    expect(policy.level).toBe('balanced');
    expect(policy.source).toBe('global');
    expect(matched).toBeNull();
  });

  it('is inactive when disabled or paused', () => {
    expect(resolvePolicy({ ...defaultSettings(), enabled: false }, 'a.com', NOW).policy.inactiveReason).toBe(
      'disabled',
    );
    const paused = resolvePolicy({ ...defaultSettings(), pausedUntil: NOW + 1000 }, 'a.com', NOW).policy;
    expect(paused.active).toBe(false);
    expect(paused.inactiveReason).toBe('paused');
    expect(resolvePolicy({ ...defaultSettings(), pausedUntil: NOW - 1 }, 'a.com', NOW).policy.active).toBe(
      true,
    );
  });

  it('applies site levels using that level’s preset, keeping region preferences', () => {
    const settings = { ...defaultSettings(), sites: [rule('reddit.com', 'strict')] };
    settings.categories.faces.enabled = true;
    const { policy } = resolvePolicy(settings, 'old.reddit.com', NOW);
    expect(policy.level).toBe('strict');
    expect(policy.source).toBe('site');
    expect(policy.categories.suggestive.threshold).toBe(categoriesForLevel('strict').suggestive.threshold);
    expect(policy.categories.faces.enabled).toBe(true);
    expect(policy.fallback).toBe('protect');
  });

  it('keeps user-customised thresholds when the site level equals the global level', () => {
    const settings = { ...defaultSettings(), sites: [rule('a.com', 'balanced')] };
    settings.categories.explicit.threshold = 0.42;
    expect(resolvePolicy(settings, 'a.com', NOW).policy.categories.explicit.threshold).toBe(0.42);
  });

  it('pauses sites with an "off" rule until it expires', () => {
    const settings = { ...defaultSettings(), sites: [rule('a.com', 'off', NOW + 60_000)] };
    expect(resolvePolicy(settings, 'www.a.com', NOW).policy.inactiveReason).toBe('site-off');
    expect(resolvePolicy(settings, 'www.a.com', NOW + 120_000).policy.active).toBe(true);
  });

  it('Strict Browsing floors the level, hardens reveal and ignores pauses', () => {
    const settings = {
      ...defaultSettings(),
      strictness: 'minimal' as const,
      categories: categoriesForLevel('minimal'),
      strictBrowsing: {
        enabled: true,
        safeSearch: true,
        youtubeRestricted: true,
        ignoreSiteExceptions: true,
      },
      sites: [rule('a.com', 'off')],
      pausedUntil: NOW + 10_000,
    };
    settings.reveal.mode = 'hover';
    const { policy } = resolvePolicy(settings, 'a.com', NOW);
    expect(policy.active).toBe(true);
    expect(policy.level).toBe('strict');
    expect(policy.source).toBe('strict-browsing');
    expect(policy.reveal.mode).toBe('hold');
    expect(policy.reveal.confirm).toBe(true);
    expect(policy.fallback).toBe('protect');
    expect(policy.video.autoRestore).toBe(false);
  });

  it('Strict Browsing never lowers a stricter site level', () => {
    const settings = { ...defaultSettings(), sites: [rule('a.com', 'maximum')] };
    settings.strictBrowsing.enabled = true;
    expect(resolvePolicy(settings, 'a.com', NOW).policy.level).toBe('maximum');
  });
});
