import type { StrictnessLevel } from '../policy/types';
import { normalizeHostInput } from '../shared/url';

/**
 * Per-site rules.
 *
 * Pattern syntax (documented in the Sites settings screen):
 *   example.com       example.com and all of its subdomains
 *   *.example.com     subdomains of example.com only
 *   =example.com      exactly example.com
 *   *.example.*       glob: `*` matches one or more whole labels
 */
export type SiteMode = 'off' | StrictnessLevel | 'warn' | 'block';
export const SITE_MODES: readonly SiteMode[] = ['off', 'minimal', 'balanced', 'strict', 'maximum', 'warn', 'block'];

export interface SiteRule {
  id: string;
  pattern: string;
  mode: SiteMode;
  createdAt: number;
  /** Epoch ms after which the rule no longer applies; null = permanent. */
  expiresAt: number | null;
  /** Cleared when the browser restarts (e.g. "pause until I close the browser"). */
  sessionOnly?: boolean;
}

export type PatternKind = 'exact' | 'domain' | 'subdomains' | 'glob';

export interface CompiledPattern {
  pattern: string;
  kind: PatternKind;
  host: string;
  regex: RegExp | null;
  specificity: number;
}

export type PatternError = 'empty' | 'invalid' | 'too-broad';

const LABEL = /^(\*|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?|xn--[a-z0-9-]+)$/;

export function parsePattern(input: string): { ok: true; value: CompiledPattern } | { ok: false; error: PatternError } {
  let raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, error: 'empty' };

  let kind: PatternKind = 'domain';
  if (raw.startsWith('=')) {
    kind = 'exact';
    raw = raw.slice(1);
  }
  // Tolerate pasted URLs: strip scheme, path, query, port.
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  if (!raw.includes('*')) {
    const host = normalizeHostInput(raw);
    if (!host || (!host.includes('.') && host !== 'localhost')) return { ok: false, error: 'invalid' };
    if (!host.split('.').every((label) => LABEL.test(label))) return { ok: false, error: 'invalid' };
    const pattern = kind === 'exact' ? `=${host}` : host;
    return {
      ok: true,
      value: { pattern, kind, host, regex: null, specificity: (kind === 'exact' ? 2000 : 1000) + host.length },
    };
  }

  if (kind === 'exact') return { ok: false, error: 'invalid' };
  const labels = raw.split('.');
  if (!labels.every((label) => LABEL.test(label))) return { ok: false, error: 'invalid' };
  const literal = labels.filter((l) => l !== '*');
  if (literal.length === 0) return { ok: false, error: 'too-broad' };

  if (labels[0] === '*' && !labels.slice(1).includes('*')) {
    const host = labels.slice(1).join('.');
    if (!host.includes('.')) return { ok: false, error: 'too-broad' };
    return { ok: true, value: { pattern: `*.${host}`, kind: 'subdomains', host, regex: null, specificity: 900 + host.length } };
  }

  if (literal.length === 1 && literal[0]!.length < 3) return { ok: false, error: 'too-broad' };
  const source = labels.map((l) => (l === '*' ? '[a-z0-9-]+(?:\\.[a-z0-9-]+)*' : l.replace(/-/g, '\\-'))).join('\\.');
  return {
    ok: true,
    value: {
      pattern: labels.join('.'),
      kind: 'glob',
      host: literal.join('.'),
      regex: new RegExp(`^${source}$`),
      specificity: 100 + literal.join('').length,
    },
  };
}

export function matchesHost(compiled: CompiledPattern, hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  switch (compiled.kind) {
    case 'exact':
      return host === compiled.host;
    case 'domain':
      return host === compiled.host || host.endsWith(`.${compiled.host}`);
    case 'subdomains':
      return host !== compiled.host && host.endsWith(`.${compiled.host}`);
    case 'glob':
      return compiled.regex!.test(host);
  }
}

export function isRuleActive(rule: SiteRule, now: number): boolean {
  return rule.expiresAt === null || rule.expiresAt > now;
}

const compiledCache = new Map<string, CompiledPattern | null>();

function compile(pattern: string): CompiledPattern | null {
  let compiled = compiledCache.get(pattern);
  if (compiled === undefined) {
    const parsed = parsePattern(pattern);
    compiled = parsed.ok ? parsed.value : null;
    if (compiledCache.size > 500) compiledCache.clear();
    compiledCache.set(pattern, compiled);
  }
  return compiled;
}

/** Most specific active rule matching `hostname`, or null. Temporary rules win ties. */
export function findRule(rules: readonly SiteRule[], hostname: string, now: number): SiteRule | null {
  let best: { rule: SiteRule; specificity: number } | null = null;
  for (const rule of rules) {
    if (!isRuleActive(rule, now)) continue;
    const compiled = compile(rule.pattern);
    if (!compiled || !matchesHost(compiled, hostname)) continue;
    const specificity = compiled.specificity + (rule.expiresAt !== null ? 0.5 : 0);
    if (!best || specificity > best.specificity) best = { rule, specificity };
  }
  return best?.rule ?? null;
}

export function createRuleId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
