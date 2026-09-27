import type { Catalog } from '../core';
import type { PageKey } from './page.en';

export const pageFr: Catalog<PageKey> = {
  'chip.protected': 'Protégé',
  'chip.reason.explicit': 'Contenu explicite',
  'chip.reason.illustrated': 'Illustration explicite',
  'chip.reason.suggestive': 'Contenu suggestif',
  'chip.reason.faces': 'Visages masqués',
  'chip.reason.people': 'Personnes masquées',
  'chip.reason.unverified': 'Vérification impossible',
  'chip.reason.manual': 'Masqué par vous',
  'chip.show': 'Afficher',
  'chip.hold': 'Maintenir pour afficher',
  'chip.confirm': 'Afficher ce contenu ?',
  'chip.cancel': 'Annuler',
  'chip.hide': 'Masquer à nouveau',
  'chip.disabled': 'L’affichage est désactivé',
  'chip.label': 'Veil : média protégé',
  'announce.image': 'Image protégée. Appuyez sur {shortcut} pour l’afficher.',
  'announce.video': 'Vidéo protégée. Appuyez sur {shortcut} pour l’afficher.',
  'announce.disabled': 'Média protégé. L’affichage est désactivé dans les réglages de Veil.',
  'announce.revealed': 'Affiché.',
  'announce.hidden': 'Masqué à nouveau.',
  'menu.hide': 'Masquer avec Veil',
  'menu.show': 'Afficher (Veil)',
};
