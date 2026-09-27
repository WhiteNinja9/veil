import type { JSX } from 'preact';
import { useMemo, useState, useEffect } from 'preact/hooks';
import { PROTECTION_STYLES, type ProtectionStyle } from '../../policy/types';
import { useApp } from '../../ui/app-context';
import { Slider, Switch } from '../../ui/components/controls';
import { Card, Row } from '../../ui/components/layout';
import { Icon } from '../../ui/icons';

/** A tiny low-resolution rendering of the preview scene, scaled up for the pixelate preview. */
function usePixelatedScene(): string {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const gradient = ctx.createLinearGradient(0, 0, 12, 8);
    gradient.addColorStop(0, '#f2b58c');
    gradient.addColorStop(0.5, '#b58ad8');
    gradient.addColorStop(1, '#6d8fe0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 12, 8);
    ctx.fillStyle = '#ffe6a8';
    ctx.beginPath();
    ctx.arc(8.5, 3, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4e6b52';
    ctx.fillRect(0, 6, 12, 2);
    return canvas.toDataURL();
  }, []);
}

function StylePreview({ style }: { style: ProtectionStyle }): JSX.Element {
  const pixels = usePixelatedScene();
  return (
    <span class={`style-preview style-preview--${style}`} aria-hidden="true">
      {style === 'pixelate' ? (
        <img src={pixels} alt="" />
      ) : style === 'placeholder' ? (
        <Icon name="eyeOff" />
      ) : style === 'solid' || style === 'hide' ? null : (
        <span class="style-preview__scene" />
      )}
    </span>
  );
}

export function ImagesSection(): JSX.Element {
  const { settings, t, update } = useApp();
  const [minSize, setMinSize] = useState(settings.media.minSize);
  useEffect(() => setMinSize(settings.media.minSize), [settings.media.minSize]);
  const media = settings.media;

  return (
    <div class="stack">
      <Card>
        <div class="list">
          <Row id="images" label={t.t('images.images')}>
            <Switch
              checked={media.images}
              label={t.t('images.images')}
              onChange={(images) => void update({ media: { images } })}
            />
          </Row>
          <Row
            id="backgrounds"
            label={t.t('images.backgrounds')}
            description={t.t('images.backgrounds.desc')}
          >
            <Switch
              checked={media.backgrounds}
              label={t.t('images.backgrounds')}
              onChange={(backgrounds) => void update({ media: { backgrounds } })}
            />
          </Row>
          <Row id="thumbnails" label={t.t('images.thumbnails')} description={t.t('images.thumbnails.desc')}>
            <Switch
              checked={media.thumbnails}
              label={t.t('images.thumbnails')}
              onChange={(thumbnails) => void update({ media: { thumbnails } })}
            />
          </Row>
          <div class="row row--stack" id="minsize">
            <div class="row__inline">
              <div class="row__text">
                <div class="row__label">{t.t('images.minSize')}</div>
                <div class="row__desc">{t.t('images.minSize.desc')}</div>
              </div>
              <span class="pill num">{t.t('common.px', { value: minSize })}</span>
            </div>
            <Slider
              min={16}
              max={200}
              step={4}
              value={minSize}
              label={t.t('images.minSize')}
              valueText={t.t('common.px', { value: minSize })}
              onChange={setMinSize}
              onCommit={async (value) => {
                if (!(await update({ media: { minSize: value } }))) setMinSize(settings.media.minSize);
              }}
            />
          </div>
          <Row id="ads" label={t.t('images.ads')} description={t.t('images.ads.desc')}>
            <Switch
              checked={media.stricterAds}
              label={t.t('images.ads')}
              onChange={(stricterAds) => void update({ media: { stricterAds } })}
            />
          </Row>
        </div>
      </Card>

      <Card title={t.t('images.style')}>
        <p class="card__intro muted small">{t.t('images.style.desc')}</p>
        <div class="card__body" id="style">
          <div class="styles" role="radiogroup" aria-label={t.t('images.style')}>
            {PROTECTION_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={settings.appearance.style === style}
                class="style-option"
                onClick={() => void update({ appearance: { style } })}
              >
                <StylePreview style={style} />
                <span class="style-option__label">{t.t(`style.${style}`)}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div class="list">
          <Row id="chip" label={t.t('images.chip')} description={t.t('images.chip.desc')}>
            <Switch
              checked={settings.appearance.showChip}
              label={t.t('images.chip')}
              onChange={(showChip) => void update({ appearance: { showChip } })}
            />
          </Row>
        </div>
      </Card>
    </div>
  );
}
