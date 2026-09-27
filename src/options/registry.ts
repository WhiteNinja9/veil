/**
 * Section and setting registry for the settings app: drives navigation,
 * deep links (#section or #section/setting) and search. Search matches the
 * translated label and description plus English keywords, so it works in
 * every language and for synonyms ("nsfw", "blur", "password").
 */
import type { AppKey } from '../i18n/app';
import type { IconName } from '../ui/icons';

export type SectionId =
  | 'general'
  | 'protection'
  | 'images'
  | 'videos'
  | 'sites'
  | 'search'
  | 'privacy'
  | 'performance'
  | 'accessibility'
  | 'advanced'
  | 'about';

export interface SectionDef {
  id: SectionId;
  icon: IconName;
  label: AppKey;
  description: AppKey;
}

export const SECTIONS: SectionDef[] = [
  { id: 'general', icon: 'shield', label: 'nav.general', description: 'section.general.desc' },
  { id: 'protection', icon: 'eyeOff', label: 'nav.protection', description: 'section.protection.desc' },
  { id: 'images', icon: 'image', label: 'nav.images', description: 'section.images.desc' },
  { id: 'videos', icon: 'video', label: 'nav.videos', description: 'section.videos.desc' },
  { id: 'sites', icon: 'globe', label: 'nav.sites', description: 'section.sites.desc' },
  { id: 'search', icon: 'search', label: 'nav.search', description: 'section.search.desc' },
  { id: 'privacy', icon: 'lock', label: 'nav.privacy', description: 'section.privacy.desc' },
  { id: 'performance', icon: 'gauge', label: 'nav.performance', description: 'section.performance.desc' },
  {
    id: 'accessibility',
    icon: 'access',
    label: 'nav.accessibility',
    description: 'section.accessibility.desc',
  },
  { id: 'advanced', icon: 'sliders', label: 'nav.advanced', description: 'section.advanced.desc' },
  { id: 'about', icon: 'info', label: 'nav.about', description: 'section.about.desc' },
];

export interface SettingEntry {
  id: string;
  section: SectionId;
  label: AppKey;
  description?: AppKey;
  keywords?: string;
}

export const SETTINGS_INDEX: SettingEntry[] = [
  {
    id: 'enabled',
    section: 'general',
    label: 'general.protection',
    description: 'general.protection.desc',
    keywords: 'on off enable disable turn',
  },
  {
    id: 'pause',
    section: 'general',
    label: 'general.pause',
    description: 'general.pause.desc',
    keywords: 'pause break snooze temporarily',
  },
  {
    id: 'level',
    section: 'general',
    label: 'general.level',
    description: 'general.level.desc',
    keywords: 'strictness minimal balanced strict maximum preset',
  },
  {
    id: 'language',
    section: 'general',
    label: 'general.language',
    keywords: 'language arabic french english locale',
  },
  { id: 'theme', section: 'general', label: 'general.theme', keywords: 'theme dark light appearance' },
  {
    id: 'cat-explicit',
    section: 'protection',
    label: 'category.explicit',
    description: 'category.explicit.desc',
    keywords: 'nsfw nudity porn sexual explicit',
  },
  {
    id: 'cat-illustrated',
    section: 'protection',
    label: 'category.illustrated',
    description: 'category.illustrated.desc',
    keywords: 'hentai anime drawing cartoon',
  },
  {
    id: 'cat-suggestive',
    section: 'protection',
    label: 'category.suggestive',
    description: 'category.suggestive.desc',
    keywords: 'bikini lingerie swimwear revealing modesty',
  },
  {
    id: 'cat-faces',
    section: 'protection',
    label: 'category.faces',
    description: 'category.faces.desc',
    keywords: 'face blur modesty',
  },
  {
    id: 'cat-people',
    section: 'protection',
    label: 'category.people',
    description: 'category.people.desc',
    keywords: 'people person body modesty',
  },
  {
    id: 'people-who',
    section: 'protection',
    label: 'people.who',
    description: 'people.who.desc',
    keywords: 'women woman female men man male gender modesty lower gaze',
  },
  {
    id: 'people-unsure',
    section: 'protection',
    label: 'people.unsure',
    description: 'people.unsure.desc',
    keywords: 'gender uncertain unsure women men',
  },
  {
    id: 'people-videos',
    section: 'protection',
    label: 'people.videos',
    description: 'people.videos.desc',
    keywords: 'video women men people faces gender',
  },
  {
    id: 'context',
    section: 'protection',
    label: 'protection.contextAware',
    description: 'protection.contextAware.desc',
    keywords: 'false positive accuracy',
  },
  {
    id: 'fallback',
    section: 'protection',
    label: 'protection.fallback',
    description: 'protection.fallback.desc',
    keywords: 'error unverified unknown',
  },
  {
    id: 'reveal',
    section: 'protection',
    label: 'protection.reveal.mode',
    keywords: 'reveal show unblur click hover hold',
  },
  {
    id: 'confirm',
    section: 'protection',
    label: 'protection.reveal.confirm',
    description: 'protection.reveal.confirm.desc',
    keywords: 'confirm',
  },
  {
    id: 'reprotect',
    section: 'protection',
    label: 'protection.reveal.reprotect',
    description: 'protection.reveal.reprotect.desc',
    keywords: 'timer again',
  },
  {
    id: 'shortcut',
    section: 'protection',
    label: 'protection.shortcut',
    description: 'protection.shortcut.desc',
    keywords: 'keyboard hotkey',
  },
  { id: 'images', section: 'images', label: 'images.images', keywords: 'pictures photos' },
  {
    id: 'backgrounds',
    section: 'images',
    label: 'images.backgrounds',
    description: 'images.backgrounds.desc',
    keywords: 'css background',
  },
  {
    id: 'thumbnails',
    section: 'images',
    label: 'images.thumbnails',
    description: 'images.thumbnails.desc',
    keywords: 'avatar small preview',
  },
  {
    id: 'minsize',
    section: 'images',
    label: 'images.minSize',
    description: 'images.minSize.desc',
    keywords: 'size icon pixels',
  },
  {
    id: 'ads',
    section: 'images',
    label: 'images.ads',
    description: 'images.ads.desc',
    keywords: 'advertisement sponsored',
  },
  {
    id: 'style',
    section: 'images',
    label: 'images.style',
    description: 'images.style.desc',
    keywords: 'blur pixelate look appearance',
  },
  {
    id: 'chip',
    section: 'images',
    label: 'images.chip',
    description: 'images.chip.desc',
    keywords: 'label overlay badge',
  },
  {
    id: 'videos',
    section: 'videos',
    label: 'videos.videos',
    description: 'videos.videos.desc',
    keywords: 'video movie clip',
  },
  {
    id: 'sampling',
    section: 'videos',
    label: 'videos.sampling',
    description: 'videos.sampling.desc',
    keywords: 'frequency frames fps',
  },
  {
    id: 'autorestore',
    section: 'videos',
    label: 'videos.autoRestore',
    description: 'videos.autoRestore.desc',
  },
  {
    id: 'regionswhole',
    section: 'videos',
    label: 'videos.regions',
    description: 'videos.regions.desc',
  },
  {
    id: 'sites',
    section: 'sites',
    label: 'sites.add',
    keywords: 'domain website block allow whitelist blacklist exception warn',
  },
  {
    id: 'strict',
    section: 'search',
    label: 'strict.title',
    description: 'strict.desc',
    keywords: 'strict family parental children kids',
  },
  {
    id: 'safesearch',
    section: 'search',
    label: 'strict.safeSearch',
    description: 'strict.safeSearch.desc',
    keywords: 'google bing search safe',
  },
  {
    id: 'youtube',
    section: 'search',
    label: 'strict.youtube',
    description: 'strict.youtube.desc',
    keywords: 'youtube restricted',
  },
  {
    id: 'privacy',
    section: 'privacy',
    label: 'privacy.title',
    description: 'privacy.lede',
    keywords: 'data telemetry tracking cloud',
  },
  {
    id: 'stats',
    section: 'privacy',
    label: 'privacy.stats',
    description: 'privacy.stats.desc',
    keywords: 'statistics count',
  },
  {
    id: 'badge',
    section: 'privacy',
    label: 'privacy.badge',
    description: 'privacy.badge.desc',
    keywords: 'icon number',
  },
  {
    id: 'permissions',
    section: 'privacy',
    label: 'privacy.permissions.title',
    keywords: 'permissions access',
  },
  {
    id: 'backend',
    section: 'performance',
    label: 'perf.backendPref',
    description: 'perf.backendPref.desc',
    keywords: 'gpu webgpu webgl wasm cpu speed',
  },
  {
    id: 'unload',
    section: 'performance',
    label: 'perf.unload',
    description: 'perf.unload.desc',
    keywords: 'memory ram',
  },
  {
    id: 'benchmark',
    section: 'performance',
    label: 'perf.benchmark',
    description: 'perf.benchmark.desc',
    keywords: 'speed test measure',
  },
  {
    id: 'motion',
    section: 'accessibility',
    label: 'a11y.motion',
    description: 'a11y.motion.desc',
    keywords: 'animation reduce',
  },
  { id: 'shortcuts', section: 'accessibility', label: 'a11y.shortcuts', keywords: 'keyboard hotkey' },
  {
    id: 'lock',
    section: 'advanced',
    label: 'lock.title',
    description: 'lock.desc',
    keywords: 'password passcode pin parental',
  },
  {
    id: 'export',
    section: 'advanced',
    label: 'data.export',
    description: 'data.export.desc',
    keywords: 'backup save',
  },
  {
    id: 'import',
    section: 'advanced',
    label: 'data.import',
    description: 'data.import.desc',
    keywords: 'restore load',
  },
  {
    id: 'reset',
    section: 'advanced',
    label: 'data.reset',
    description: 'data.reset.desc',
    keywords: 'defaults factory',
  },
  {
    id: 'managed',
    section: 'advanced',
    label: 'managed.title',
    description: 'managed.desc',
    keywords: 'enterprise policy admin',
  },
  { id: 'limits', section: 'about', label: 'about.limits.title', keywords: 'accuracy limitations false' },
];

const normalize = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٟ]/g, '');

export function searchSettings(query: string, translate: (key: AppKey) => string): SettingEntry[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return SETTINGS_INDEX.filter((entry) => {
    const haystack = normalize(
      [
        translate(entry.label),
        entry.description ? translate(entry.description) : '',
        entry.keywords ?? '',
      ].join(' '),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

export function parseHash(hash: string): { section: SectionId; setting?: string } {
  const [section, setting] = hash.replace(/^#/, '').split('/');
  const known = SECTIONS.find((s) => s.id === section);
  return { section: known?.id ?? 'general', ...(setting ? { setting } : {}) };
}
