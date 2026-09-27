// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MediaScanner } from '../../src/content/scan/scanner';
import { backgroundUrl, imageAttributeSignature, isVectorSource } from '../../src/content/media/sources';
import { installChromeMock } from '../helpers/chrome-mock';

const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(watchStyles = true) {
  const seen = { images: [] as string[], videos: 0, backgrounds: [] as string[], changes: [] as string[], shadows: 0 };
  const scanner = new MediaScanner(
    {
      image: (img) => seen.images.push(img.id),
      video: () => seen.videos++,
      background: (el) => seen.backgrounds.push(el.id),
      sourceChanged: (el, attr) => seen.changes.push(`${el.id}:${attr}`),
      shadowRoot: () => seen.shadows++,
      removed: () => undefined,
    },
    watchStyles,
  );
  return { scanner, seen };
}

describe('MediaScanner', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = '';
  });

  it('discovers existing and dynamically inserted media', async () => {
    document.body.innerHTML = '<img id="a"><div><video></video><div id="bg" style="background-image:url(x.png)"></div></div>';
    const { scanner, seen } = harness();
    scanner.start();
    expect(seen.images).toEqual(['a']);
    expect(seen.videos).toBe(1);
    expect(seen.backgrounds).toEqual(['bg']);
    const card = document.createElement('div');
    card.innerHTML = '<p>text</p><img id="late">';
    document.body.append(card);
    await tick();
    expect(seen.images).toEqual(['a', 'late']);
    scanner.stop();
  });

  it('reports source changes on recycled nodes, including <picture> sources', async () => {
    document.body.innerHTML = '<img id="slot" src="a.png"><picture id="pic"><source id="s" srcset="b.png"><img id="inner"></picture>';
    const { scanner, seen } = harness();
    scanner.start();
    document.getElementById('slot')!.setAttribute('src', 'c.png');
    document.getElementById('s')!.setAttribute('srcset', 'd.png');
    await tick();
    expect(seen.changes).toContain('slot:src');
    expect(seen.changes).toContain('inner:srcset');
  });

  it('picks up inline background changes only when watching styles', async () => {
    document.body.innerHTML = '<div id="card"></div>';
    const watching = harness(true);
    watching.scanner.start();
    document.getElementById('card')!.setAttribute('style', 'background-image:url(z.png)');
    await tick();
    expect(watching.seen.backgrounds).toEqual(['card']);
    watching.scanner.stop();

    document.body.innerHTML = '<div id="card2"></div>';
    const ignoring = harness(false);
    ignoring.scanner.start();
    document.getElementById('card2')!.setAttribute('style', 'background-image:url(z.png)');
    await tick();
    expect(ignoring.seen.backgrounds).toEqual([]);
  });

  it('descends into open shadow roots and observes them', async () => {
    const host = document.createElement('x-card');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<img id="shadowed">';
    document.body.append(host);
    const { scanner, seen } = harness();
    scanner.start();
    expect(seen.shadows).toBe(1);
    expect(seen.images).toContain('shadowed');
    const added = document.createElement('img');
    added.id = 'added-in-shadow';
    root.append(added);
    await tick();
    expect(seen.images).toContain('added-in-shadow');
  });
});

describe('source helpers', () => {
  it('extracts background URLs and attribute signatures', () => {
    const div = document.createElement('div');
    div.style.backgroundImage = 'linear-gradient(red, blue), url("https://cdn.test/a.jpg")';
    expect(backgroundUrl(div)).toBe('https://cdn.test/a.jpg');
    div.style.backgroundImage = 'linear-gradient(red, blue)';
    expect(backgroundUrl(div)).toBeNull();
    const img = document.createElement('img');
    img.setAttribute('src', 'a.png');
    img.setAttribute('srcset', 'a2.png 2x');
    expect(imageAttributeSignature(img)).toBe('a.png|a2.png 2x');
    expect(isVectorSource('https://a.com/logo.svg')).toBe(true);
    expect(isVectorSource('data:image/svg+xml,<svg/>')).toBe(true);
    expect(isVectorSource('https://a.com/photo.jpg')).toBe(false);
  });
});
