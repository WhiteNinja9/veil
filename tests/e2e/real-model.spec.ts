/**
 * Smoke test with the real models (production build) on safe sample images.
 * Verifies the full production pipeline — model loading, backend selection,
 * inference, policy — and guards against false positives on everyday
 * photographs. Requires `npm run models` and `node scripts/fetch-eval-images.mjs`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { expect, REAL_BUILD, setSettings, test } from './fixtures';

const EVAL_DIR = '.cache/eval';
const images = existsSync(EVAL_DIR) ? readdirSync(EVAL_DIR).filter((f) => /\.(jpe?g|png)$/.test(f)) : [];

test.use({ build: REAL_BUILD });
test.skip(!existsSync(`${REAL_BUILD}/models/models.json`) || images.length === 0, 'production build or eval images missing');
test.setTimeout(180_000);

test('no safe sample image is protected at the Balanced level', async ({ context, lab }) => {
  await setSettings(context, {});
  const page = await context.newPage();
  await page.goto(`${lab.originA}/eval.html`);
  await page.waitForFunction(
    () => [...document.querySelectorAll('img')].every((img) => ['ok', 'x', 'rg'].includes(img.getAttribute('data-veil') ?? '')),
    undefined,
    { timeout: 150_000 },
  );
  const protectedImages = await page.evaluate(() => [...document.querySelectorAll('img')].filter((img) => img.getAttribute('data-veil') !== 'ok').map((img) => img.id));
  expect(protectedImages).toEqual([]);
});

test('face protection blurs only face regions in real photos', async ({ context, lab }) => {
  test.skip(!images.includes('karen-and-rob.png'), 'face sample missing');
  await setSettings(context, { categories: { faces: { enabled: true, threshold: 0.75, scope: 'regions' } } });
  const page = await context.newPage();
  await page.goto(`${lab.originA}/eval.html`);
  await page.waitForFunction(() => document.querySelector('#karen-and-rob-png')?.getAttribute('data-veil') === 'rg', undefined, { timeout: 150_000 });
  // Photos without people are untouched.
  if (images.includes('fruits.jpg')) {
    await page.waitForFunction(() => document.querySelector('#fruits-jpg')?.getAttribute('data-veil') === 'ok', undefined, { timeout: 60_000 });
  }
});
