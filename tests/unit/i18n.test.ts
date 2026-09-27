import { describe, expect, it } from 'vitest';
import { createTranslator, resolveLocale, type Message } from '../../src/i18n/core';
import { appAr } from '../../src/i18n/locales/app.ar';
import { appEn } from '../../src/i18n/locales/app.en';
import { appFr } from '../../src/i18n/locales/app.fr';
import { pageAr } from '../../src/i18n/locales/page.ar';
import { pageEn } from '../../src/i18n/locales/page.en';
import { pageFr } from '../../src/i18n/locales/page.fr';

const placeholders = (message: Message) =>
  [...new Set((typeof message === 'string' ? message : Object.values(message).join(' ')).match(/\{\w+\}/g) ?? [])].sort();

describe('catalog completeness', () => {
  for (const [name, en, others] of [
    ['app', appEn, { ar: appAr, fr: appFr }],
    ['page', pageEn, { ar: pageAr, fr: pageFr }],
  ] as const) {
    for (const [locale, catalog] of Object.entries(others)) {
      it(`${name}.${locale} has every key with matching placeholders and plural shape`, () => {
        const record = catalog as Record<string, Message>;
        expect(Object.keys(record).sort()).toEqual(Object.keys(en).sort());
        for (const [key, source] of Object.entries(en as Record<string, Message>)) {
          const target = record[key]!;
          expect(typeof target, key).toBe(typeof source);
          expect(placeholders(target), key).toEqual(placeholders(source));
          expect(String(typeof target === 'string' ? target : target.other).trim().length, key).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('translator', () => {
  it('interpolates and formats numbers per locale', () => {
    const en = createTranslator('en', appEn, appEn);
    expect(en.t('about.version', { version: '1.2.3' })).toBe('Version 1.2.3');
    expect(en.t('common.px', { value: 1200 })).toBe('1,200 px');
    const fr = createTranslator('fr', appFr, appEn);
    expect(fr.number(1200)).toMatch(/^1[\s\u202f\u00a0]200$/);
  });

  it('selects all six Arabic plural forms', () => {
    const ar = createTranslator('ar', appAr, appEn);
    const forms = [0, 1, 2, 3, 11, 100].map((count) => ar.t('sites.count', { count }));
    expect(new Set(forms).size).toBe(6);
    expect(ar.dir).toBe('rtl');
  });

  it('falls back to English for missing keys', () => {
    const t = createTranslator('fr', {} as typeof appEn, appEn);
    expect(t.t('app.name')).toBe('Veil');
  });

  it('resolves the locale from preference and browser language', () => {
    expect(resolveLocale('auto', 'ar-SA')).toBe('ar');
    expect(resolveLocale('auto', 'fr-CA')).toBe('fr');
    expect(resolveLocale('auto', 'de-DE')).toBe('en');
    expect(resolveLocale('fr', 'ar')).toBe('fr');
  });
});
