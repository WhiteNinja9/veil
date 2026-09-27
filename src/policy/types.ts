import type { Region } from '../ml/types';

export type StrictnessLevel = 'minimal' | 'balanced' | 'strict' | 'maximum';
export const STRICTNESS_LEVELS: readonly StrictnessLevel[] = ['minimal', 'balanced', 'strict', 'maximum'];

/**
 * Content categories. The first three are scored by the content classifier;
 * `faces` and `people` come from dedicated detectors and protect regions.
 *
 * Mapping to model outputs (documented in docs/ML.md):
 *   explicit    ← porn            nudity and sexual content
 *   illustrated ← hentai          explicit drawings / animation
 *   suggestive  ← sexy + porn     revealing clothing, lingerie, suggestive poses
 *                                 ("at least suggestive", so explicit content also counts)
 */
export type CategoryId = 'explicit' | 'illustrated' | 'suggestive' | 'faces' | 'people';
export const CONTENT_CATEGORIES = ['explicit', 'illustrated', 'suggestive'] as const;
export const REGION_CATEGORIES = ['faces', 'people'] as const;
export const CATEGORY_IDS: readonly CategoryId[] = [...CONTENT_CATEGORIES, ...REGION_CATEGORIES];

export interface CategorySetting {
  enabled: boolean;
  /** Minimum score in [0, 1] at which the category triggers. */
  threshold: number;
}

export interface RegionCategorySetting extends CategorySetting {
  /** Blur only the detected regions, or protect the whole image when present. */
  scope: 'regions' | 'whole';
}

export interface CategorySettings {
  explicit: CategorySetting;
  illustrated: CategorySetting;
  suggestive: CategorySetting;
  faces: RegionCategorySetting;
  people: RegionCategorySetting;
}

export type ProtectionStyle = 'blur-soft' | 'blur-strong' | 'pixelate' | 'solid' | 'placeholder' | 'hide';
export const PROTECTION_STYLES: readonly ProtectionStyle[] = [
  'blur-soft',
  'blur-strong',
  'pixelate',
  'solid',
  'placeholder',
  'hide',
];

export type RevealMode = 'click' | 'hover' | 'hold' | 'disabled';
export const REVEAL_MODES: readonly RevealMode[] = ['click', 'hold', 'hover', 'disabled'];

/** What to do when media cannot be verified (decode/fetch failure, cross-origin video, timeout). */
export type FallbackAction = 'reveal' | 'protect';

export type MediaKind = 'image' | 'background' | 'video';

export interface PolicyContext {
  kind: MediaKind;
  /** Rendered size in CSS pixels (largest of width/height). */
  renderedSize: number;
  isAd: boolean;
}

export interface EffectivePolicy {
  active: boolean;
  /** Why protection is inactive, for UI. */
  inactiveReason?: 'disabled' | 'paused' | 'site-off';
  level: StrictnessLevel;
  source: 'global' | 'site' | 'strict-browsing';
  categories: CategorySettings;
  style: ProtectionStyle;
  reveal: { mode: RevealMode; confirm: boolean; reprotectAfterSec: number };
  fallback: FallbackAction;
  media: {
    images: boolean;
    videos: boolean;
    backgrounds: boolean;
    thumbnails: boolean;
    minSize: number;
    stricterAds: boolean;
  };
  video: { baseIntervalMs: number; autoRestore: boolean; regionsProtectWhole: boolean };
  /** Context-aware score adjustments (see engine.ts). */
  contextAware: boolean;
}

export type DecisionAction = 'allow' | 'protect' | 'regions';

export interface Reason {
  category: CategoryId | 'unverified' | 'manual';
  score: number;
  threshold: number;
}

export interface Decision {
  action: DecisionAction;
  regions?: Region[];
  reasons: Reason[];
  /**
   * Distance from the decision boundary in [0, 1]: 1 means far from any
   * threshold. Used for diagnostics and the video sampler.
   */
  confidence: number;
  /** Highest score relative to its threshold (score / threshold), for adaptive sampling. */
  pressure: number;
}
