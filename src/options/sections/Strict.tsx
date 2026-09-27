import type { JSX } from 'preact';
import { useApp } from '../../ui/app-context';
import { Switch } from '../../ui/components/controls';
import { Banner, Card, Row } from '../../ui/components/layout';
import { Icon } from '../../ui/icons';

export function StrictSection(): JSX.Element {
  const { settings, t, update, lock, managed } = useApp();
  const strict = settings.strictBrowsing;
  const enforced = Boolean(managed?.strictBrowsing);
  return (
    <div class="stack">
      <Card class={`strict-hero${strict.enabled ? ' strict-hero--on' : ''}`}>
        <div class="strict-hero__head" id="strict">
          <span class="strict-hero__icon" aria-hidden="true">
            <Icon name="shield" />
          </span>
          <div class="row__text">
            <h2 class="strict-hero__title">{t.t('strict.title')}</h2>
            <p class="row__desc">{t.t('strict.desc')}</p>
          </div>
          <Switch size="lg" checked={strict.enabled} disabled={enforced} label={t.t('strict.title')} onChange={(enabled) => void update({ strictBrowsing: { enabled } })} />
        </div>
        <ul class="checklist" role="list">
          {(['level', 'reveal', 'fallback', 'pause'] as const).map((key) => (
            <li key={key}>
              <Icon name="check" />
              {t.t(`strict.effect.${key}`)}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div class="list">
          <Row id="safesearch" label={t.t('strict.safeSearch')} description={t.t('strict.safeSearch.desc')} disabled={!strict.enabled}>
            <Switch checked={strict.safeSearch} disabled={!strict.enabled} label={t.t('strict.safeSearch')} onChange={(safeSearch) => void update({ strictBrowsing: { safeSearch } })} />
          </Row>
          <Row id="youtube" label={t.t('strict.youtube')} description={t.t('strict.youtube.desc')} disabled={!strict.enabled}>
            <Switch
              checked={strict.youtubeRestricted}
              disabled={!strict.enabled}
              label={t.t('strict.youtube')}
              onChange={(youtubeRestricted) => void update({ strictBrowsing: { youtubeRestricted } })}
            />
          </Row>
          <Row id="exceptions" label={t.t('strict.siteExceptions')} description={t.t('strict.siteExceptions.desc')} disabled={!strict.enabled}>
            <Switch
              checked={strict.ignoreSiteExceptions}
              disabled={!strict.enabled}
              label={t.t('strict.siteExceptions')}
              onChange={(ignoreSiteExceptions) => void update({ strictBrowsing: { ignoreSiteExceptions } })}
            />
          </Row>
        </div>
      </Card>

      {!lock && (
        <Banner tone="accent" icon="lock">
          {t.t('strict.lockHint')}{' '}
          <a href="#advanced/lock">{t.t('lock.set')}</a>
        </Banner>
      )}
      <Banner icon="info">{t.t('strict.limits')}</Banner>
    </div>
  );
}
