import type { Language } from '../storage/schema';
import { createTranslator, type Locale, resolveLocale, type Translator, uiLanguage } from './core';
import { appAr } from './locales/app.ar';
import { type AppKey, appEn } from './locales/app.en';
import { appFr } from './locales/app.fr';

const CATALOGS = { en: appEn, ar: appAr, fr: appFr };

export type AppTranslator = Translator<AppKey>;

export function appTranslator(language: Language | Locale): AppTranslator {
  const locale = resolveLocale(language, uiLanguage());
  return createTranslator<AppKey>(locale, CATALOGS[locale], appEn);
}

/** Native language names for the language picker (always shown in their own script). */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ar: 'العربية', fr: 'Français' };

export type { AppKey };
