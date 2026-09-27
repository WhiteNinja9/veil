import type { Language } from '../storage/schema';
import { createTranslator, resolveLocale, type Translator, uiLanguage } from './core';
import { pageAr } from './locales/page.ar';
import { type PageKey, pageEn } from './locales/page.en';
import { pageFr } from './locales/page.fr';

const CATALOGS = { en: pageEn, ar: pageAr, fr: pageFr };

export function pageTranslator(language: Language): Translator<PageKey> {
  const locale = resolveLocale(language, uiLanguage());
  return createTranslator<PageKey>(locale, CATALOGS[locale], pageEn);
}

export type { PageKey };
