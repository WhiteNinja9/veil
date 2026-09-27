/**
 * Lightweight i18n runtime.
 *
 * - Catalogs are plain TypeScript objects; every non-English catalog is
 *   type-checked against the English one, so a missing key fails the build.
 * - Plurals use Intl.PluralRules (Arabic has six forms: zero, one, two, few,
 *   many, other). `#` inside a plural form is replaced by the formatted count.
 * - `{name}` placeholders are interpolated; numbers are locale-formatted.
 * - We do not use chrome.i18n at runtime because it cannot switch language
 *   without a browser restart; manifest strings still use _locales/.
 */

export type Locale = 'en' | 'ar' | 'fr';
export const LOCALES: readonly Locale[] = ['en', 'ar', 'fr'];
export const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);

export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | PluralForms;
export type Catalog<K extends string = string> = Record<K, Message>;
export type Params = Record<string, string | number>;

export interface Translator<K extends string> {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t(key: K, params?: Params): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  percent(value: number, fractionDigits?: number): string;
  relativeTime(targetMs: number, nowMs?: number): string;
  list(items: string[]): string;
}

export function resolveLocale(preference: string, uiLanguage: string): Locale {
  if ((LOCALES as readonly string[]).includes(preference)) return preference as Locale;
  const primary = uiLanguage.toLowerCase().split(/[-_]/)[0] ?? 'en';
  return (LOCALES as readonly string[]).includes(primary) ? (primary as Locale) : 'en';
}

export function createTranslator<K extends string>(
  locale: Locale,
  catalog: Catalog<K>,
  fallback: Catalog<K>,
): Translator<K> {
  const numberFormat = new Intl.NumberFormat(locale);
  const pluralRules = new Intl.PluralRules(locale);
  const formatValue = (value: string | number) =>
    typeof value === 'number' ? numberFormat.format(value) : value;

  const interpolate = (template: string, params?: Params) =>
    params
      ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
          name in params ? formatValue(params[name]!) : match,
        )
      : template;

  const t = (key: K, params?: Params): string => {
    const message = catalog[key] ?? fallback[key];
    if (message === undefined) return key;
    if (typeof message === 'string') return interpolate(message, params);
    const count = typeof params?.count === 'number' ? params.count : 0;
    const category = pluralRules.select(count) as keyof PluralForms;
    const form = (count === 0 && message.zero) || message[category] || message.other;
    return interpolate(form.replace(/#/g, numberFormat.format(count)), params);
  };

  return {
    locale,
    dir: RTL_LOCALES.has(locale) ? 'rtl' : 'ltr',
    t,
    number: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    percent: (value, fractionDigits = 0) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: fractionDigits }).format(
        value,
      ),
    relativeTime: (targetMs, nowMs = Date.now()) => {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      const diffSec = Math.round((targetMs - nowMs) / 1000);
      const abs = Math.abs(diffSec);
      if (abs < 60) return rtf.format(diffSec, 'second');
      if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
      return rtf.format(Math.round(diffSec / 86400), 'day');
    },
    list: (items) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items),
  };
}

/** Browser UI language, available in every context we run in. */
export function uiLanguage(): string {
  try {
    const g = globalThis as unknown as { chrome?: typeof chrome; browser?: typeof chrome };
    const api = g.browser ?? g.chrome;
    const lang = api?.i18n?.getUILanguage?.();
    if (lang) return lang;
  } catch {
    // ignore
  }
  return typeof navigator !== 'undefined' ? navigator.language : 'en';
}
