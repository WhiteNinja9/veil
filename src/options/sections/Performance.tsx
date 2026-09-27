import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { HostStatus } from '../../ml/host/inference-host';
import type { BenchmarkResult } from '../../ml/worker/protocol';
import type { BackendPreference } from '../../storage/schema';
import { useApp, sendToBackground } from '../../ui/app-context';
import { Button, Select } from '../../ui/components/controls';
import { Card, Row } from '../../ui/components/layout';

type Status = HostStatus & { cacheEntries?: number };

const MODEL_NAMES: Record<string, string> = {
  'nsfw-mobilenet-v2-mid': 'MobileNetV2 · content',
  'face-blazeface-back': 'BlazeFace · faces',
  'person-ssdlite-mobilenet-v2': 'SSDLite · people',
  'test-classifier': 'Test classifier',
  'test-faces': 'Test faces',
  'test-people': 'Test people',
};

export const BACKEND_NAMES: Record<string, string> = {
  webgpu: 'WebGPU',
  webgl: 'WebGL',
  wasm: 'WebAssembly',
  cpu: 'CPU',
};

export function PerformanceSection(): JSX.Element {
  const { settings, t, update } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  const [bench, setBench] = useState<{ results: BenchmarkResult[]; best: string | null } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const next = await sendToBackground<Status>({ type: 'engine/status' });
      if (alive) setStatus(next);
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const run = async () => {
    setRunning(true);
    setBench(await sendToBackground({ type: 'engine/benchmark' }));
    setRunning(false);
  };

  const ms = (value: number | undefined) =>
    value === undefined ? '—' : t.t('common.ms', { value: t.number(value, { maximumFractionDigits: 1 }) });
  const state = status?.state ?? 'idle';
  const stateTone =
    state === 'ready' ? 'positive' : state === 'error' ? 'critical' : state === 'loading' ? 'accent' : '';

  return (
    <div class="stack">
      <Card
        title={t.t('perf.engine')}
        actions={
          <span class={`pill${stateTone ? ` pill--${stateTone}` : ''}`}>
            <span class={`dot${state === 'ready' ? ' dot--positive' : ''}`} aria-hidden="true" />
            {t.t(`perf.state.${state}`)}
          </span>
        }
      >
        <div class="card__body">
          <dl class="metrics">
            <div>
              <dt>{t.t('perf.backend')}</dt>
              <dd>
                {status?.backend ? (BACKEND_NAMES[status.backend] ?? status.backend) : '—'}
                {status?.detail && <span class="subtle small metrics__detail">{status.detail}</span>}
              </dd>
            </div>
            <div>
              <dt>{t.t('perf.latency')}</dt>
              <dd class="num">{status?.processed ? ms(status.avgMs) : '—'}</dd>
            </div>
            <div>
              <dt>{t.t('perf.p95')}</dt>
              <dd class="num">{status?.processed ? ms(status.p95Ms) : '—'}</dd>
            </div>
            <div>
              <dt>{t.t('perf.processed')}</dt>
              <dd class="num">{t.number(status?.processed ?? 0)}</dd>
            </div>
            <div>
              <dt>{t.t('perf.cache')}</dt>
              <dd class="num">{t.percent(status?.cacheHitRate ?? 0)}</dd>
            </div>
            <div>
              <dt>{t.t('perf.models')}</dt>
              <dd>
                {status?.models.length
                  ? status.models.map((m) => (
                      <span key={m.id} class="model-line">
                        {MODEL_NAMES[m.id] ?? m.id}
                        {m.loadMs ? <span class="subtle small"> · {ms(m.loadMs)}</span> : null}
                      </span>
                    ))
                  : t.t('perf.none')}
              </dd>
            </div>
          </dl>
          <p class="subtle small">{t.t('perf.note')}</p>
        </div>
      </Card>

      <Card>
        <div class="list">
          <Row id="backend" label={t.t('perf.backendPref')} description={t.t('perf.backendPref.desc')}>
            <Select<BackendPreference>
              inline
              label={t.t('perf.backendPref')}
              value={settings.performance.backend}
              options={(['auto', 'webgpu', 'webgl', 'wasm', 'cpu'] as const).map((b) => ({
                value: b,
                label: t.t(`perf.backend.${b}`),
              }))}
              onChange={(backend) => void update({ performance: { backend } })}
            />
          </Row>
          <Row id="unload" label={t.t('perf.unload')} description={t.t('perf.unload.desc')}>
            <Select<number>
              inline
              label={t.t('perf.unload')}
              value={settings.performance.unloadAfterMin}
              options={[5, 10, 30, 60].map((m) => ({ value: m, label: t.t('common.minutes', { count: m }) }))}
              onChange={(unloadAfterMin) => void update({ performance: { unloadAfterMin } })}
            />
          </Row>
        </div>
      </Card>

      <Card title={t.t('perf.benchmark')}>
        <div class="card__body" id="benchmark">
          <p class="muted small">{t.t('perf.benchmark.desc')}</p>
          <div>
            <Button variant="soft" icon="gauge" busy={running} onClick={() => void run()}>
              {running ? t.t('perf.benchmark.running') : t.t('perf.benchmark.run')}
            </Button>
          </div>
          {bench && (
            <>
              {bench.best && (
                <p class="bench-best">
                  {t.t('perf.benchmark.best', { backend: BACKEND_NAMES[bench.best] ?? bench.best })}
                </p>
              )}
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('perf.backend')}</th>
                    <th scope="col">{t.t('perf.benchmark.first')}</th>
                    <th scope="col">{t.t('perf.benchmark.typical')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bench.results.map((r) => (
                    <tr key={r.backend} class={r.backend === bench.best ? 'is-best' : ''}>
                      <th scope="row">{BACKEND_NAMES[r.backend] ?? r.backend}</th>
                      <td class="num">{r.ok ? ms(r.firstMs) : t.t('perf.unavailable')}</td>
                      <td class="num">{r.ok ? ms(r.medianMs) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
