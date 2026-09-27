import { describe, expect, it } from 'vitest';
import { parseTarget } from '../../src/interstitial/Interstitial';
import { derive, pauseSiteRules, resumeSiteRules } from '../../src/popup/model';
import { parseHash, searchSettings, SECTIONS, SETTINGS_INDEX } from '../../src/options/registry';
import { createTranslator } from '../../src/i18n/core';
import { appEn } from '../../src/i18n/locales/app.en';
import { defaultSettings } from '../../src/storage/schema';

const tab = (url: string) => ({ tabId: 1, url, host: new URL(url).hostname, supported: true, connected: true });

describe('popup model', () => {
  it('derives status from settings and site rules', () => {
    const settings = defaultSettings();
    expect(derive(settings, tab('https://a.com/')).status).toBe('active');
    expect(derive({ ...settings, enabled: false }, tab('https://a.com/')).status).toBe('off');
    expect(derive({ ...settings, pausedUntil: Date.now() + 1000 }, tab('https://a.com/')).status).toBe('paused-all');
    expect(derive(settings, { ...tab('https://a.com/'), supported: false }).status).toBe('unsupported');
  });

  it('pauses and resumes a site', () => {
    const now = 1000;
    const paused = pauseSiteRules([], 'www.a.com', 'hour', now);
    expect(paused[0]).toMatchObject({ pattern: 'a.com', mode: 'off', expiresAt: now + 3600_000 });
    expect(pauseSiteRules([], 'a.com', 'session', now)[0]!.sessionOnly).toBe(true);
    const settings = { ...defaultSettings(), sites: paused };
    const model = derive(settings, tab('https://www.a.com/'), now + 1);
    expect(model.status).toBe('paused-site');
    expect(resumeSiteRules(paused, model.rule)).toEqual([]);
  });
});

describe('interstitial target parsing', () => {
  it('accepts only http(s) targets', () => {
    expect(parseTarget('#warn|https://a.com/x?y#z')).toEqual({ mode: 'warn', url: 'https://a.com/x?y#z' });
    expect(parseTarget('#block|javascript:alert(1)')).toEqual({ mode: 'block', url: null });
    expect(parseTarget('#anything')).toEqual({ mode: 'block', url: null });
  });
});

describe('settings registry', () => {
  const t = createTranslator('en', appEn, appEn);
  it('every indexed setting belongs to a known section', () => {
    const ids = new Set(SECTIONS.map((s) => s.id));
    for (const entry of SETTINGS_INDEX) expect(ids.has(entry.section)).toBe(true);
  });

  it('searches labels, descriptions and keywords', () => {
    expect(searchSettings('password', (k) => t.t(k)).map((r) => r.id)).toContain('lock');
    expect(searchSettings('webgpu', (k) => t.t(k)).map((r) => r.id)).toContain('backend');
    expect(searchSettings('zzzz', (k) => t.t(k))).toEqual([]);
  });

  it('parses deep links', () => {
    expect(parseHash('#advanced/lock')).toEqual({ section: 'advanced', setting: 'lock' });
    expect(parseHash('#nope')).toEqual({ section: 'general' });
  });
});
