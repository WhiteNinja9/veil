/**
 * Declarative Net Request rules for site protection and Strict Browsing.
 *
 * DNR is used (rather than observing navigations) because it is enforced by
 * the browser itself, works while the service worker sleeps, and never
 * exposes browsing to extension code: Veil does not see which pages you
 * visit, the browser simply applies the rules.
 *
 * Rule ID ranges:
 *   1–99        Strict Browsing (SafeSearch, YouTube Restricted Mode)
 *   1000–8999   blocked / warned sites (dynamic rules, rebuilt from settings)
 *   10000+      temporary "continue anyway" allowances (session rules)
 */
import { ext, extensionUrl } from '../browser/api';
import { parsePattern, isRuleActive, type SiteRule } from '../sites/rules';
import type { Settings } from '../storage/schema';

type Rule = chrome.declarativeNetRequest.Rule;
type RuleAction = chrome.declarativeNetRequest.RuleAction;
type ResourceType = chrome.declarativeNetRequest.ResourceType;

const SITE_RULE_BASE = 1000;
const MAX_SITE_RULES = 7000;
export const ALLOWANCE_BASE = 10000;
const SEARCH_TYPES = ['main_frame', 'sub_frame', 'xmlhttprequest'] as ResourceType[];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/** RE2-compatible regex matching whole http(s) URLs whose host matches `pattern`. */
export function patternToUrlRegex(pattern: string): string | null {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) return null;
  const { kind, host } = parsed.value;
  const tail = '(?::\\d+)?(?:[/?#].*)?$';
  switch (kind) {
    case 'exact':
      return `^https?://${escapeRegex(host)}${tail}`;
    case 'domain':
      return `^https?://(?:[^/?#@]*\\.)?${escapeRegex(host)}${tail}`;
    case 'subdomains':
      return `^https?://[^/?#@]+\\.${escapeRegex(host)}${tail}`;
    case 'glob': {
      const labels = parsed.value.pattern.split('.').map((label) => (label === '*' ? '[^/?#@.]+(?:\\.[^/?#@.]+)*' : escapeRegex(label)));
      return `^https?://${labels.join('\\.')}${tail}`;
    }
  }
}

function interstitialRedirect(mode: 'block' | 'warn'): RuleAction {
  // `\0` is the full matched URL; the interstitial reads it from the fragment.
  return {
    type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
    redirect: { regexSubstitution: `${extensionUrl('interstitial.html')}#${mode}|\\0` },
  };
}

export function buildSiteRules(sites: readonly SiteRule[], now: number): Rule[] {
  const rules: Rule[] = [];
  for (const site of sites) {
    if (rules.length >= MAX_SITE_RULES) break;
    if ((site.mode !== 'block' && site.mode !== 'warn') || !isRuleActive(site, now)) continue;
    const regexFilter = patternToUrlRegex(site.pattern);
    if (!regexFilter) continue;
    rules.push({
      id: SITE_RULE_BASE + rules.length,
      priority: site.mode === 'block' ? 20 : 10,
      action: interstitialRedirect(site.mode),
      condition: { regexFilter, resourceTypes: ['main_frame' as ResourceType] },
    });
  }
  return rules;
}

function addParam(key: string, value: string): RuleAction {
  return {
    type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
    redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key, value }] } } },
  };
}

/**
 * SafeSearch enforcement via each engine's documented URL parameter, and
 * YouTube Restricted Mode via Google's documented `YouTube-Restrict` header.
 * These are the engines' own filters; Veil's visual protection still runs.
 */
export function buildStrictBrowsingRules(settings: Settings): Rule[] {
  const { enabled, safeSearch, youtubeRestricted } = settings.strictBrowsing;
  if (!enabled) return [];
  const rules: Rule[] = [];
  const search = (id: number, regexFilter: string, key: string, value: string) =>
    rules.push({ id, priority: 5, action: addParam(key, value), condition: { regexFilter, resourceTypes: SEARCH_TYPES } });
  if (safeSearch) {
    search(1, '^https?://(?:www\\.)?google\\.[a-z.]{2,12}/(?:search|images)(?:[?#].*)?$', 'safe', 'active');
    search(2, '^https?://(?:www\\.|cn\\.)?bing\\.com/(?:search|images|videos)(?:/[^?#]*)?(?:[?#].*)?$', 'adlt', 'strict');
    search(3, '^https?://(?:html\\.|lite\\.)?duckduckgo\\.com/(?:html/?|lite/?)?(?:[?#].*)?$', 'kp', '1');
    search(4, '^https?://(?:[a-z]+\\.)?search\\.yahoo\\.com/(?:search|images|video)?[^?#]*(?:[?#].*)?$', 'vm', 'r');
    search(5, '^https?://search\\.brave\\.com/(?:search|images|videos)(?:[?#].*)?$', 'safesearch', 'strict');
    search(6, '^https?://(?:www\\.)?yandex\\.[a-z.]{2,8}/(?:search|images)(?:/[^?#]*)?(?:[?#].*)?$', 'family', 'yes');
  }
  if (youtubeRestricted) {
    rules.push({
      id: 20,
      priority: 5,
      action: {
        type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        requestHeaders: [{ header: 'YouTube-Restrict', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: 'Strict' }],
      },
      condition: {
        requestDomains: ['youtube.com', 'm.youtube.com', 'youtubei.googleapis.com', 'youtube.googleapis.com', 'youtube-nocookie.com'],
        resourceTypes: SEARCH_TYPES,
      },
    });
  }
  return rules;
}

/** Replaces all dynamic rules with those derived from settings. */
export async function syncDynamicRules(settings: Settings, now = Date.now()): Promise<void> {
  const dnr = ext().declarativeNetRequest;
  if (!dnr?.updateDynamicRules) return;
  const next = [...buildStrictBrowsingRules(settings), ...(settings.enabled ? buildSiteRules(settings.sites, now) : [])];
  const existing = await dnr.getDynamicRules();
  await dnr.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: next });
}

// ── Temporary allowances ("Continue anyway" on warned sites) ─────────────

const ALLOWANCES_KEY = 'veil.allowances';

interface Allowance {
  id: number;
  host: string;
  expiresAt: number;
}

async function readAllowances(): Promise<Allowance[]> {
  const session = (ext().storage as Partial<typeof chrome.storage>).session;
  if (!session) return [];
  return ((await session.get(ALLOWANCES_KEY))[ALLOWANCES_KEY] as Allowance[] | undefined) ?? [];
}

async function writeAllowances(list: Allowance[]): Promise<void> {
  await (ext().storage as Partial<typeof chrome.storage>).session?.set({ [ALLOWANCES_KEY]: list });
}

export async function grantAllowance(host: string, minutes: number, now = Date.now()): Promise<void> {
  const dnr = ext().declarativeNetRequest;
  const list = (await readAllowances()).filter((a) => a.expiresAt > now && a.host !== host);
  const id = ALLOWANCE_BASE + ((Math.max(0, ...list.map((a) => a.id - ALLOWANCE_BASE)) + 1) % 5000);
  const allowance: Allowance = { id, host, expiresAt: now + minutes * 60_000 };
  await dnr.updateSessionRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: 100,
        action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
        condition: { requestDomains: [host], resourceTypes: ['main_frame' as ResourceType] },
      },
    ],
  });
  await writeAllowances([...list, allowance]);
  ext().alarms?.create(`veil-allowance-${id}`, { when: allowance.expiresAt });
}

/** Removes expired allowances (alarm handler, and on every start-up). */
export async function pruneAllowances(now = Date.now()): Promise<void> {
  const dnr = ext().declarativeNetRequest;
  if (!dnr?.getSessionRules) return;
  const list = await readAllowances();
  const valid = list.filter((a) => a.expiresAt > now);
  const validIds = new Set(valid.map((a) => a.id));
  const session = await dnr.getSessionRules();
  const stale = session.filter((r) => r.id >= ALLOWANCE_BASE && !validIds.has(r.id)).map((r) => r.id);
  if (stale.length) await dnr.updateSessionRules({ removeRuleIds: stale });
  if (valid.length !== list.length) await writeAllowances(valid);
}
