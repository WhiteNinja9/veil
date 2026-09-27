import { expect, setSettings, test, veilStateOf, waitForVeil } from './fixtures';

/**
 * People filter: blur only people who appear to be women (or men). The test
 * model reads apparent gender from the colour of the face crop (see
 * src/ml/providers/test-providers.ts and lab/png.mjs).
 */
const regions = {
  categories: {
    faces: { enabled: true, scope: 'regions' },
    people: { enabled: true, scope: 'regions' },
  },
};

test.describe('people filter', () => {
  test('blurs women only, same- and cross-origin', async ({ context, lab }) => {
    await setSettings(context, { ...regions, peopleFilter: { who: 'women', unsure: 'reveal' } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#woman', 'rg');
    await waitForVeil(page, '#woman-xo', 'rg');
    await waitForVeil(page, '#man', 'ok');
    await waitForVeil(page, '#man-xo', 'ok');
    await waitForVeil(page, '#unsure', 'ok');
    await waitForVeil(page, '#nobody', 'ok');
    const render = await page
      .locator('#woman')
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--veil-render'));
    expect(render).toMatch(/^url\("data:image\/jpeg;base64,/);
  });

  test('blurs men only, and unsure faces when asked', async ({ context, lab }) => {
    await setSettings(context, { ...regions, peopleFilter: { who: 'men', unsure: 'protect' } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#man', 'rg');
    await waitForVeil(page, '#man-xo', 'rg');
    await waitForVeil(page, '#unsure', 'rg');
    await waitForVeil(page, '#woman', 'ok');
    await waitForVeil(page, '#nobody', 'ok');
  });

  test('can hide the whole image instead of regions', async ({ context, lab }) => {
    await setSettings(context, {
      categories: { faces: { enabled: true, scope: 'whole' } },
      peopleFilter: { who: 'women', unsure: 'reveal' },
    });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#woman', 'x');
    await waitForVeil(page, '#man', 'ok');
  });

  test('changing who is blurred re-decides the page without re-analysis', async ({ context, lab }) => {
    await setSettings(context, { ...regions, peopleFilter: { who: 'women', unsure: 'reveal' } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#woman', 'rg');
    await waitForVeil(page, '#man', 'ok');
    await setSettings(context, { peopleFilter: { who: 'men' } });
    await waitForVeil(page, '#man', 'rg');
    await waitForVeil(page, '#woman', 'ok');
  });

  test('hides a video while a matching person is on screen', async ({ context, lab }) => {
    await setSettings(context, {
      ...regions,
      peopleFilter: { who: 'women', unsure: 'reveal' },
      video: { regionsProtectWhole: true },
    });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#video-woman', 'ok');
    await waitForVeil(page, '#video-woman', 'x', 12_000);
    // The man appears at the same moment and is never matched.
    await page.waitForTimeout(1500);
    expect(await veilStateOf(page, '#video-man')).toBe('ok');
  });
});
