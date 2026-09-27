/**
 * DOM state helpers. All page mutations Veil performs go through this module
 * so they are few, predictable and easy to audit:
 *   - attributes on <html>:   data-veil-on, data-veil-style, data-veil-img,
 *                             data-veil-video, data-veil-bg
 *   - attributes on media:    data-veil, data-veil-sz
 *   - custom properties:      --veil-radius, --veil-render, --veil-fit, --veil-pos
 *   - one <svg> with filter definitions and one overlay host, both children of <html>
 */
import type { ProtectionStyle } from '../policy/types';

export const ATTR = 'data-veil';
export const ATTR_SIZE = 'data-veil-sz';
export const ROOT_ON = 'data-veil-on';

export type ElementState = 'p' | 'ok' | 'x' | 'rg' | 'r';

export function setState(el: Element, state: ElementState): void {
  if (el.getAttribute(ATTR) !== state) el.setAttribute(ATTR, state);
}

export function getState(el: Element): ElementState | null {
  return el.getAttribute(ATTR) as ElementState | null;
}

export function sizeBucket(size: number): 's' | 'm' | 'l' {
  if (size < 140) return 's';
  if (size < 420) return 'm';
  return 'l';
}

export function setSizeBucket(el: Element, size: number): void {
  const bucket = sizeBucket(size);
  if (el.getAttribute(ATTR_SIZE) !== bucket) el.setAttribute(ATTR_SIZE, bucket);
}

export function setVar(el: Element, name: string, value: string | null): void {
  const style = (el as HTMLElement).style;
  if (!style) return;
  if (value === null) style.removeProperty(name);
  else if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
}

export function clearVeil(el: Element): void {
  el.removeAttribute(ATTR);
  el.removeAttribute(ATTR_SIZE);
  for (const name of ['--veil-radius', '--veil-render', '--veil-fit', '--veil-pos']) setVar(el, name, null);
}

// ── Root ─────────────────────────────────────────────────────────────────

export interface RootFlags {
  style: ProtectionStyle;
  images: boolean;
  videos: boolean;
  backgrounds: boolean;
}

export function root(): HTMLElement | null {
  return document.documentElement;
}

/** Synchronous, first thing at document_start: hide media until settings are known. */
export function engageRoot(generation: string): void {
  const html = root();
  if (!html) return;
  html.setAttribute(ROOT_ON, generation);
  html.setAttribute('data-veil-img', '');
  html.setAttribute('data-veil-video', '');
  html.setAttribute('data-veil-bg', '');
}

export function applyRootFlags(flags: RootFlags): void {
  const html = root();
  if (!html) return;
  html.setAttribute('data-veil-style', flags.style);
  toggleAttr(html, 'data-veil-img', flags.images);
  toggleAttr(html, 'data-veil-video', flags.videos);
  toggleAttr(html, 'data-veil-bg', flags.backgrounds);
}

/** Removes Veil's gate: every Veil rule stops applying at once. */
export function releaseRoot(generation?: string): void {
  const html = root();
  if (!html) return;
  if (generation && html.getAttribute(ROOT_ON) !== generation) return; // a newer instance owns the page
  for (const name of [ROOT_ON, 'data-veil-style', 'data-veil-img', 'data-veil-video', 'data-veil-bg'])
    html.removeAttribute(name);
}

export function rootGeneration(): string | null {
  return root()?.getAttribute(ROOT_ON) ?? null;
}

function toggleAttr(el: Element, name: string, on: boolean): void {
  if (on) {
    if (!el.hasAttribute(name)) el.setAttribute(name, '');
  } else el.removeAttribute(name);
}

// ── Filters (pixelation) ──────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Mosaic filter: sample one pixel per tile, then dilate it over the tile.
 * Three sizes, selected by the element's size bucket.
 */
export function ensurePixelateFilters(): void {
  const html = root();
  if (!html || document.getElementById('veil-filters')) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.id = 'veil-filters';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
  const defs = document.createElementNS(SVG_NS, 'defs');
  for (const [suffix, tile] of [
    ['s', 6],
    ['m', 12],
    ['l', 22],
  ] as const) {
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = `veil-pixelate-${suffix}`;
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '1');
    filter.setAttribute('height', '1');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const half = Math.floor(tile / 2);
    const flood = document.createElementNS(SVG_NS, 'feFlood');
    flood.setAttribute('x', String(half));
    flood.setAttribute('y', String(half));
    flood.setAttribute('width', '1');
    flood.setAttribute('height', '1');
    const composite = document.createElementNS(SVG_NS, 'feComposite');
    composite.setAttribute('width', String(tile));
    composite.setAttribute('height', String(tile));
    const tileEl = document.createElementNS(SVG_NS, 'feTile');
    tileEl.setAttribute('result', 'grid');
    const sample = document.createElementNS(SVG_NS, 'feComposite');
    sample.setAttribute('in', 'SourceGraphic');
    sample.setAttribute('in2', 'grid');
    sample.setAttribute('operator', 'in');
    const dilate = document.createElementNS(SVG_NS, 'feMorphology');
    dilate.setAttribute('operator', 'dilate');
    dilate.setAttribute('radius', String(half));
    filter.append(flood, composite, tileEl, sample, dilate);
    defs.append(filter);
  }
  svg.append(defs);
  html.append(svg);
}

/** Radius of an element's rounded corners, so protection clips to the same shape. */
export function cornerRadius(el: Element): string | null {
  const radius = getComputedStyle(el).borderTopLeftRadius;
  return radius && radius !== '0px' ? radius : null;
}
