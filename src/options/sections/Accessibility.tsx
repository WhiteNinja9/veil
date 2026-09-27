import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppKey } from '../../i18n/app';
import type { MotionPreference } from '../../storage/schema';
import { openShortcutSettings, readShortcuts } from '../../ui/actions';
import { useApp } from '../../ui/app-context';
import { Button, Segmented, Switch } from '../../ui/components/controls';
import { Banner, Card, Row } from '../../ui/components/layout';

const COMMANDS: { name: string; label: AppKey }[] = [
  { name: '_execute_action', label: 'a11y.shortcut.open' },
  { name: 'toggle-site', label: 'a11y.shortcut.site' },
  { name: 'reveal-focused', label: 'a11y.shortcut.reveal' },
];

export function AccessibilitySection(): JSX.Element {
  const { settings, t, update } = useApp();
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  useEffect(() => {
    void readShortcuts().then(setShortcuts);
  }, []);

  return (
    <div class="stack">
      <Card>
        <div class="list">
          <div class="row row--stack" id="motion">
            <div class="row__text">
              <div class="row__label">{t.t('a11y.motion')}</div>
              <div class="row__desc">{t.t('a11y.motion.desc')}</div>
            </div>
            <Segmented<MotionPreference>
              label={t.t('a11y.motion')}
              value={settings.appearance.motion}
              options={(['system', 'reduced', 'full'] as const).map((m) => ({
                value: m,
                label: t.t(`a11y.motion.${m}`),
              }))}
              onChange={(motion) => void update({ appearance: { motion } })}
            />
          </div>
          <Row id="chip-a11y" label={t.t('images.chip')} description={t.t('images.chip.desc')}>
            <Switch
              checked={settings.appearance.showChip}
              label={t.t('images.chip')}
              onChange={(showChip) => void update({ appearance: { showChip } })}
            />
          </Row>
        </div>
      </Card>

      <Card
        title={t.t('a11y.shortcuts')}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void openShortcutSettings()}>
            {t.t('protection.shortcut.change')}
          </Button>
        }
      >
        <ul class="list" role="list" id="shortcuts">
          {COMMANDS.map((c) => (
            <li key={c.name} class="row">
              <div class="row__text">
                <div class="row__label">{t.t(c.label)}</div>
              </div>
              {shortcuts[c.name] ? (
                <kbd>{shortcuts[c.name]}</kbd>
              ) : (
                <span class="subtle small">{t.t('a11y.shortcut.unset')}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Banner icon="keyboard">{t.t('a11y.keyboard')}</Banner>
    </div>
  );
}
