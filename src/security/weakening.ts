/**
 * Decides whether a settings change *weakens* protection, and which lock
 * scope it falls under. Strengthening changes never require the passcode —
 * the lock must not get in the way of being more careful.
 */
import { LEVEL_RANK } from '../policy/presets';
import type { RevealMode } from '../policy/types';
import type { Settings } from '../storage/schema';
import type { LockRecord } from './lock';

export type LockScope = keyof LockRecord['scope'];

const REVEAL_STRENGTH: Record<RevealMode, number> = { hover: 0, click: 1, hold: 2, disabled: 3 };

export function weakenedScopes(current: Settings, next: Settings, now = Date.now()): Set<LockScope> {
  const scopes = new Set<LockScope>();

  // Turning off / pausing
  if (current.enabled && !next.enabled) scopes.add('disable');
  const pausedNow = (s: Settings) => s.pausedUntil !== null && s.pausedUntil > now;
  if (pausedNow(next) && (!pausedNow(current) || (next.pausedUntil ?? 0) > (current.pausedUntil ?? 0))) scopes.add('disable');
  if (current.strictBrowsing.enabled && !next.strictBrowsing.enabled) scopes.add('disable');

  // Site rules: any change that is not purely additive of stricter rules.
  if (JSON.stringify(current.sites) !== JSON.stringify(next.sites)) {
    const before = new Map(current.sites.map((r) => [r.pattern, r]));
    const onlyStricter = next.sites.every((rule) => {
      const prior = before.get(rule.pattern);
      if (prior && JSON.stringify(prior) === JSON.stringify(rule)) return true;
      if (rule.mode === 'off') return false;
      return !prior || rule.mode === 'block';
    });
    const removedAny = current.sites.some((r) => !next.sites.some((n) => n.pattern === r.pattern && n.mode === r.mode));
    if (!onlyStricter || removedAny) scopes.add('sites');
  }

  // Protection strength
  const weaker =
    LEVEL_RANK[next.strictness] < LEVEL_RANK[current.strictness] ||
    (['explicit', 'illustrated', 'suggestive', 'faces', 'people'] as const).some((id) => {
      const a = current.categories[id];
      const b = next.categories[id];
      return (a.enabled && !b.enabled) || (b.enabled && b.threshold > a.threshold + 1e-9);
    }) ||
    REVEAL_STRENGTH[next.reveal.mode] < REVEAL_STRENGTH[current.reveal.mode] ||
    (current.reveal.confirm && !next.reveal.confirm) ||
    (current.fallback === 'protect' && next.fallback === 'reveal') ||
    (['images', 'videos', 'backgrounds', 'thumbnails', 'stricterAds'] as const).some((k) => current.media[k] && !next.media[k]) ||
    next.media.minSize > current.media.minSize ||
    (current.strictBrowsing.safeSearch && !next.strictBrowsing.safeSearch) ||
    (current.strictBrowsing.youtubeRestricted && !next.strictBrowsing.youtubeRestricted) ||
    (current.strictBrowsing.ignoreSiteExceptions && !next.strictBrowsing.ignoreSiteExceptions) ||
    (current.appearance.style !== 'hide' && next.appearance.style === 'blur-soft' && current.appearance.style !== 'blur-soft') ||
    (current.video.regionsProtectWhole && !next.video.regionsProtectWhole) ||
    (!current.video.autoRestore && next.video.autoRestore);
  if (weaker) scopes.add('settings');
  return scopes;
}

export function requiresUnlock(lock: LockRecord | null, current: Settings, next: Settings, now = Date.now()): boolean {
  if (!lock) return false;
  for (const scope of weakenedScopes(current, next, now)) if (lock.scope[scope]) return true;
  return false;
}
