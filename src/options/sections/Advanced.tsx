import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  createLockRecord,
  type LockRecord,
  markUnlocked,
  validatePasscode,
  writeLock,
} from '../../security/lock';
import { downloadBlob, exportSettings, importSettings, resetSettings } from '../../ui/actions';
import { sendToBackground, useApp } from '../../ui/app-context';
import { Button, Switch } from '../../ui/components/controls';
import { Banner, Card, Dialog, Row } from '../../ui/components/layout';
import { Icon } from '../../ui/icons';

type Scope = LockRecord['scope'];
const DEFAULT_SCOPE: Scope = { settings: true, disable: true, sites: true };

function PasscodeForm({ onSave, busy }: { onSave: (code: string) => void; busy: boolean }): JSX.Element {
  const { t } = useApp();
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: Event) => {
    event.preventDefault();
    const problem = validatePasscode(code);
    if (problem === 'too-short') return setError(t.t('lock.tooShort'));
    if (code !== confirm) return setError(t.t('lock.mismatch'));
    setError(null);
    onSave(code);
  };
  return (
    <form class="passcode-form" onSubmit={submit}>
      <div class="field">
        <label class="field__label" for="new-code">
          {t.t('lock.new')}
        </label>
        <input
          id="new-code"
          class="input"
          type="password"
          autocomplete="new-password"
          value={code}
          onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="field">
        <label class="field__label" for="confirm-code">
          {t.t('lock.confirmField')}
        </label>
        <input
          id="confirm-code"
          class="input"
          type="password"
          autocomplete="new-password"
          value={confirm}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'code-error' : undefined}
          onInput={(e) => setConfirm((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="passcode-form__actions">
        <Button type="submit" variant="primary" busy={busy} disabled={!code || !confirm}>
          {busy ? t.t('lock.working') : t.t('common.save')}
        </Button>
      </div>
      {error && (
        <div id="code-error" class="field__error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

function LockCard(): JSX.Element {
  const { t, lock, unlocked, refreshLock, requestUnlock, lockNow } = useApp();
  const [mode, setMode] = useState<'idle' | 'set' | 'change'>('idle');
  const [busy, setBusy] = useState(false);

  const ensureUnlocked = async () => unlocked || (await requestUnlock());

  const save = async (code: string) => {
    if (lock && !(await ensureUnlocked())) return;
    setBusy(true);
    // PBKDF2 with 600k iterations takes a moment by design.
    await writeLock(await createLockRecord(code, lock?.scope ?? DEFAULT_SCOPE));
    // Whoever just set the passcode knows it: start with the normal unlock window.
    await markUnlocked();
    setBusy(false);
    setMode('idle');
    await refreshLock();
  };

  const remove = async () => {
    if (!(await ensureUnlocked())) return;
    await writeLock(null);
    await refreshLock();
  };

  const setScope = async (key: keyof Scope, value: boolean) => {
    if (!lock) return;
    if (!value && !(await ensureUnlocked())) return;
    await writeLock({ ...lock, scope: { ...lock.scope, [key]: value } });
    await refreshLock();
  };

  return (
    <Card
      title={t.t('lock.title')}
      actions={
        lock ? (
          <span class="pill pill--positive">
            <Icon name="lock" />
            {t.t('lock.on')}
          </span>
        ) : undefined
      }
    >
      <div class="card__body" id="lock">
        <p class="muted small">{t.t('lock.desc')}</p>
        {lock && (
          <div class="lock-status">
            <span class="subtle small">{unlocked ? t.t('lock.unlocked') : t.t('lock.on')}</span>
            <div class="button-group">
              {unlocked && (
                <Button size="sm" icon="lock" onClick={() => void lockNow()}>
                  {t.t('lock.relock')}
                </Button>
              )}
              <Button size="sm" onClick={() => setMode(mode === 'change' ? 'idle' : 'change')}>
                {t.t('lock.change')}
              </Button>
              <Button size="sm" variant="danger" onClick={() => void remove()}>
                {t.t('lock.remove')}
              </Button>
            </div>
          </div>
        )}
        {!lock && mode === 'idle' && (
          <div>
            <Button variant="soft" icon="lock" onClick={() => setMode('set')}>
              {t.t('lock.set')}
            </Button>
          </div>
        )}
        {mode !== 'idle' && <PasscodeForm busy={busy} onSave={(code) => void save(code)} />}
      </div>
      {lock && (
        <div class="list">
          <div class="row row--sub-header">
            <span class="field__label">{t.t('lock.protects')}</span>
          </div>
          {(['settings', 'disable', 'sites'] as const).map((key) => (
            <Row key={key} label={t.t(`lock.scope.${key}`)}>
              <Switch
                checked={lock.scope[key]}
                label={t.t(`lock.scope.${key}`)}
                onChange={(v) => void setScope(key, v)}
              />
            </Row>
          ))}
        </div>
      )}
      <div class="card__body card__body--tight">
        <Banner icon="info">{t.t('lock.honest')}</Banner>
      </div>
    </Card>
  );
}

export function AdvancedSection(): JSX.Element {
  const { settings, t, requestUnlock, managed } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: 'positive' | 'caution'; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState(false);

  const onImport = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen || chosen.size > 5 * 1024 * 1024) return;
    const outcome = await importSettings(await chosen.text(), requestUnlock);
    if (outcome === 'ok') setMessage({ tone: 'positive', text: t.t('data.import.ok') });
    else if (outcome === 'invalid') setMessage({ tone: 'caution', text: t.t('data.import.error') });
  };

  const onReset = async () => {
    setConfirmReset(false);
    if ((await resetSettings(requestUnlock)) === 'ok')
      setMessage({ tone: 'positive', text: t.t('data.reset.done') });
  };

  const copyDiagnostics = async () => {
    const status = await sendToBackground<Record<string, unknown>>({ type: 'engine/status' });
    const summary = {
      version: __VERSION__,
      browser: __BROWSER__,
      userAgent: navigator.userAgent,
      engine: status && {
        state: status.state,
        backend: status.backend,
        detail: status.detail,
        avgMs: status.avgMs,
        p95Ms: status.p95Ms,
        processed: status.processed,
      },
      level: settings.strictness,
      strictBrowsing: settings.strictBrowsing.enabled,
      siteRules: settings.sites.length,
    };
    await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="stack">
      <LockCard />

      <Card title={t.t('data.title')}>
        <div class="list">
          <Row id="export" label={t.t('data.export')} description={t.t('data.export.desc')}>
            <Button
              size="sm"
              icon="download"
              onClick={() =>
                downloadBlob(
                  exportSettings(settings),
                  `veil-settings-${new Date().toISOString().slice(0, 10)}.json`,
                )
              }
            >
              {t.t('data.export')}
            </Button>
          </Row>
          <Row id="import" label={t.t('data.import')} description={t.t('data.import.desc')}>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              class="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void onImport(e)}
            />
            <Button size="sm" icon="upload" onClick={() => file.current?.click()}>
              {t.t('data.import')}
            </Button>
          </Row>
          <Row id="reset" label={t.t('data.reset')} description={t.t('data.reset.desc')}>
            <Button size="sm" variant="danger" icon="refresh" onClick={() => setConfirmReset(true)}>
              {t.t('common.reset')}
            </Button>
          </Row>
        </div>
        {message && (
          <div class="card__body card__body--tight">
            <Banner tone={message.tone} icon={message.tone === 'positive' ? 'check' : 'alert'} role="status">
              {message.text}
            </Banner>
          </div>
        )}
      </Card>

      <Card title={t.t('managed.title')}>
        <div class="card__body" id="managed">
          <p class="muted small">{t.t('managed.desc')}</p>
          <Banner tone={managed ? 'accent' : 'neutral'} icon={managed ? 'lock' : 'info'}>
            {managed ? t.t('managed.active') : t.t('managed.none')}
          </Banner>
        </div>
      </Card>

      <Card title={t.t('diag.title')}>
        <div class="list">
          <Row id="diagnostics" label={t.t('diag.copy')} description={t.t('diag.copy.desc')}>
            <Button size="sm" icon={copied ? 'check' : 'copy'} onClick={() => void copyDiagnostics()}>
              {copied ? t.t('common.copied') : t.t('diag.copy')}
            </Button>
          </Row>
        </div>
      </Card>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t.t('data.reset')}
        description={t.t('data.reset.confirm')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              {t.t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void onReset()}>
              {t.t('common.reset')}
            </Button>
          </>
        }
      />
    </div>
  );
}
