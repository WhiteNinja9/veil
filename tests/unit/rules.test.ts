import { describe, expect, it } from 'vitest';
import { findRule, matchesHost, parsePattern, type SiteRule } from '../../src/sites/rules';

const compile = (p: string) => {
  const r = parsePattern(p);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('parsePattern', () => {
  it('normalises pasted URLs and case', () => {
    expect(compile('https://WWW.Example.com/path?q=1').pattern).toBe('www.example.com');
    expect(compile('Example.COM:8080').pattern).toBe('example.com');
  });

  it('classifies pattern kinds', () => {
    expect(compile('example.com').kind).toBe('domain');
    expect(compile('*.example.com').kind).toBe('subdomains');
    expect(compile('=example.com').kind).toBe('exact');
    expect(compile('*.example.*').kind).toBe('glob');
  });

  it('supports internationalised domains', () => {
    expect(compile('bücher.de').pattern).toBe('xn--bcher-kva.de');
  });

  it('rejects invalid and over-broad patterns', () => {
    expect(parsePattern('')).toEqual({ ok: false, error: 'empty' });
    expect(parsePattern('not a domain')).toEqual({ ok: false, error: 'invalid' });
    expect(parsePattern('*')).toMatchObject({ ok: false });
    expect(parsePattern('*.com')).toEqual({ ok: false, error: 'too-broad' });
    expect(parsePattern('*.*')).toEqual({ ok: false, error: 'too-broad' });
    expect(parsePattern('a.*')).toEqual({ ok: false, error: 'too-broad' });
    expect(parsePattern('=*.example.com')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('matchesHost', () => {
  it('domain patterns include subdomains', () => {
    const p = compile('example.com');
    expect(matchesHost(p, 'example.com')).toBe(true);
    expect(matchesHost(p, 'a.b.example.com')).toBe(true);
    expect(matchesHost(p, 'notexample.com')).toBe(false);
    expect(matchesHost(p, 'example.com.evil.net')).toBe(false);
  });

  it('subdomain patterns exclude the apex', () => {
    const p = compile('*.example.com');
    expect(matchesHost(p, 'example.com')).toBe(false);
    expect(matchesHost(p, 'www.example.com')).toBe(true);
  });

  it('exact patterns match one host only', () => {
    const p = compile('=example.com');
    expect(matchesHost(p, 'example.com')).toBe(true);
    expect(matchesHost(p, 'www.example.com')).toBe(false);
  });

  it('glob wildcards match whole labels', () => {
    const p = compile('*.example.*');
    expect(matchesHost(p, 'www.example.co.uk')).toBe(true);
    expect(matchesHost(p, 'www.example.org')).toBe(true);
    expect(matchesHost(p, 'example.org')).toBe(false);
    expect(matchesHost(p, 'www.myexample.org')).toBe(false);
  });
});

describe('findRule', () => {
  const r = (pattern: string, mode: SiteRule['mode'], expiresAt: number | null = null): SiteRule => ({
    id: pattern,
    pattern,
    mode,
    createdAt: 0,
    expiresAt,
  });

  it('prefers the most specific rule', () => {
    const rules = [r('example.com', 'strict'), r('news.example.com', 'off'), r('*.example.*', 'block')];
    expect(findRule(rules, 'news.example.com', 0)?.mode).toBe('off');
    expect(findRule(rules, 'www.example.com', 0)?.mode).toBe('strict');
    expect(findRule(rules, 'www.example.org', 0)?.mode).toBe('block');
    expect(findRule(rules, 'other.org', 0)).toBeNull();
  });

  it('ignores expired rules and lets temporary rules win ties', () => {
    const rules = [r('example.com', 'strict'), r('example.com', 'off', 1000)];
    expect(findRule(rules, 'example.com', 500)?.mode).toBe('off');
    expect(findRule(rules, 'example.com', 2000)?.mode).toBe('strict');
  });
});
