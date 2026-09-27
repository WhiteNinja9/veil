import { expect, setSettings, test, veilStateOf, waitForVeil } from './fixtures';

test.describe('policy changes', () => {
  test('stricter levels apply instantly using cached signals', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#borderline', 'ok');
    const started = Date.now();
    await setSettings(context, { strictness: 'strict', categories: { suggestive: { enabled: true, threshold: 0.6 } } });
    await waitForVeil(page, '#borderline', 'x', 3000);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('protection style changes are applied to the page', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#explicit', 'x');
    for (const style of ['pixelate', 'solid', 'hide', 'blur-soft'] as const) {
      await setSettings(context, { appearance: { style } });
      await page.waitForFunction((s) => document.documentElement.getAttribute('data-veil-style') === s, style);
    }
    await setSettings(context, { appearance: { style: 'hide' } });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#explicit')!).visibility === 'hidden');
  });

  test('does not engage when protection is turned off', async ({ context, lab }) => {
    await setSettings(context, { enabled: false });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-veil-on'));
    await page.waitForTimeout(500);
    expect(await veilStateOf(page, '#explicit')).toBeNull();
  });

  test('blurs only detected faces when face protection is on', async ({ context, lab }) => {
    await setSettings(context, { categories: { faces: { enabled: true, threshold: 0.75, scope: 'regions' } } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#face', 'rg');
    const render = await page.locator('#face').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--veil-render'));
    expect(render).toMatch(/^url\("data:image\/jpeg;base64,/);
    // Unrelated content is unaffected.
    await waitForVeil(page, '#neutral', 'ok');
  });

  test('media types can be excluded', async ({ context, lab }) => {
    await setSettings(context, { media: { backgrounds: false } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/backgrounds.html`);
    await page.waitForTimeout(1500);
    expect(await veilStateOf(page, '#bg-explicit')).toBeNull();
    expect(await page.locator('#bg-explicit').evaluate((el) => getComputedStyle(el).backgroundImage)).not.toBe('none');
  });
});
