import { backgroundWorker, expect, setSettings, test } from './fixtures';

async function waitForRules(context: import('@playwright/test').BrowserContext, predicate: (ids: number[]) => boolean) {
  const sw = await backgroundWorker(context);
  await expect.poll(async () => predicate(await sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id)))).toBe(true);
}

test.describe('site rules', () => {
  test('blocked sites are replaced by the interstitial before loading', async ({ context, lab }) => {
    await setSettings(context, { sites: [{ id: 'aaaaaaaa', pattern: 'localhost', mode: 'block', createdAt: 0, expiresAt: null }] });
    await waitForRules(context, (ids) => ids.some((id) => id >= 1000));
    const page = await context.newPage();
    await page.goto(`${lab.originB}/static.html`).catch(() => undefined);
    await expect(page).toHaveURL(/interstitial\.html#block\|/);
    await expect(page.getByRole('heading', { name: 'This site is blocked' })).toBeVisible();
    await expect(page.getByText('localhost', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue/ })).toHaveCount(0);
  });

  test('warned sites can be continued to for a limited time', async ({ context, lab }) => {
    await setSettings(context, { sites: [{ id: 'aaaaaaaa', pattern: 'localhost', mode: 'warn', createdAt: 0, expiresAt: null }] });
    await waitForRules(context, (ids) => ids.some((id) => id >= 1000));
    const page = await context.newPage();
    await page.goto(`${lab.originB}/static.html`).catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'Take a moment' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue for 15 minutes' }).click();
    await expect(page).toHaveURL(`${lab.originB}/static.html`);
    await expect(page.getByRole('heading', { name: 'Static images' })).toBeVisible();
  });

  test('a crafted interstitial cannot bypass a block rule', async ({ context, lab, extensionId }) => {
    await setSettings(context, { sites: [{ id: 'aaaaaaaa', pattern: 'localhost', mode: 'block', createdAt: 0, expiresAt: null }] });
    await waitForRules(context, (ids) => ids.some((id) => id >= 1000));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/interstitial.html#warn|${lab.originB}/static.html`);
    await page.getByRole('button', { name: 'Continue for 15 minutes' }).click();
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/interstitial\.html/);
  });

  test('Strict Browsing installs SafeSearch and YouTube rules, and removes them when off', async ({ context }) => {
    await setSettings(context, { strictBrowsing: { enabled: true, safeSearch: true, youtubeRestricted: true, ignoreSiteExceptions: true } });
    await waitForRules(context, (ids) => ids.includes(1) && ids.includes(20));
    await setSettings(context, { strictBrowsing: { enabled: false } });
    await waitForRules(context, (ids) => !ids.includes(1) && !ids.includes(20));
  });
});
