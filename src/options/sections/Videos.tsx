import type { JSX } from 'preact';
import { useApp } from '../../ui/app-context';
import { Segmented, Switch } from '../../ui/components/controls';
import { Banner, Card, Row } from '../../ui/components/layout';

const SAMPLING = { efficient: 1500, balanced: 1000, thorough: 500 } as const;
type Sampling = keyof typeof SAMPLING;

function samplingOf(ms: number): Sampling {
  if (ms >= 1250) return 'efficient';
  if (ms >= 750) return 'balanced';
  return 'thorough';
}

export function VideosSection(): JSX.Element {
  const { settings, t, update } = useApp();
  const regionsOn = settings.categories.faces.enabled || settings.categories.people.enabled;
  return (
    <div class="stack">
      <Card>
        <div class="list">
          <Row id="videos" label={t.t('videos.videos')} description={t.t('videos.videos.desc')}>
            <Switch checked={settings.media.videos} label={t.t('videos.videos')} onChange={(videos) => void update({ media: { videos } })} />
          </Row>
          <div class="row row--stack" id="sampling">
            <div class="row__text">
              <div class="row__label">{t.t('videos.sampling')}</div>
              <div class="row__desc">{t.t('videos.sampling.desc')}</div>
            </div>
            <Segmented<Sampling>
              label={t.t('videos.sampling')}
              value={samplingOf(settings.video.baseIntervalMs)}
              disabled={!settings.media.videos}
              options={(Object.keys(SAMPLING) as Sampling[]).map((key) => ({ value: key, label: t.t(`videos.sampling.${key}`) }))}
              onChange={(key) => void update({ video: { baseIntervalMs: SAMPLING[key] } })}
            />
          </div>
          <Row id="autorestore" label={t.t('videos.autoRestore')} description={t.t('videos.autoRestore.desc')} disabled={!settings.media.videos}>
            <Switch
              checked={settings.video.autoRestore}
              disabled={!settings.media.videos}
              label={t.t('videos.autoRestore')}
              onChange={(autoRestore) => void update({ video: { autoRestore } })}
            />
          </Row>
          <Row id="regionswhole" label={t.t('videos.regionsWhole')} description={t.t('videos.regionsWhole.desc')} disabled={!regionsOn}>
            <Switch
              checked={settings.video.regionsProtectWhole}
              disabled={!regionsOn || !settings.media.videos}
              label={t.t('videos.regionsWhole')}
              onChange={(regionsProtectWhole) => void update({ video: { regionsProtectWhole } })}
            />
          </Row>
        </div>
      </Card>
      <Banner icon="info">{t.t('videos.limit')}</Banner>
    </div>
  );
}
