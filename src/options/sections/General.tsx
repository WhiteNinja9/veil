import type { JSX } from 'preact';
import { isCustomized } from '../../policy/presets';
import { STRICTNESS_LEVELS } from '../../policy/types';
import { LANGUAGE_NAMES } from '../../i18n/app';
import type { Language, ThemePreference } from '../../storage/schema';
import { levelPatch } from '../../ui/actions';
import { useApp } from '../../ui/app-context';
import { Button, Segmented, Select, Switch } from '../../ui/components/controls';
import { Banner, Card, Choice, Row } from '../../ui/components/layout';

export function LevelMeter({ level }: { level: number }): JSX.Element {
  return (
    <span class="meter" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} class={i <= level ? 'on' : ''} />
      ))}
    </span>
  );
}

export function GeneralSection(): JSX.Element {
  const { settings, t, update, managed } = useApp();
  const paused = settings.pausedUntil !== null && settings.pausedUntil > Date.now();
  const pauseFor = (minutes: number) => void update({ pausedUntil: Date.now() + minutes * 60_000 });

  return (
    <div class="stack">
      <Card>
        <div class="list">
          <Row
            id="enabled"
            label={t.t('general.protection')}
            description={t.t('general.protection.desc')}
            managed={Boolean(managed?.enforceEnabled)}
            managedLabel={t.t('common.managed')}
          >
            <Switch
              size="lg"
              checked={settings.enabled}
              disabled={Boolean(managed?.enforceEnabled)}
              label={t.t('general.protection')}
              onChange={(enabled) => void update({ enabled })}
            />
          </Row>
          <Row
            id="pause"
            label={t.t('general.pause')}
            description={
              paused
                ? t.t('general.paused', { time: t.relativeTime(settings.pausedUntil!) })
                : t.t('general.pause.desc')
            }
            disabled={!settings.enabled || settings.strictBrowsing.enabled}
          >
            {paused ? (
              <Button variant="soft" icon="play" onClick={() => void update({ pausedUntil: null })}>
                {t.t('general.resume')}
              </Button>
            ) : (
              <div class="button-group">
                {[15, 60, 240].map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    disabled={!settings.enabled || settings.strictBrowsing.enabled}
                    onClick={() => pauseFor(m)}
                  >
                    {t.t(`general.pause.${m}` as 'general.pause.15')}
                  </Button>
                ))}
              </div>
            )}
          </Row>
        </div>
      </Card>

      <Card title={t.t('general.level')}>
        <div class="card__body" id="level">
          <div class="choices choices--2" role="radiogroup" aria-label={t.t('general.level')}>
            {STRICTNESS_LEVELS.map((level, i) => (
              <Choice
                key={level}
                checked={settings.strictness === level}
                title={t.t(`level.${level}`)}
                description={t.t(`level.${level}.desc`)}
                meta={<LevelMeter level={i} />}
                onSelect={() => void update(levelPatch(level, settings))}
              />
            ))}
          </div>
          {isCustomized(settings.strictness, settings.categories) && (
            <Banner tone="accent" icon="sliders">
              <strong>{t.t('general.customized')}.</strong> {t.t('general.customized.desc')}
            </Banner>
          )}
          <p class="subtle small">{t.t('general.level.desc')}</p>
        </div>
      </Card>

      <Card>
        <div class="list">
          <Row id="language" label={t.t('general.language')}>
            <Select<Language>
              inline
              label={t.t('general.language')}
              value={settings.language}
              options={[
                { value: 'auto', label: t.t('general.language.auto') },
                { value: 'en', label: LANGUAGE_NAMES.en },
                { value: 'ar', label: LANGUAGE_NAMES.ar },
                { value: 'fr', label: LANGUAGE_NAMES.fr },
              ]}
              onChange={(language) => void update({ language })}
            />
          </Row>
          <Row id="theme" label={t.t('general.theme')}>
            <div style={{ width: '260px' }}>
              <Segmented<ThemePreference>
                label={t.t('general.theme')}
                value={settings.appearance.theme}
                options={[
                  { value: 'system', label: t.t('theme.system') },
                  { value: 'light', label: t.t('theme.light') },
                  { value: 'dark', label: t.t('theme.dark') },
                ]}
                onChange={(theme) => void update({ appearance: { theme } })}
              />
            </div>
          </Row>
        </div>
      </Card>
    </div>
  );
}
