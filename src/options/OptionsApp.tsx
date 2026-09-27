import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../ui/app-context';
import { Icon, Mark } from '../ui/icons';
import { parseHash, searchSettings, SECTIONS, type SectionId } from './registry';
import { AboutSection } from './sections/About';
import { AccessibilitySection } from './sections/Accessibility';
import { AdvancedSection } from './sections/Advanced';
import { GeneralSection } from './sections/General';
import { ImagesSection } from './sections/Images';
import { PerformanceSection } from './sections/Performance';
import { PrivacySection } from './sections/Privacy';
import { ProtectionSection } from './sections/Protection';
import { SitesSection } from './sections/Sites';
import { StrictSection } from './sections/Strict';
import { VideosSection } from './sections/Videos';

const VIEWS: Record<SectionId, () => JSX.Element> = {
  general: GeneralSection,
  protection: ProtectionSection,
  images: ImagesSection,
  videos: VideosSection,
  sites: SitesSection,
  search: StrictSection,
  privacy: PrivacySection,
  performance: PerformanceSection,
  accessibility: AccessibilitySection,
  advanced: AdvancedSection,
  about: AboutSection,
};

export function OptionsApp(): JSX.Element {
  const { t } = useApp();
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const [query, setQuery] = useState('');
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // Deep link to a setting: scroll it into view and highlight it briefly.
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    if (!route.setting) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(route.setting!);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.classList.remove('row--highlight');
      void el.offsetWidth;
      el.classList.add('row--highlight');
      el.querySelector<HTMLElement>('button, input, select')?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [route]);

  const results = useMemo(() => searchSettings(query, (key) => t.t(key)), [query, t]);
  const section = SECTIONS.find((s) => s.id === route.section)!;
  const View = VIEWS[route.section];

  const go = (target: SectionId, setting?: string) => {
    setQuery('');
    location.hash = setting ? `${target}/${setting}` : target;
  };

  return (
    <div class="options">
      <aside class="sidebar">
        <div class="sidebar__brand">
          <Mark size={24} />
          <span>{t.t('app.name')}</span>
        </div>
        <div class="search-input">
          <Icon name="search" />
          <input
            class="input"
            type="search"
            placeholder={t.t('search.placeholder')}
            aria-label={t.t('search.placeholder')}
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) go(results[0].section, results[0].id);
              if (e.key === 'Escape') setQuery('');
            }}
          />
        </div>
        <nav class="nav" aria-label={t.t('common.settings')}>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              class="nav__item"
              aria-current={!query && s.id === route.section ? 'page' : undefined}
              onClick={() => setQuery('')}
            >
              <Icon name={s.icon} />
              <span>{t.t(s.label)}</span>
            </a>
          ))}
        </nav>
        <div class="sidebar__footer subtle">
          <Icon name="lock" />
          <span>{t.t('popup.privacy')}</span>
        </div>
      </aside>

      <main class="content" ref={main} id="main">
        {query ? (
          <div class="page">
            <header class="page__header">
              <h1 class="page__title">{t.t('search.placeholder')}</h1>
              <p class="page__desc" aria-live="polite">
                {results.length ? t.t('search.results', { count: results.length }) : t.t('search.noResults', { query })}
              </p>
            </header>
            <div class="card list">
              {results.map((r) => {
                const sec = SECTIONS.find((s) => s.id === r.section)!;
                return (
                  <button key={r.id} type="button" class="result" onClick={() => go(r.section, r.id)}>
                    <Icon name={sec.icon} />
                    <span class="result__text">
                      <span class="result__crumb">{t.t(sec.label)}</span>
                      <span class="result__label">{t.t(r.label)}</span>
                      {r.description && <span class="result__desc">{t.t(r.description)}</span>}
                    </span>
                    <Icon name="chevronRight" />
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div class="page" key={route.section}>
            <header class="page__header">
              <h1 class="page__title">{t.t(section.label)}</h1>
              <p class="page__desc">{t.t(section.description)}</p>
            </header>
            <View />
          </div>
        )}
      </main>
    </div>
  );
}
