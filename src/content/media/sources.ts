/** Source extraction for tracked elements. Pure DOM reads, no layout. */

export function imageSource(img: HTMLImageElement): string {
  return img.currentSrc || img.src || '';
}

/** Signature of the attributes that select an image's source (src, srcset, <picture> sources). */
export function imageAttributeSignature(img: HTMLImageElement): string {
  let signature = `${img.getAttribute('src') ?? ''}|${img.getAttribute('srcset') ?? ''}`;
  const picture = img.parentElement;
  if (picture?.localName === 'picture') {
    for (const source of picture.querySelectorAll('source')) signature += `|${source.getAttribute('srcset') ?? ''}`;
  }
  return signature;
}

const URL_IN_CSS = /url\(\s*(['"]?)(.*?)\1\s*\)/i;

/** First image URL in an element's inline background, resolved against the document. */
export function backgroundUrl(el: HTMLElement): string | null {
  const value = el.style.backgroundImage || el.style.background;
  if (!value || !/url\(/i.test(value)) return null;
  const match = URL_IN_CSS.exec(value);
  const raw = match?.[2];
  if (!raw) return null;
  try {
    return new URL(raw, document.baseURI).href;
  } catch {
    return null;
  }
}

export function isVectorSource(src: string): boolean {
  if (src.startsWith('data:image/svg')) return true;
  try {
    const { pathname } = new URL(src, document.baseURI);
    return /\.svgz?$/i.test(pathname);
  } catch {
    return false;
  }
}

export function isFetchableUrl(src: string): boolean {
  return src.startsWith('https:') || src.startsWith('http:');
}
