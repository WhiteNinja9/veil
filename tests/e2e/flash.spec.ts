import { expect, test, waitForVeil } from './fixtures';

/**
 * The core promise: unsafe media is never painted unprotected. A main-world
 * sampler checks every animation frame from the first one; any frame in
 * which a loaded unsafe fixture is visible and not protected is a violation.
 */
const SAMPLER = () => {
  const w = window as unknown as { __flash: { src: string; state: string | null; t: number }[] };
  w.__flash = [];
  const unsafe = (url: string) => /\/(explicit|suggestive|illustrated)\//.test(url);
  const sample = () => {
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src;
      if (!unsafe(src) || !img.complete || !img.naturalWidth) continue;
      const rect = img.getBoundingClientRect();
      if (Math.max(rect.width, rect.height) < 36) continue; // intentionally unanalysed icons
      const state = img.getAttribute('data-veil');
      if (state === 'x' || state === 'rg') continue;
      if (Number(getComputedStyle(img).opacity) > 0) w.__flash.push({ src, state, t: performance.now() });
    }
    for (const el of document.querySelectorAll<HTMLElement>('[style*="background-image"]')) {
      if (!unsafe(el.getAttribute('style') ?? '')) continue;
      if (el.getAttribute('data-veil') === 'x') continue;
      if (getComputedStyle(el).backgroundImage !== 'none') w.__flash.push({ src: 'bg', state: el.getAttribute('data-veil'), t: performance.now() });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

for (const path of ['static.html', 'srcset.html', 'backgrounds.html', 'spa.html', 'feed.html', 'search.html']) {
  test(`no unprotected frame of unsafe media: ${path}`, async ({ context, lab }) => {
    const page = await context.newPage();
    await page.addInitScript(SAMPLER);
    await page.goto(`${lab.originA}/${path}`);
    if (path === 'spa.html') {
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(600);
        await page.click('#next');
      }
    }
    if (path === 'feed.html') {
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => (window as unknown as { labAddCards(n: number): void }).labAddCards(10));
        await page.mouse.wheel(0, 1200);
        await page.waitForTimeout(300);
      }
    }
    await page.waitForTimeout(3500);
    const violations = await page.evaluate(() => (window as unknown as { __flash: unknown[] }).__flash);
    expect(violations).toEqual([]);
  });
}

test('gate is released immediately when protection is off for the site', async ({ context, lab }) => {
  const page = await context.newPage();
  await page.goto(`${lab.originA}/static.html`);
  await waitForVeil(page, '#explicit', 'x');
  const sw = context.serviceWorkers()[0]!;
  await sw.evaluate(async () => {
    const key = 'veil.settings';
    const s = (await chrome.storage.local.get(key))[key] as Record<string, unknown>;
    await chrome.storage.local.set({ [key]: { ...s, sites: [{ id: 'aaaaaaaa', pattern: '127.0.0.1', mode: 'off', createdAt: 0, expiresAt: null }] } });
  });
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-veil-on'));
  expect(await page.locator('#explicit').evaluate((el) => getComputedStyle(el).filter)).toBe('none');
});
