import { expect, test } from './fixtures';

test('smoke: static page gets verdicts', async ({ context, lab }) => {
  const page = await context.newPage();
  page.on('console', (m) => console.log('[page]', m.type(), m.text()));
  await page.goto(`${lab.originA}/static.html`);
  await page.waitForTimeout(4000);
  const states = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).map((img) => [img.id, img.getAttribute('data-veil'), getComputedStyle(img).opacity, getComputedStyle(img).filter]),
  );
  console.log(JSON.stringify(states, null, 1));
  const root = await page.evaluate(() => Array.from(document.documentElement.attributes).map((a) => `${a.name}=${a.value}`));
  console.log(root);
  expect(states.length).toBeGreaterThan(0);
});
