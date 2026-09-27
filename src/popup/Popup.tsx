import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TabStats } from '../background/tab-stats';
import { ext } from '../browser/api';
import type { HostStatus } from '../ml/host/inference-host';
import { STRICTNESS_LEVELS, type StrictnessLevel } from '../policy/types';
import { useApp } from '../ui/app-context';
import { levelPatch } from '../ui/actions';
import { IconButton, Segmented, Switch } from '../ui/components/controls';
import { Stat } from '../ui/components/layout';
import { Icon, Mark } from '../ui/icons';
import {
  BACKEND_LABEL,
  derive,
  loadEngineStatus,
  loadTabContext,
  loadTabStats,
  type PauseDuration,
  pauseSiteRules,
  resumeSiteRules,
  type TabContext,
} from './model';

const REFRESH_MS = 1500;

export function Popup(): JSX.Element {
  const { settings, t, update } = useApp();
  const [tab, setTab] = useState<TabContext | null>(null);
  const [stats, setStats] = useState<TabStats | null>(null);
  const [engine, setEngine] = useState<HostStatus | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);

  useEffect(() => {
    void loadTabContext().then(setTab);
  }, []);

  useEffect(() => {
    if (!tab) return;
    let cancelled = false;
    const refresh = async () => {
      const [s, e] = await Promise.all([loadTabStats(tab.tabId), loadEngineStatus()]);
      if (!cancelled) {
        setStats(s);
        setEngine(e);
      }
    };
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tab]);

  const model = useMemo(() => (tab ? derive(settings, tab) : null), [settings, tab]);
  const n = (value: number) => t.number(value);

  const setLevel = (level: StrictnessLevel) => void update(levelPatch(level, settings));

  const pause = (duration: PauseDuration) => {
    if (!tab) return;
    setPauseOpen(false);
    void update({ sites: pauseSiteRules(settings.sites, tab.host, duration) });
  };

  const resume = () => {
    if (!model) return;
    if (model.status === 'paused-all') void update({ pausedUntil: null });
    else void update({ sites: resumeSiteRules(settings.sites, model.rule) });
  };

  const openSettings = (section?: string) => {
    void ext().tabs.create({ url: ext().runtime.getURL(`options.html${section ? `#${section}` : ''}`) });
    window.close();
  };

  const reinject = async () => {
    if (tab?.tabId == null) return;
    await ext().tabs.reload(tab.tabId);
    window.close();
  };

  const status = model?.status ?? 'active';
  const statusTone = status === 'active' ? 'positive' : status === 'off' || status === 'unsupported' ? 'neutral' : 'caution';
  const statusTitle = {
    active: t.t('popup.status.active'),
    'paused-site': t.t('popup.status.pausedSite'),
    'paused-all': t.t('popup.status.pausedAll'),
    off: t.t('popup.status.off'),
    unsupported: t.t('popup.status.unsupported'),
  }[status];
  const levelName = t.t(`level.${model?.policy?.level ?? settings.strictness}`);

  return (
    <div class="popup" data-status={status}>
      <header class="popup__header">
        <div class="brand">
          <Mark size={20} />
          <span class="brand__name">{t.t('app.name')}</span>
        </div>
        <IconButton icon="settings" label={t.t('common.settings')} onClick={() => openSettings()} />
      </header>

      <section class={`hero hero--${statusTone}`} aria-live="polite">
        <div class="hero__text">
          <div class="hero__title">
            <span class={`dot dot--${statusTone}${status === 'active' ? ' dot--live' : ''}`} aria-hidden="true" />
            <span>{statusTitle}</span>
          </div>
          <div class="hero__detail">
            {status === 'unsupported'
              ? t.t('popup.status.unsupported.desc')
              : model?.resumesAt
                ? t.t('popup.status.resumes', { time: t.relativeTime(model.resumesAt) })
                : status === 'active'
                  ? t.t('popup.status.detail', { level: levelName })
                  : null}
          </div>
          {settings.strictBrowsing.enabled && status !== 'unsupported' && (
            <span class="pill pill--accent hero__pill">
              <Icon name="shield" />
              {t.t('popup.status.strict')}
            </span>
          )}
        </div>
        {status !== 'unsupported' && (
          <Switch size="lg" checked={settings.enabled} label={t.t('popup.protection')} onChange={(enabled) => void update({ enabled })} />
        )}
      </section>

      {tab?.supported && model && (
        <section class="card site">
          <div class="site__head">
            <span class="site__avatar" aria-hidden="true">
              {model.displayHost.slice(0, 1).toUpperCase()}
            </span>
            <div class="site__name" title={tab.host}>
              {model.displayHost}
            </div>
            <span class={`pill${model.rule && model.rule.mode !== 'off' ? ' pill--accent' : ''}`}>
              {model.rule && model.rule.mode !== 'off' ? t.t('popup.site.rule') : t.t('popup.site.default')}
            </span>
          </div>

          {!tab.connected && status === 'active' ? (
            <button type="button" class="site__reload" onClick={() => void reinject()}>
              <Icon name="refresh" />
              <span>
                <strong>{t.t('popup.reload')}</strong>
                <span class="subtle">{t.t('popup.reload.desc')}</span>
              </span>
            </button>
          ) : (
            <>
              <div class="site__label">{t.t('popup.page')}</div>
              <div class="stats">
                <Stat value={stats?.scanned ?? 0} label={t.t('popup.stat.checked')} format={n} />
                <Stat value={stats?.protected ?? 0} label={t.t('popup.stat.hidden')} format={n} />
                <Stat value={stats?.videos ?? 0} label={t.t('popup.stat.videos')} format={n} />
              </div>
              <div class="site__engine subtle">
                <Icon name="cpu" />
                <span>
                  {engine?.running && engine.backend
                    ? t.t('popup.engine.ready', { backend: BACKEND_LABEL[engine.backend] ?? engine.backend, ms: t.t('common.ms', { value: Math.round(engine.avgMs || 0) }) })
                    : engine?.state === 'loading'
                      ? t.t('popup.engine.loading')
                      : t.t('popup.engine.idle')}
                </span>
                {stats && stats.unverified > 0 && <span class="site__unverified">{t.t('popup.engine.unverified', { count: stats.unverified })}</span>}
              </div>
            </>
          )}

          <div class="site__actions">
            {status === 'paused-site' || status === 'paused-all' ? (
              <button type="button" class="btn btn--soft btn--block" onClick={resume}>
                <Icon name="play" />
                {status === 'paused-all' ? t.t('general.resume') : t.t('popup.resumeSite')}
              </button>
            ) : status === 'active' && !settings.strictBrowsing.enabled ? (
              <div class="disclosure">
                <button
                  type="button"
                  class="btn btn--block"
                  aria-expanded={pauseOpen}
                  aria-controls="pause-options"
                  onClick={() => setPauseOpen(!pauseOpen)}
                >
                  <Icon name="pause" />
                  {t.t('popup.pauseSite')}
                  <Icon name="chevronDown" class={`chevron${pauseOpen ? ' chevron--open' : ''}`} />
                </button>
                {pauseOpen && (
                  <div id="pause-options" class="menu" role="group" aria-label={t.t('popup.pauseSite')}>
                    {(['hour', 'session', 'always'] as const).map((d) => (
                      <button key={d} type="button" class="menu__item" onClick={() => pause(d)}>
                        {t.t(`popup.pause.${d}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>
      )}

      {status !== 'unsupported' && (
        <section class="level">
          <div class="level__label" id="level-label">
            {t.t('popup.level.global')}
          </div>
          <Segmented
            value={settings.strictness}
            label={t.t('popup.level.global')}
            options={STRICTNESS_LEVELS.map((level) => ({ value: level, label: t.t(`level.${level}`) }))}
            onChange={setLevel}
          />
          <p class="level__desc">{t.t(`level.${settings.strictness}.desc`)}</p>
        </section>
      )}

      <footer class="popup__footer">
        <button type="button" class="footer__privacy" title={t.t('popup.privacy.full')} onClick={() => openSettings('privacy')}>
          <Icon name="lock" />
          <span>{t.t('popup.privacy')}</span>
        </button>
        <button type="button" class="footer__settings" onClick={() => openSettings()}>
          {t.t('popup.openSettings')}
          <Icon name="chevronRight" />
        </button>
      </footer>
    </div>
  );
}
