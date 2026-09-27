import type { JSX } from 'preact';
import { useApp } from '../../ui/app-context';
import { Card } from '../../ui/components/layout';
import { Icon, Mark } from '../../ui/icons';

export function AboutSection(): JSX.Element {
  const { t } = useApp();
  return (
    <div class="stack">
      <Card class="about-hero">
        <div class="about-hero__body">
          <Mark size={44} />
          <div>
            <h2 class="about-hero__title">{t.t('app.name')}</h2>
            <p class="muted">{t.t('about.tagline')}</p>
            <p class="subtle small num">{t.t('about.version', { version: __VERSION__ })}</p>
          </div>
        </div>
      </Card>

      <Card title={t.t('about.limits.title')}>
        <ul class="bullets" role="list" id="limits">
          {(['about.limits.1', 'about.limits.2', 'about.limits.3', 'about.limits.4', 'about.limits.5'] as const).map((key) => (
            <li key={key}>{t.t(key)}</li>
          ))}
        </ul>
      </Card>

      <Card title={t.t('about.models.title')}>
        <ul class="bullets" role="list">
          {(['about.model.nsfw', 'about.model.faces', 'about.model.people'] as const).map((key) => (
            <li key={key}>
              <Icon name="cpu" />
              {t.t(key)}
            </li>
          ))}
        </ul>
        <p class="card__intro subtle small">{t.t('about.oss')}</p>
      </Card>
    </div>
  );
}
