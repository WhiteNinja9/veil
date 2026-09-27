/** Strings shown inside web pages (reveal chip, announcements). Keep this catalog small: it ships in every page. */
export const pageEn = {
  'chip.protected': 'Protected',
  'chip.reason.explicit': 'Explicit content',
  'chip.reason.illustrated': 'Explicit illustration',
  'chip.reason.suggestive': 'Suggestive content',
  'chip.reason.faces': 'Faces hidden',
  'chip.reason.people': 'People hidden',
  'chip.reason.unverified': 'Couldn’t be verified',
  'chip.reason.manual': 'Hidden by you',
  'chip.show': 'Show',
  'chip.hold': 'Hold to show',
  'chip.confirm': 'Show this content?',
  'chip.cancel': 'Cancel',
  'chip.hide': 'Hide again',
  'chip.disabled': 'Revealing is turned off',
  'chip.label': 'Veil: protected media',
  'announce.image': 'Protected image. Press {shortcut} to show it.',
  'announce.video': 'Protected video. Press {shortcut} to show it.',
  'announce.disabled': 'Protected media. Revealing is turned off in Veil settings.',
  'announce.revealed': 'Shown.',
  'announce.hidden': 'Hidden again.',
  'menu.hide': 'Hide with Veil',
  'menu.show': 'Show (Veil)',
} as const;

export type PageKey = keyof typeof pageEn;
