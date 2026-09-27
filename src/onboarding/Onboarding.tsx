import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ext } from '../browser/api';
import type { BenchmarkResult } from '../ml/worker/protocol';
import { STRICTNESS_LEVELS } from '../policy/types';
import { levelPatch, readShortcuts } from '../ui/actions';
import { sendToBackground, useApp } from '../ui/app-context';
import { Button } from '../ui/components/controls';
import { Choice } from '../ui/components/layout';
import { Icon, Mark } from '../ui/icons';
import { LevelMeter } from '../options/sections/General';
import { BACKEND_NAMES } from '../options/sections/Performance';

const STEPS = ['welcome', 'local', 'permissions', 'level', 'tune', 'done'] as const;
type Step = (typeof STEPS)[number];

async function hasHostAccess(): Promise<boolean> {
  try {
    return await ext().permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    return true;
  }
}

function ProductVisual(): JSX.Element {
  return (
    <div class="visual" aria-hidden="true">
      <div class="visual__card visual__card--back">
        <span class="visual__img visual__img--soft" />
        <span class="visual__line" />
        <span class="visual__line visual__line--short" />
      </div>
      <div class="visual__card">
        <span class="visual__img visual__img--veiled">
          <span class="visual__chip">
            <Icon name="eyeOff" />
            <span />
          </span>
        </span>
        <span class="visual__line" />
        <span class="visual__line visual__line--short" />
      </div>
    </div>
  );
}

function LocalDiagram(): JSX.Element {
  const { t } = useApp();
  return (
    <div class="diagram">
      <div class="diagram__node">
        <span class="diagram__icon">
          <Icon name="globe" />
        </span>
        <span>{t.t('onb.local.page')}</span>
      </div>
      <span class="diagram__arrow" aria-hidden="true" />
      <div class="diagram__node diagram__node--device">
        <span class="diagram__icon diagram__icon--accent">
          <Icon name="device" />
        </span>
        <span>{t.t('onb.local.device')}</span>
      </div>
      <span class="diagram__arrow" aria-hidden="true" />
      <div class="diagram__node">
        <span class="diagram__icon">
          <Icon name="eyeOff" />
        </span>
        <span>{t.t('onb.local.result')}</span>
      </div>
      <div class="diagram__cloud">
        <Icon name="cloudOff" />
        <span>{t.t('onb.local.cloud')}</span>
      </div>
    </div>
  );
}

export function Onboarding(): JSX.Element {
  const { settings, t, update } = useApp();
  const [step, setStep] = useState<Step>('welcome');
  const [access, setAccess] = useState<boolean | null>(null);
  const [bench, setBench] = useState<{ state: 'idle' | 'running' | 'done' | 'failed'; best?: BenchmarkResult }>({ state: 'idle' });
  const [shortcut, setShortcut] = useState('Alt+Shift+R');
  const index = STEPS.indexOf(step);

  useEffect(() => {
    void hasHostAccess().then(setAccess);
    void readShortcuts().then((s) => s['reveal-focused'] && setShortcut(s['reveal-focused']));
  }, []);

  useEffect(() => {
    document.querySelector<HTMLElement>('.onboarding__title')?.focus();
    if (step === 'tune' && bench.state === 'idle') {
      setBench({ state: 'running' });
      void sendToBackground<{ results: BenchmarkResult[]; best: string | null }>({ type: 'engine/benchmark' }).then((reply) => {
        const best = reply?.results.find((r) => r.backend === reply.best);
        setBench(best ? { state: 'done', best } : { state: 'failed' });
      });
    }
  }, [step]);

  const next = () => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)]!);
  const back = () => setStep(STEPS[Math.max(index - 1, 0)]!);

  const grant = async () => {
    try {
      setAccess(await ext().permissions.request({ origins: ['<all_urls>'] }));
    } catch {
      setAccess(false);
    }
  };

  const finish = async (openSettings: boolean) => {
    await update({ onboardingComplete: true });
    if (openSettings) location.href = ext().runtime.getURL('options.html');
    else window.close();
  };

  return (
    <div class="onboarding">
      <header class="onboarding__top">
        <div class="brand">
          <Mark size={24} />
          <span class="brand__name">{t.t('app.name')}</span>
        </div>
        <div class="progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1} aria-label={t.t('onb.step', { current: index + 1, total: STEPS.length })}>
          {STEPS.map((s, i) => (
            <span key={s} class={`progress__dot${i <= index ? ' is-done' : ''}${i === index ? ' is-current' : ''}`} />
          ))}
        </div>
      </header>

      <main class="onboarding__stage" key={step}>
        {step === 'welcome' && (
          <section class="panel panel--hero">
            <ProductVisual />
            <h1 class="onboarding__title display" tabIndex={-1}>
              {t.t('onb.welcome.title')}
            </h1>
            <p class="onboarding__body">{t.t('onb.welcome.body')}</p>
            <div class="onboarding__actions">
              <Button variant="primary" size="lg" onClick={next}>
                {t.t('onb.welcome.cta')}
              </Button>
            </div>
          </section>
        )}

        {step === 'local' && (
          <section class="panel">
            <h1 class="onboarding__title" tabIndex={-1}>
              {t.t('onb.local.title')}
            </h1>
            <p class="onboarding__body">{t.t('onb.local.body')}</p>
            <LocalDiagram />
          </section>
        )}

        {step === 'permissions' && (
          <section class="panel">
            <h1 class="onboarding__title" tabIndex={-1}>
              {t.t('onb.permissions.title')}
            </h1>
            <p class="onboarding__body">{t.t('onb.permissions.body')}</p>
            <div class="permission">
              <span class="permission__icon">
                <Icon name="globe" />
              </span>
              <div class="permission__text">
                <strong>{t.t('perm.hosts')}</strong>
                <span class="muted">{t.t('perm.hosts.desc')}</span>
              </div>
              {access ? (
                <span class="pill pill--positive">
                  <Icon name="check" />
                  {t.t('onb.permissions.granted')}
                </span>
              ) : (
                <Button variant="primary" onClick={() => void grant()}>
                  {t.t('onb.permissions.grant')}
                </Button>
              )}
            </div>
            {access === false && <p class="field__error">{t.t('onb.permissions.missing')}</p>}
          </section>
        )}

        {step === 'level' && (
          <section class="panel">
            <h1 class="onboarding__title" tabIndex={-1}>
              {t.t('onb.level.title')}
            </h1>
            <p class="onboarding__body">{t.t('onb.level.body')}</p>
            <div class="choices choices--2" role="radiogroup" aria-label={t.t('general.level')}>
              {STRICTNESS_LEVELS.map((level, i) => (
                <Choice
                  key={level}
                  checked={settings.strictness === level}
                  title={t.t(`level.${level}`)}
                  description={t.t(`level.${level}.desc`)}
                  meta={
                    <span class="choice__meta">
                      <LevelMeter level={i} />
                      {level === 'balanced' && <span class="pill pill--accent">{t.t('common.recommended')}</span>}
                    </span>
                  }
                  onSelect={() => void update(levelPatch(level, settings))}
                />
              ))}
            </div>
          </section>
        )}

        {step === 'tune' && (
          <section class="panel">
            <h1 class="onboarding__title" tabIndex={-1}>
              {t.t('onb.tune.title')}
            </h1>
            <p class="onboarding__body">{t.t('onb.tune.body')}</p>
            <div class={`tune tune--${bench.state}`} role="status" aria-live="polite">
              <span class="tune__icon" aria-hidden="true">
                {bench.state === 'running' ? <span class="spinner" /> : <Icon name={bench.state === 'done' ? 'check' : 'gauge'} />}
              </span>
              <span>
                {bench.state === 'done' && bench.best
                  ? t.t('onb.tune.done', {
                      ms: t.t('common.ms', { value: Math.round(bench.best.medianMs ?? 0) }),
                      backend: BACKEND_NAMES[bench.best.backend] ?? bench.best.backend,
                    })
                  : bench.state === 'failed'
                    ? t.t('onb.tune.failed')
                    : t.t('onb.tune.running')}
              </span>
            </div>
          </section>
        )}

        {step === 'done' && (
          <section class="panel">
            <span class="done-mark" aria-hidden="true">
              <Icon name="check" />
            </span>
            <h1 class="onboarding__title" tabIndex={-1}>
              {t.t('onb.done.title')}
            </h1>
            <p class="onboarding__body">{t.t('onb.done.body')}</p>
            <ul class="tips" role="list">
              <li>
                <Icon name="eye" />
                {t.t('onb.done.tip.hover')}
              </li>
              <li>
                <Icon name="keyboard" />
                <span>{t.t('onb.done.tip.shortcut', { shortcut })}</span>
              </li>
              <li>
                <Icon name="pause" />
                {t.t('onb.done.tip.popup')}
              </li>
            </ul>
            <p class="subtle small">{t.t('onb.done.limits')}</p>
            <div class="onboarding__actions">
              <Button onClick={() => void finish(true)}>{t.t('onb.done.customize')}</Button>
              <Button variant="primary" size="lg" onClick={() => void finish(false)}>
                {t.t('onb.done.cta')}
              </Button>
            </div>
          </section>
        )}
      </main>

      {step !== 'welcome' && step !== 'done' && (
        <footer class="onboarding__nav">
          <Button variant="ghost" icon="arrowLeft" onClick={back}>
            {t.t('common.back')}
          </Button>
          <span class="subtle small">{t.t('onb.step', { current: index + 1, total: STEPS.length })}</span>
          <div class="button-group">
            {step === 'tune' && bench.state === 'running' && (
              <Button variant="ghost" onClick={next}>
                {t.t('common.skip')}
              </Button>
            )}
            <Button variant="primary" onClick={next} disabled={step === 'permissions' && access === false}>
              {t.t('common.continue')}
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
