/**
 * Popup view-model: everything the popup shows, derived from settings, the
 * active tab and the background. Pure functions + one loader; no UI.
 */
import { ext } from '../browser/api';
import type { HostStatus } from '../ml/host/inference-host';
import { resolvePolicy } from '../policy/resolve';
import type { EffectivePolicy } from '../policy/types';
import { createRuleId, type SiteRule } from '../sites/rules';
import type { Settings } from '../storage/schema';
import { hostnameOf, displayHost } from '../shared/url';
import type { TabStats } from '../background/tab-stats';

export type PopupStatus = 'active' | 'paused-site' | 'paused-all' | 'off' | 'unsupported';

export interface TabContext {
  tabId: number | null;
  url: string;
  host: string;
  supported: boolean;
  /** Content script is running in this tab (false for tabs opened before install). */
  connected: boolean;
}

export interface PopupModel {
  status: PopupStatus;
  policy: EffectivePolicy | null;
  rule: SiteRule | null;
  displayHost: string;
  resumesAt: number | null;
}

async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  // Development/test builds can point the popup at a specific tab (popup.html?tabId=N)
  // so it can be exercised and screenshotted outside the toolbar.
  if (__DEV__) {
    const requested = Number(new URLSearchParams(location.search).get('tabId'));
    if (requested) return ext().tabs.get(requested);
  }
  const [tab] = await ext().tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function loadTabContext(): Promise<TabContext> {
  const tab = await targetTab();
  const url = tab?.url ?? '';
  const host = hostnameOf(url);
  const supported = Boolean(host) && !/^(chrome|edge|about|moz-extension|chrome-extension)/.test(url);
  let connected = false;
  if (supported && tab?.id !== undefined) {
    try {
      const reply = (await ext().tabs.sendMessage(tab.id, { type: 'ping' }, { frameId: 0 })) as { ok?: boolean } | undefined;
      connected = Boolean(reply?.ok);
    } catch {
      connected = false;
    }
  }
  return { tabId: tab?.id ?? null, url, host, supported, connected };
}

export function derive(settings: Settings, tab: TabContext, now = Date.now()): PopupModel {
  if (!tab.supported) return { status: 'unsupported', policy: null, rule: null, displayHost: '', resumesAt: null };
  const { policy, rule } = resolvePolicy(settings, tab.host, now);
  let status: PopupStatus = 'active';
  let resumesAt: number | null = null;
  if (!policy.active) {
    if (policy.inactiveReason === 'disabled') status = 'off';
    else if (policy.inactiveReason === 'paused') {
      status = 'paused-all';
      resumesAt = settings.pausedUntil;
    } else {
      status = 'paused-site';
      resumesAt = rule?.expiresAt ?? null;
    }
  }
  return { status, policy, rule, displayHost: displayHost(tab.host), resumesAt };
}

export type PauseDuration = 'hour' | 'session' | 'always';

/** Site rules after pausing `host` for a duration (replaces any rule for the exact host). */
export function pauseSiteRules(sites: SiteRule[], host: string, duration: PauseDuration, now = Date.now()): SiteRule[] {
  const pattern = host.replace(/^www\./, '');
  const rest = sites.filter((r) => r.pattern !== pattern);
  return [
    ...rest,
    {
      id: createRuleId(),
      pattern,
      mode: 'off',
      createdAt: now,
      expiresAt: duration === 'hour' ? now + 60 * 60 * 1000 : null,
      ...(duration === 'session' ? { sessionOnly: true } : {}),
    },
  ];
}

/** Site rules after resuming protection on `host` (removes the pausing rule that matched it). */
export function resumeSiteRules(sites: SiteRule[], rule: SiteRule | null): SiteRule[] {
  return rule ? sites.filter((r) => r.id !== rule.id) : sites;
}

export async function loadTabStats(tabId: number | null): Promise<TabStats | null> {
  if (tabId === null) return null;
  try {
    const reply = (await ext().runtime.sendMessage({ type: 'tab/state', tabId })) as { stats?: TabStats } | undefined;
    return reply?.stats ?? null;
  } catch {
    return null;
  }
}

export async function loadEngineStatus(): Promise<HostStatus | null> {
  try {
    return ((await ext().runtime.sendMessage({ type: 'engine/status' })) as HostStatus | undefined) ?? null;
  } catch {
    return null;
  }
}

export const BACKEND_LABEL: Record<string, string> = {
  webgpu: 'WebGPU',
  webgl: 'WebGL',
  wasm: 'WebAssembly',
  cpu: 'CPU',
};
