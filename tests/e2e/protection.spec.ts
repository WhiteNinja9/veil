import { expect, test, veilStateOf, waitForVeil } from './fixtures';

test.describe('images', () => {
  test('protects unsafe fixtures and leaves safe media alone (balanced)', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    for (const id of ['explicit', 'explicit-xo', 'suggestive', 'illustrated', 'slow']) await waitForVeil(page, `#${id}`, 'x');
    for (const id of ['neutral', 'borderline', 'face']) await waitForVeil(page, `#${id}`, 'ok');
    // Below-threshold sizes are never analysed.
    await waitForVeil(page, '#tiny', 'ok');
    await waitForVeil(page, '#icon', 'ok');
    // Protected media keeps its box: no layout shift.
    const box = await page.locator('#explicit').boundingBox();
    const neutral = await page.locator('#neutral').boundingBox();
    expect(box?.height).toBeCloseTo(neutral?.height ?? 0, 0);
    expect(await page.locator('#explicit').evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
  });

  test('handles lazy-loaded images (native and JavaScript loaders)', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/lazy.html`);
    await page.mouse.wheel(0, 3000);
    await waitForVeil(page, '#native-lazy', 'x');
    await waitForVeil(page, '#js-lazy', 'x');
    await waitForVeil(page, '#js-lazy-neutral', 'ok');
  });

  test('handles srcset, <picture> and swapped sources', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/srcset.html`);
    await waitForVeil(page, '#srcset', 'x');
    await waitForVeil(page, '#picture-img', 'x');
    // The neutral image is replaced by an explicit one after 1.5 s.
    await waitForVeil(page, '#swap', 'x');
  });

  test('protects inline background images without hiding their content', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/backgrounds.html`);
    await waitForVeil(page, '#bg-explicit', 'x');
    await waitForVeil(page, '#bg-neutral', 'ok');
    expect(await veilStateOf(page, '#bg-gradient')).toBeNull();
    await expect(page.locator('#bg-explicit span')).toBeVisible();
  });

  test('protects data: URI thumbnails on search result pages', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/search.html`);
    await page.waitForSelector('body[data-ready="1"]');
    for (let i = 0; i < 6; i++) {
      const marker = await page.getAttribute(`#result-${i}`, 'data-marker');
      await waitForVeil(page, `#result-${i}`, marker === 'neutral' ? 'ok' : 'x');
    }
  });

  test('applies stricter thresholds inside ad slots', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/ads.html`);
    await waitForVeil(page, '#content-borderline', 'ok');
    await waitForVeil(page, '#ad-borderline', 'x');
  });
});

test.describe('dynamic pages', () => {
  test('protects every unsafe card in an infinite feed', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/feed.html`);
    // Simulate a user scrolling a feed: new cards are inserted in batches while scrolling.
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => (window as unknown as { labAddCards(n: number): void }).labAddCards(10));
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(200);
    }
    await page.waitForFunction(() => document.querySelectorAll('#feed .card').length >= 60);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLElement>('#feed .card')].every((card) => {
          const media = card.querySelector('img, .bg');
          const state = media?.getAttribute('data-veil');
          return card.dataset.marker === 'explicit' ? state === 'x' : state === 'ok';
        }),
      undefined,
      { timeout: 30_000 },
    );
  });

  test('re-verifies recycled nodes in a virtualised SPA list', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/spa.html`);
    const expectPage = async () =>
      page.waitForFunction(() =>
        [...document.querySelectorAll<HTMLImageElement>('#pool img')].every((img) => img.getAttribute('data-veil') === (img.dataset.marker === 'explicit' ? 'x' : 'ok')),
      );
    await expectPage();
    for (let i = 0; i < 3; i++) {
      await page.click('#next');
      await expectPage();
    }
  });

  test('protects media inside open, closed and late shadow roots', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/shadow.html`);
    await page.waitForFunction(() => {
      const state = (root: ShadowRoot | null | undefined) => root?.querySelector('img')?.getAttribute('data-veil');
      const w = window as unknown as { closedRoot?: ShadowRoot };
      return (
        state(document.querySelector('#open')?.shadowRoot) === 'x' &&
        state(w.closedRoot) === 'x' &&
        state(document.querySelector('#late')?.shadowRoot) === 'x'
      );
    }, undefined, { timeout: 15_000 });
  });

  test('protects media inside cross-origin iframes', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/iframe.html`);
    await expect.poll(() => page.frames().some((f) => f.url().startsWith(lab.originB))).toBe(true);
    const frame = page.frames().find((f) => f.url().startsWith(lab.originB))!;
    await frame.waitForLoadState();
    await waitForVeil(frame, '#explicit', 'x');
    await waitForVeil(frame, '#neutral', 'ok');
  });

  test('prioritises visible media on a page with 600 thumbnails', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/stress.html`);
    const started = Date.now();
    await page.waitForFunction(() => {
      const visible = [...document.querySelectorAll('#grid img')].filter((img) => img.getBoundingClientRect().top < innerHeight);
      return visible.length > 0 && visible.every((img) => ['ok', 'x'].includes(img.getAttribute('data-veil') ?? ''));
    }, undefined, { timeout: 30_000 });
    const visibleMs = Date.now() - started;
    test.info().annotations.push({ type: 'visible-resolved-ms', description: String(visibleMs) });
    // Every explicit fixture that is visible is protected.
    const leaks = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('#grid img')].filter((img) => img.src.includes('/explicit/') && img.getAttribute('data-veil') === 'ok').length,
    );
    expect(leaks).toBe(0);
  });
});
