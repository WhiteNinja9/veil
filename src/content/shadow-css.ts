/**
 * Stylesheet injected into shadow roots. Document-level stylesheets do not
 * cross shadow boundaries, so each discovered root receives this compact
 * equivalent of protection.css, regenerated whenever the page's protection
 * flags change (it has no `html[data-veil-on]` gate to rely on).
 */
import type { RootFlags } from './dom';

const BLUR: Record<string, string> = {
  'blur-soft': 'blur(10px) saturate(0.9)',
  'blur-strong': 'blur(26px) saturate(0.7) brightness(0.92)',
  pixelate: "url('#veil-pixelate-m') blur(2px)",
};

export function shadowCss(flags: RootFlags | null): string {
  if (!flags) return '';
  const rules: string[] = [];
  if (flags.images) rules.push(`img:not([data-veil]):not([src$='.svg' i]), img[data-veil='p'] { opacity: 0 !important; }`);
  if (flags.videos) rules.push(`video:not([data-veil]), video[data-veil='p'] { opacity: 0 !important; }`);
  if (flags.backgrounds) {
    rules.push(`:not(img, video, svg, svg *)[style*='url(' i]:not([data-veil]), [data-veil='p']:not(img, video) { background-image: none !important; }`);
  }
  rules.push(`[data-veil='x'] { clip-path: inset(0 round var(--veil-radius, 0px)) !important; }`);
  const filter = BLUR[flags.style];
  if (filter) rules.push(`[data-veil='x'] { filter: ${filter} !important; }`);
  else if (flags.style === 'hide') rules.push(`[data-veil='x'] { visibility: hidden !important; }`);
  else {
    rules.push(`img[data-veil='x'] { object-position: -100000px 0 !important; background: #cfd1d6 !important; }`);
    rules.push(`video[data-veil='x'] { filter: contrast(0) brightness(1.55) !important; }`);
    rules.push(`[data-veil='x']:not(img, video) { background-image: none !important; background-color: #cfd1d6 !important; }`);
  }
  rules.push(
    `img[data-veil='rg'] { object-position: -100000px 0 !important; background-image: var(--veil-render) !important; background-size: var(--veil-fit, cover) !important; background-position: var(--veil-pos, 50% 50%) !important; background-repeat: no-repeat !important; }`,
  );
  return rules.join('\n');
}
