import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { STRICTNESS_LEVELS } from '../../policy/types';
import { createRuleId, isRuleActive, parsePattern, type SiteMode, type SiteRule } from '../../sites/rules';
import { useApp } from '../../ui/app-context';
import { Button, IconButton, Select } from '../../ui/components/controls';
import { Card } from '../../ui/components/layout';
import { Icon } from '../../ui/icons';

type Duration = 'permanent' | 'hour' | 'day' | 'week' | 'session';
const DURATION_MS: Record<Duration, number | null> = {
  permanent: null,
  hour: 3600e3,
  day: 86400e3,
  week: 7 * 86400e3,
  session: null,
};

export function SitesSection(): JSX.Element {
  const { settings, t, update } = useApp();
  const [pattern, setPattern] = useState('');
  const [mode, setMode] = useState<SiteMode>('off');
  const [duration, setDuration] = useState<Duration>('permanent');
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const modeLabel = (m: SiteMode) =>
    m === 'off'
      ? t.t('sites.mode.off')
      : m === 'warn'
        ? t.t('sites.mode.warn')
        : m === 'block'
          ? t.t('sites.mode.block')
          : t.t('sites.mode.level', { level: t.t(`level.${m}`) });
  const modeTone = (m: SiteMode) =>
    m === 'off' ? 'caution' : m === 'block' ? 'critical' : m === 'warn' ? 'caution' : 'accent';

  const rules = useMemo(() => {
    const now = Date.now();
    const q = filter.trim().toLowerCase();
    return settings.sites
      .filter((r) => isRuleActive(r, now))
      .filter((r) => !q || r.pattern.includes(q))
      .sort((a, b) => a.pattern.replace(/^[=*.]+/, '').localeCompare(b.pattern.replace(/^[=*.]+/, '')));
  }, [settings.sites, filter]);

  const add = async (event: Event) => {
    event.preventDefault();
    const parsed = parsePattern(pattern);
    if (!parsed.ok) {
      setError(t.t(`sites.error.${parsed.error}`));
      return;
    }
    const now = Date.now();
    const ms = DURATION_MS[duration];
    const rule: SiteRule = {
      id: createRuleId(),
      pattern: parsed.value.pattern,
      mode,
      createdAt: now,
      expiresAt: ms ? now + ms : null,
      ...(duration === 'session' ? { sessionOnly: true } : {}),
    };
    const ok = await update({ sites: [...settings.sites.filter((r) => r.pattern !== rule.pattern), rule] });
    if (ok) {
      setPattern('');
      setError(null);
    }
  };

  const remove = (rule: SiteRule) => void update({ sites: settings.sites.filter((r) => r.id !== rule.id) });

  const modeOptions: { value: SiteMode; label: string }[] = [
    { value: 'off', label: t.t('sites.mode.off') },
    ...STRICTNESS_LEVELS.map((level) => ({
      value: level as SiteMode,
      label: t.t('sites.mode.level', { level: t.t(`level.${level}`) }),
    })),
    { value: 'warn', label: t.t('sites.mode.warn') },
    { value: 'block', label: t.t('sites.mode.block') },
  ];

  return (
    <div class="stack">
      <Card title={t.t('sites.add')}>
        <form class="card__body site-form" id="sites" onSubmit={add} noValidate>
          <div class="field site-form__pattern">
            <label class="field__label" for="site-pattern">
              {t.t('sites.pattern')}
            </label>
            <input
              id="site-pattern"
              class="input mono"
              dir="ltr"
              autocomplete="off"
              spellcheck={false}
              placeholder={t.t('sites.pattern.placeholder')}
              value={pattern}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'site-error' : 'site-help'}
              onInput={(e) => {
                setPattern((e.currentTarget as HTMLInputElement).value);
                setError(null);
              }}
            />
          </div>
          <div class="field">
            <label class="field__label" for="site-mode">
              {t.t('sites.mode')}
            </label>
            <Select<SiteMode>
              id="site-mode"
              label={t.t('sites.mode')}
              value={mode}
              options={modeOptions}
              onChange={setMode}
            />
          </div>
          <div class="field">
            <label class="field__label" for="site-duration">
              {t.t('sites.duration')}
            </label>
            <Select<Duration>
              id="site-duration"
              label={t.t('sites.duration')}
              value={duration}
              options={(Object.keys(DURATION_MS) as Duration[]).map((d) => ({
                value: d,
                label: t.t(`duration.${d}`),
              }))}
              onChange={setDuration}
            />
          </div>
          <div class="site-form__submit">
            <Button type="submit" variant="primary" icon="plus">
              {t.t('common.add')}
            </Button>
          </div>
          {error ? (
            <div id="site-error" class="field__error site-form__note" role="alert">
              {error}
            </div>
          ) : (
            <div id="site-help" class="field__hint site-form__note">
              {t.t('sites.help')}
            </div>
          )}
        </form>
      </Card>

      <Card
        title={t.t('sites.count', { count: rules.length })}
        actions={
          settings.sites.length > 6 ? (
            <div class="search-input" style={{ width: '220px' }}>
              <Icon name="search" />
              <input
                class="input"
                type="search"
                placeholder={t.t('sites.filter')}
                aria-label={t.t('sites.filter')}
                value={filter}
                onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
          ) : undefined
        }
      >
        {rules.length === 0 ? (
          <div class="empty">
            <span class="empty__icon" aria-hidden="true">
              <Icon name="globe" />
            </span>
            <div class="empty__title">{t.t('sites.empty.title')}</div>
            <p class="empty__desc">{t.t('sites.empty.desc')}</p>
          </div>
        ) : (
          <ul class="list rules" role="list">
            {rules.map((rule) => (
              <li key={rule.id} class="rule">
                <span class="rule__pattern mono" dir="ltr">
                  {rule.pattern}
                </span>
                <span class={`pill pill--${modeTone(rule.mode)}`}>{modeLabel(rule.mode)}</span>
                <span class="rule__expiry subtle small">
                  {rule.sessionOnly
                    ? t.t('sites.session')
                    : rule.expiresAt
                      ? t.t('sites.expires', { time: t.relativeTime(rule.expiresAt) })
                      : t.t('sites.permanent')}
                </span>
                <IconButton
                  icon="trash"
                  label={t.t('sites.remove', { pattern: rule.pattern })}
                  onClick={() => remove(rule)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
