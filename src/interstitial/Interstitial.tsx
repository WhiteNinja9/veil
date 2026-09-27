import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ext } from '../browser/api';
import { displayHost, hostnameOf, isHttpUrl } from '../shared/url';
import { sendToBackground, useApp } from '../ui/app-context';
import { Button } from '../ui/components/controls';
import { Icon, Mark } from '../ui/icons';

/**
 * Parses `#<mode>|<url>` written by the DNR redirect. This page is
 * web-accessible, so the fragment is untrusted: only http(s) targets are
 * accepted, and "continue" is re-authorised by the background.
 */
export function parseTarget(hash: string): { mode: 'block' | 'warn'; url: string | null } {
  const raw = hash.replace(/^#/, '');
  const separator = raw.indexOf('|');
  const mode = raw.slice(0, separator) === 'warn' ? 'warn' : 'block';
  const url = separator >= 0 ? raw.slice(separator + 1) : '';
  return { mode, url: isHttpUrl(url) ? url : null };
}

export function Interstitial(): JSX.Element {
  const { t } = useApp();
  const [{ mode, url }] = useState(() => parseTarget(location.hash));
  const [busy, setBusy] = useState(false);
  const host = url ? displayHost(hostnameOf(url)) : '';

  const back = () => {
    if (history.length > 1) history.back();
    else window.close();
  };

  const proceed = async (minutes: number) => {
    if (!url) return;
    setBusy(true);
    const reply = await sendToBackground<{ ok: boolean }>({ type: 'site/proceed', url, minutes });
    if (reply?.ok) location.replace(url);
    else setBusy(false);
  };

  const manage = () => {
    location.href = ext().runtime.getURL('options.html#sites');
  };

  return (
    <main class="gate">
      <div class="gate__card">
        <span class={`gate__icon gate__icon--${mode}`} aria-hidden="true">
          <Icon name={mode === 'block' ? 'ban' : 'pause'} />
        </span>
        <h1 class="gate__title">{mode === 'block' ? t.t('block.title') : t.t('warn.title')}</h1>
        <p class="gate__body">
          {mode === 'block'
            ? t.t('block.body', { host: '⁨' + host + '⁩' })
            : t.t('warn.body', { host: '⁨' + host + '⁩' })}
        </p>
        <div class="gate__actions">
          <Button variant="primary" size="lg" icon="arrowLeft" onClick={back}>
            {t.t('block.back')}
          </Button>
          {mode === 'warn' && url ? (
            <div class="gate__continue">
              <Button variant="ghost" busy={busy} onClick={() => void proceed(15)}>
                {t.t('warn.continue', { duration: t.t('warn.15') })}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void proceed(60)}>
                {t.t('warn.continue', { duration: t.t('warn.60') })}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" icon="settings" onClick={manage}>
              {t.t('block.manage')}
            </Button>
          )}
        </div>
      </div>
      <footer class="gate__footer subtle">
        <Mark size={16} />
        <span>{t.t('interstitial.footer')}</span>
      </footer>
    </main>
  );
}
