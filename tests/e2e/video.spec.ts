import { expect, setSettings, test, veilStateOf, waitForVeil } from './fixtures';

test.describe('video', () => {
  test('protects a video when its content turns unsafe, and not before', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/video.html`);
    await waitForVeil(page, '#v-neutral', 'ok');
    await waitForVeil(page, '#v-switch', 'ok');
    await waitForVeil(page, '#v-switch', 'x', 12_000);
    expect(await veilStateOf(page, '#v-neutral')).toBe('ok');
  });

  test('checks cross-origin video when CORS allows frame access', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/video.html`);
    await waitForVeil(page, '#v-xo-cors', 'x', 12_000);
  });

  test('applies the fallback policy to video frames that cannot be read', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/video.html`);
    // Balanced: unverifiable media is shown.
    await waitForVeil(page, '#v-xo', 'ok');
    // Strict: unverifiable media stays hidden.
    await setSettings(context, { fallback: 'protect' });
    await page.reload();
    await waitForVeil(page, '#v-xo', 'x');
  });

  test('restores a video after consecutive safe frames when enabled', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/video.html`);
    await waitForVeil(page, '#v-switch', 'x', 12_000);
    // The fixture loops: neutral again after 6 s; hysteresis requires sustained safe frames.
    await waitForVeil(page, '#v-switch', 'ok', 15_000);
  });
});
