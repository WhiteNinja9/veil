import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { AppKey } from '../../i18n/app';
import { useApp, sendToBackground } from '../../ui/app-context';
import { Button, Switch } from '../../ui/components/controls';
import { Card, Row } from '../../ui/components/layout';
import { Icon, type IconName } from '../../ui/icons';

interface StatusTile {
  label: AppKey;
  value: AppKey;
  tone: 'positive' | 'neutral';
  icon: IconName;
}

const PERMISSIONS: { name: AppKey; desc: AppKey; firefox?: boolean; chrome?: boolean }[] = [
  { name: 'perm.hosts', desc: 'perm.hosts.desc' },
  { name: 'perm.storage', desc: 'perm.storage.desc' },
  { name: 'perm.dnr', desc: 'perm.dnr.desc' },
  { name: 'perm.scripting', desc: 'perm.scripting.desc' },
  { name: 'perm.menus', desc: 'perm.menus.desc' },
  { name: 'perm.alarms', desc: 'perm.alarms.desc' },
  { name: 'perm.offscreen', desc: 'perm.offscreen.desc', chrome: true },
];

export function PrivacySection(): JSX.Element {
  const { settings, t, update } = useApp();
  const [cleared, setCleared] = useState(false);
  const active = settings.enabled;

  const tiles: StatusTile[] = [
    {
      label: 'privacy.item.protection',
      value: active ? 'privacy.state.on' : 'privacy.state.off',
      tone: active ? 'positive' : 'neutral',
      icon: 'shield',
    },
    { label: 'privacy.item.local', value: 'privacy.state.on', tone: 'positive', icon: 'device' },
    { label: 'privacy.item.cloud', value: 'privacy.state.off', tone: 'positive', icon: 'cloudOff' },
    { label: 'privacy.item.analytics', value: 'privacy.state.off', tone: 'positive', icon: 'chart' },
    { label: 'privacy.item.history', value: 'privacy.state.notCollected', tone: 'positive', icon: 'history' },
    { label: 'privacy.item.uploads', value: 'privacy.state.never', tone: 'positive', icon: 'upload' },
  ];

  const clearCache = async () => {
    await sendToBackground({ type: 'engine/clear-cache' });
    setCleared(true);
    setTimeout(() => setCleared(false), 2400);
  };

  return (
    <div class="stack" id="privacy">
      <p class="lede">{t.t('privacy.lede')}</p>

      <div class="status-grid" role="list">
        {tiles.map((tile) => (
          <div key={tile.label} class="status-tile" role="listitem">
            <span class={`status-tile__icon status-tile__icon--${tile.tone}`} aria-hidden="true">
              <Icon name={tile.icon} />
            </span>
            <span class="status-tile__label">{t.t(tile.label)}</span>
            <span class={`status-tile__value status-tile__value--${tile.tone}`}>{t.t(tile.value)}</span>
          </div>
        ))}
      </div>

      <Card title={t.t('privacy.how.title')}>
        <ol class="steps">
          {(['privacy.how.1', 'privacy.how.2', 'privacy.how.3', 'privacy.how.4'] as const).map((key, i) => (
            <li key={key} class="step">
              <span class="step__num" aria-hidden="true">
                {t.number(i + 1)}
              </span>
              <span>{t.t(key)}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div class="grid-2">
        <Card title={t.t('privacy.stores.title')}>
          <ul class="bullets" role="list">
            {(
              [
                'privacy.stores.settings',
                'privacy.stores.lock',
                'privacy.stores.profile',
                'privacy.stores.memory',
              ] as const
            ).map((key) => (
              <li key={key}>{t.t(key)}</li>
            ))}
          </ul>
        </Card>
        <Card title={t.t('privacy.never.title')}>
          <ul class="bullets bullets--never" role="list">
            {(
              [
                'privacy.never.upload',
                'privacy.never.history',
                'privacy.never.analytics',
                'privacy.never.accounts',
                'privacy.never.sell',
              ] as const
            ).map((key) => (
              <li key={key}>
                <Icon name="x" />
                {t.t(key)}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <div class="list">
          <Row id="stats" label={t.t('privacy.stats')} description={t.t('privacy.stats.desc')}>
            <Switch
              checked={settings.stats.enabled}
              label={t.t('privacy.stats')}
              onChange={(enabled) => void update({ stats: { enabled } })}
            />
          </Row>
          <Row
            id="badge"
            label={t.t('privacy.badge')}
            description={t.t('privacy.badge.desc')}
            disabled={!settings.stats.enabled}
          >
            <Switch
              checked={settings.stats.badge}
              disabled={!settings.stats.enabled}
              label={t.t('privacy.badge')}
              onChange={(badge) => void update({ stats: { badge } })}
            />
          </Row>
          <Row id="clear" label={t.t('privacy.clearCache')} description={t.t('privacy.clearCache.desc')}>
            <Button size="sm" icon={cleared ? 'check' : 'trash'} onClick={() => void clearCache()}>
              {cleared ? t.t('privacy.cleared') : t.t('privacy.clearCache')}
            </Button>
          </Row>
        </div>
      </Card>

      <Card title={t.t('privacy.permissions.title')}>
        <ul class="list permissions" role="list" id="permissions">
          {PERMISSIONS.filter((p) => !(p.chrome && __BROWSER__ === 'firefox')).map((p) => (
            <li key={p.name} class="row">
              <div class="row__text">
                <div class="row__label">{t.t(p.name)}</div>
                <div class="row__desc">{t.t(p.desc)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
