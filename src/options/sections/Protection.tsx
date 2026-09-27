import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { PRESETS, sensitivityToThreshold, thresholdToSensitivity } from '../../policy/presets';
import { type CategoryId, type FallbackAction, REVEAL_MODES, type RevealMode } from '../../policy/types';
import { levelPatch, openShortcutSettings, readShortcuts } from '../../ui/actions';
import { useApp } from '../../ui/app-context';
import { Button, Segmented, Select, Slider, Switch } from '../../ui/components/controls';
import { Card, Choice, Row } from '../../ui/components/layout';

function ContentCategory({ id }: { id: 'explicit' | 'illustrated' | 'suggestive' }): JSX.Element {
  const { settings, t, update } = useApp();
  const setting = settings.categories[id];
  const [draft, setDraft] = useState(thresholdToSensitivity(setting.threshold));
  useEffect(() => setDraft(thresholdToSensitivity(setting.threshold)), [setting.threshold]);
  const threshold = sensitivityToThreshold(draft);

  return (
    <div class="row row--stack" id={`cat-${id}`}>
      <div class="row__inline">
        <div class="row__text">
          <div class="row__label">{t.t(`category.${id}`)}</div>
          <div class="row__desc">{t.t(`category.${id}.desc`)}</div>
        </div>
        <Switch checked={setting.enabled} label={t.t(`category.${id}`)} onChange={(enabled) => void update({ categories: { [id]: { enabled } } })} />
      </div>
      {setting.enabled && (
        <div class="sensitivity">
          <div class="sensitivity__head">
            <label class="field__label" for={`sens-${id}`}>
              {t.t('category.sensitivity')}
            </label>
            <span class="subtle num small">{t.t('category.threshold', { value: t.number(threshold, { minimumFractionDigits: 2 }) })}</span>
          </div>
          <Slider
            id={`sens-${id}`}
            min={0}
            max={100}
            value={draft}
            label={t.t('category.sensitivity')}
            valueText={`${draft}%`}
            onChange={setDraft}
            onCommit={async (value) => {
              const ok = await update({ categories: { [id]: { threshold: sensitivityToThreshold(value) } } });
              if (!ok) setDraft(thresholdToSensitivity(setting.threshold));
            }}
          />
          <div class="sensitivity__scale subtle small">
            <span>{t.t('category.sensitivity.low')}</span>
            <span>{t.t('category.sensitivity.high')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RegionCategory({ id }: { id: 'faces' | 'people' }): JSX.Element {
  const { settings, t, update } = useApp();
  const setting = settings.categories[id];
  return (
    <div class="row row--stack" id={`cat-${id}`}>
      <div class="row__inline">
        <div class="row__text">
          <div class="row__label">{t.t(`category.${id}`)}</div>
          <div class="row__desc">{t.t(`category.${id}.desc`)}</div>
        </div>
        <Switch checked={setting.enabled} label={t.t(`category.${id}`)} onChange={(enabled) => void update({ categories: { [id]: { enabled } } })} />
      </div>
      {setting.enabled && (
        <div class="row__inline row__inline--sub">
          <span class="field__label">{t.t('category.scope')}</span>
          <Select<'regions' | 'whole'>
            inline
            label={t.t('category.scope')}
            value={setting.scope}
            options={[
              { value: 'regions', label: t.t('category.scope.regions') },
              { value: 'whole', label: t.t('category.scope.whole') },
            ]}
            onChange={(scope) => void update({ categories: { [id]: { scope } } })}
          />
        </div>
      )}
    </div>
  );
}

export function ProtectionSection(): JSX.Element {
  const { settings, t, update } = useApp();
  const [shortcut, setShortcut] = useState('');
  useEffect(() => {
    void readShortcuts().then((s) => setShortcut(s['reveal-focused'] ?? ''));
  }, []);

  const preset = PRESETS[settings.strictness];
  const reprotectOptions = [0, 10, 30, 60, 300].map((sec) => ({
    value: sec,
    label: sec === 0 ? t.t('common.never') : sec < 60 ? t.t('common.seconds', { count: sec }) : t.t('common.minutes', { count: sec / 60 }),
  }));

  return (
    <div class="stack">
      <Card title={t.t('protection.categories')}>
        <div class="list">
          {(['explicit', 'illustrated', 'suggestive'] as const).map((id) => (
            <ContentCategory key={id} id={id} />
          ))}
        </div>
      </Card>

      <Card title={t.t('protection.modesty')}>
        <p class="card__intro muted small">{t.t('protection.modesty.desc')}</p>
        <div class="list">
          {(['faces', 'people'] as CategoryId[]).map((id) => (
            <RegionCategory key={id} id={id as 'faces' | 'people'} />
          ))}
        </div>
      </Card>

      <Card title={t.t('protection.reveal')}>
        <div class="card__body" id="reveal">
          <div class="choices choices--2" role="radiogroup" aria-label={t.t('protection.reveal.mode')}>
            {REVEAL_MODES.map((mode) => (
              <Choice
                key={mode}
                checked={settings.reveal.mode === mode}
                title={t.t(`reveal.${mode}`)}
                description={t.t(`reveal.${mode}.desc`)}
                onSelect={() => void update({ reveal: { mode: mode as RevealMode } })}
              />
            ))}
          </div>
        </div>
        <div class="list">
          <Row id="confirm" label={t.t('protection.reveal.confirm')} description={t.t('protection.reveal.confirm.desc')} disabled={settings.reveal.mode === 'disabled'}>
            <Switch
              checked={settings.reveal.confirm}
              disabled={settings.reveal.mode === 'disabled' || settings.reveal.mode === 'hover'}
              label={t.t('protection.reveal.confirm')}
              onChange={(confirm) => void update({ reveal: { confirm } })}
            />
          </Row>
          <Row id="reprotect" label={t.t('protection.reveal.reprotect')} description={t.t('protection.reveal.reprotect.desc')}>
            <Select<number>
              inline
              label={t.t('protection.reveal.reprotect')}
              value={settings.reveal.reprotectAfterSec}
              options={reprotectOptions}
              onChange={(reprotectAfterSec) => void update({ reveal: { reprotectAfterSec } })}
            />
          </Row>
          <Row id="shortcut" label={t.t('protection.shortcut')} description={t.t('protection.shortcut.desc')}>
            {shortcut ? <kbd>{shortcut}</kbd> : <span class="subtle small">{t.t('a11y.shortcut.unset')}</span>}
            <Button size="sm" variant="ghost" onClick={() => void openShortcutSettings()}>
              {t.t('protection.shortcut.change')}
            </Button>
          </Row>
        </div>
      </Card>

      <Card title={t.t('protection.advanced')}>
        <div class="list">
          <Row id="context" label={t.t('protection.contextAware')} description={t.t('protection.contextAware.desc')}>
            <Switch checked={settings.contextAware} label={t.t('protection.contextAware')} onChange={(contextAware) => void update({ contextAware })} />
          </Row>
          <Row id="fallback" label={t.t('protection.fallback')} description={t.t('protection.fallback.desc')}>
            <div style={{ width: '240px' }}>
              <Segmented<FallbackAction>
                label={t.t('protection.fallback')}
                value={settings.fallback}
                options={[
                  { value: 'reveal', label: t.t('fallback.reveal') },
                  { value: 'protect', label: t.t('fallback.protect') },
                ]}
                onChange={(fallback) => void update({ fallback })}
              />
            </div>
          </Row>
        </div>
        <div class="card__footer">
          <Button variant="ghost" icon="refresh" onClick={() => void update(levelPatch(preset.level, settings))}>
            {t.t('protection.restoreDefaults', { level: t.t(`level.${settings.strictness}`) })}
          </Button>
        </div>
      </Card>
    </div>
  );
}
