/**
 * AppProvider — shared state for every extension page.
 *
 * Owns: live settings (via SettingsStore), the translator, document theme /
 * direction / language, the settings lock, and the unlock dialog. UI
 * components call `update()`; weakening changes are routed through the
 * passcode prompt when a lock covers them. Business rules live in the
 * imported modules, not here.
 */
import type { ComponentChildren, JSX } from 'preact';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { appTranslator, type AppTranslator } from '../i18n/app';
import { attemptUnlock, isUnlocked, type LockRecord, readLock, relock } from '../security/lock';
import { requiresUnlock } from '../security/weakening';
import { type DeepPartial, mergeSettings, type Settings } from '../storage/schema';
import { type ManagedPolicy, settingsStore } from '../storage/settings-store';
import { Button } from './components/controls';
import { Dialog } from './components/layout';

export interface AppContextValue {
  settings: Settings;
  t: AppTranslator;
  /** Applies a patch; resolves false if the user cancelled a required unlock. */
  update: (patch: DeepPartial<Settings>) => Promise<boolean>;
  lock: LockRecord | null;
  unlocked: boolean;
  refreshLock: () => Promise<void>;
  requestUnlock: () => Promise<boolean>;
  lockNow: () => Promise<void>;
  managed: ManagedPolicy | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp outside AppProvider');
  return value;
}

function applyDocumentPreferences(settings: Settings, t: AppTranslator): void {
  const html = document.documentElement;
  html.lang = t.locale;
  html.dir = t.dir;
  if (settings.appearance.theme === 'system') delete html.dataset.theme;
  else html.dataset.theme = settings.appearance.theme;
  if (settings.appearance.motion === 'system') delete html.dataset.motion;
  else html.dataset.motion = settings.appearance.motion;
}

export function AppProvider({ children, fallback }: { children: ComponentChildren; fallback?: ComponentChildren }): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lock, setLock] = useState<LockRecord | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const unlockResolver = useRef<((ok: boolean) => void) | null>(null);

  const refreshLock = useCallback(async () => {
    const record = await readLock();
    setLock(record);
    setUnlocked(record ? await isUnlocked() : true);
  }, []);

  useEffect(() => {
    void settingsStore.get().then(setSettings);
    void refreshLock();
    return settingsStore.subscribe((next) => setSettings(next));
  }, [refreshLock]);

  const t = useMemo(() => appTranslator(settings?.language ?? 'auto'), [settings?.language]);

  useEffect(() => {
    if (settings) applyDocumentPreferences(settings, t);
  }, [settings, t]);

  const requestUnlock = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      unlockResolver.current = resolve;
      setUnlockOpen(true);
    });
  }, []);

  const update = useCallback(
    async (patch: DeepPartial<Settings>) => {
      const current = settingsStore.peek() ?? (await settingsStore.get());
      const next = mergeSettings(current, patch);
      const record = await readLock();
      if (record && requiresUnlock(record, current, next) && !(await isUnlocked())) {
        const ok = await requestUnlock();
        if (!ok) return false;
      }
      await settingsStore.update(patch);
      return true;
    },
    [requestUnlock],
  );

  const lockNow = useCallback(async () => {
    await relock();
    await refreshLock();
  }, [refreshLock]);

  if (!settings) return <>{fallback ?? null}</>;

  const value: AppContextValue = {
    settings,
    t,
    update,
    lock,
    unlocked,
    refreshLock,
    requestUnlock,
    lockNow,
    managed: settingsStore.managedPolicy(),
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <UnlockDialog
        open={unlockOpen}
        t={t}
        onDone={(ok) => {
          setUnlockOpen(false);
          unlockResolver.current?.(ok);
          unlockResolver.current = null;
          void refreshLock();
        }}
      />
    </AppContext.Provider>
  );
}

function UnlockDialog({ open, t, onDone }: { open: boolean; t: AppTranslator; onDone: (ok: boolean) => void }): JSX.Element {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!code) return;
    setBusy(true);
    const result = await attemptUnlock(code);
    setBusy(false);
    if (result.ok) {
      onDone(true);
      return;
    }
    setCode('');
    setError(
      result.reason === 'locked-out' && result.retryAt ? t.t('lock.lockedOut', { time: t.relativeTime(result.retryAt) }) : t.t('lock.wrong'),
    );
    input.current?.focus();
  };

  return (
    <Dialog open={open} onClose={() => onDone(false)} title={t.t('lock.unlockTitle')} description={t.t('lock.unlockDesc')}>
      <form onSubmit={submit} class="field">
        <label class="sr-only" for="unlock-code">
          {t.t('lock.current')}
        </label>
        <input
          ref={input}
          id="unlock-code"
          class="input"
          type="password"
          autocomplete="current-password"
          value={code}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'unlock-error' : undefined}
          onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
        />
        {error && (
          <div id="unlock-error" class="field__error" role="alert">
            {error}
          </div>
        )}
        <div class="dialog__actions" style={{ marginTop: '8px' }}>
          <Button variant="ghost" onClick={() => onDone(false)}>
            {t.t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" busy={busy} disabled={!code}>
            {t.t('common.unlock')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Thin wrapper for runtime messages to the background. */
export async function sendToBackground<T>(message: unknown): Promise<T | null> {
  try {
    const g = globalThis as unknown as { browser?: typeof chrome; chrome?: typeof chrome };
    return ((await (g.browser ?? g.chrome)!.runtime.sendMessage(message)) as T) ?? null;
  } catch {
    return null;
  }
}
