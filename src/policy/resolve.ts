import type { Settings } from '../storage/schema';
import { findRule, type SiteRule } from '../sites/rules';
import { categoriesForLevel, PRESETS, stricterOf } from './presets';
import type { EffectivePolicy, RevealMode, StrictnessLevel } from './types';

export interface ResolvedSite {
  policy: EffectivePolicy;
  rule: SiteRule | null;
}

const REVEAL_STRENGTH: Record<RevealMode, number> = { hover: 0, click: 1, hold: 2, disabled: 3 };

/**
 * Computes the policy for a host. Precedence (documented in docs/ARCHITECTURE.md):
 *
 *  1. Global off / paused              → inactive
 *  2. Site rule "off"                  → inactive (unless Strict Browsing ignores exceptions)
 *  3. Level = site level ?? global level, floored at "strict" by Strict Browsing
 *  4. Content thresholds: the user's own values when the level is their global
 *     level, otherwise the preset for that level
 *  5. Faces / people choices are always the user's (they are preferences, not strictness)
 */
export function resolvePolicy(settings: Settings, hostname: string, now: number = Date.now()): ResolvedSite {
  const rule = hostname ? findRule(settings.sites, hostname, now) : null;
  const strict = settings.strictBrowsing.enabled;

  let level: StrictnessLevel = settings.strictness;
  let source: EffectivePolicy['source'] = 'global';
  if (rule && rule.mode !== 'off' && rule.mode !== 'warn' && rule.mode !== 'block') {
    level = rule.mode;
    source = 'site';
  }
  if (strict && stricterOf(level, 'strict') !== level) {
    level = 'strict';
    source = 'strict-browsing';
  }

  const usesUserValues = level === settings.strictness;
  const preset = PRESETS[level];
  const categories = usesUserValues
    ? structuredCloneSafe(settings.categories)
    : categoriesForLevel(level, { faces: settings.categories.faces, people: settings.categories.people });

  let revealMode: RevealMode = usesUserValues ? settings.reveal.mode : preset.reveal.mode;
  let confirm = usesUserValues ? settings.reveal.confirm : preset.reveal.confirm;
  if (strict) {
    // Strict Browsing: press-and-hold at minimum, always with confirmation.
    if (REVEAL_STRENGTH[revealMode] < REVEAL_STRENGTH.hold) revealMode = 'hold';
    confirm = true;
  }

  const policy: EffectivePolicy = {
    active: true,
    level,
    source,
    categories,
    style: settings.appearance.style,
    reveal: { mode: revealMode, confirm, reprotectAfterSec: settings.reveal.reprotectAfterSec },
    fallback: strict ? 'protect' : usesUserValues ? settings.fallback : preset.fallback,
    media: { ...settings.media },
    video: {
      baseIntervalMs: usesUserValues ? settings.video.baseIntervalMs : preset.videoIntervalMs,
      autoRestore: settings.video.autoRestore && !strict,
      peopleInVideos: settings.video.peopleInVideos,
    },
    contextAware: settings.contextAware,
    peopleFilter: { ...settings.peopleFilter },
  };

  if (!settings.enabled) return { policy: { ...policy, active: false, inactiveReason: 'disabled' }, rule };
  if (settings.pausedUntil !== null && settings.pausedUntil > now && !strict) {
    return { policy: { ...policy, active: false, inactiveReason: 'paused' }, rule };
  }
  if (rule?.mode === 'off' && !(strict && settings.strictBrowsing.ignoreSiteExceptions)) {
    return { policy: { ...policy, active: false, inactiveReason: 'site-off' }, rule };
  }
  return { policy, rule };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
