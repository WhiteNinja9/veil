/**
 * Page context heuristics. Cheap, read-only DOM inspection used to adjust
 * policy (e.g. stricter thresholds for advertisements). Heuristics are
 * deliberately conservative: a false "ad" only makes filtering a little
 * stricter; it never hides safe content on its own.
 */
import { hostnameOf } from '../shared/url';

const AD_TOKEN = /(?:^|[\s_-])(ad|ads|adv|advert|advertisement|advertising|sponsor|sponsored|promo|promoted|dfp|gpt-ad|adslot|ad-slot|adunit|ad-unit|banner-ad|taboola|outbrain)(?:$|[\s_\d-])/i;

const AD_FRAME_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'amazon-adsystem.com',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'yieldmo.com',
  'moatads.com',
];

let frameIsAd: boolean | null = null;

/** True when this whole frame is an ad slot (ad iframes are their own frames). */
export function isAdFrame(): boolean {
  if (frameIsAd === null) {
    const host = location.hostname;
    frameIsAd = window !== window.top && AD_FRAME_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  }
  return frameIsAd;
}

export function looksLikeAd(el: Element): boolean {
  if (isAdFrame()) return true;
  let node: Element | null = el;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    if (node.hasAttribute('data-ad') || node.hasAttribute('data-ad-slot') || node.hasAttribute('data-google-query-id')) return true;
    if (node.tagName === 'INS' && node.classList.contains('adsbygoogle')) return true;
    const id = node.id;
    if (id && AD_TOKEN.test(id)) return true;
    const cls = typeof node.className === 'string' ? node.className : '';
    if (cls && cls.length < 300 && AD_TOKEN.test(cls)) return true;
    const label = node.getAttribute('aria-label');
    if (label && /^(advertisement|sponsored|ad)$/i.test(label.trim())) return true;
  }
  return false;
}

/**
 * Hostname that site rules apply to: the tab's top-level site, so that
 * "pause on example.com" also covers example.com's embedded frames.
 */
export function topLevelHostSync(): string | null {
  if (window === window.top) return location.hostname;
  const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length) return hostnameOf(ancestors[ancestors.length - 1]!);
  try {
    return window.top!.location.hostname; // same-origin frames only
  } catch {
    return null;
  }
}
