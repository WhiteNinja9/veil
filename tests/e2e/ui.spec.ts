import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { backgroundWorker, expect, setSettings, tabIdFor, test, waitForVeil } from './fixtures';

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe('popup', () => {
  test('reports page status and pauses/resumes the site', async ({ context, lab, extensionId }) => {
    await setSettings(context, {});
    const site = await context.newPage();
    await site.goto(`${lab.originA}/static.html`);
    await waitForVeil(site, '#explicit', 'x');
    const tabId = await tabIdFor(context, lab.originA);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 640 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
    await expect(popup.getByText('Protection is on')).toBeVisible();
    await expect(popup.locator('.stat').nth(1).locator('.stat__value')).not.toHaveText('0', {
      timeout: 10_000,
    });
    await popup.getByRole('button', { name: 'Pause on this site' }).click();
    await popup.getByRole('button', { name: 'For 1 hour' }).click();
    await expect(popup.getByText('Paused on this site')).toBeVisible();
    await site.waitForFunction(() => !document.documentElement.hasAttribute('data-veil-on'));
    await popup.getByRole('button', { name: 'Resume on this site' }).click();
    await expect(popup.getByText('Protection is on')).toBeVisible();
    await waitForVeil(site, '#explicit', 'x');
    expect(await axe(popup)).toEqual([]);
  });

  test('changing the level from the popup updates settings', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole('radio', { name: 'Strict' }).click();
    const sw = await backgroundWorker(context);
    await expect
      .poll(() =>
        sw.evaluate(
          async () =>
            ((await chrome.storage.local.get('veil.settings'))['veil.settings'] as { strictness: string })
              .strictness,
        ),
      )
      .toBe('strict');
  });
});

test.describe('settings', () => {
  test('search finds settings and deep-links to them', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('passcode');
    await page.getByRole('button', { name: /Settings lock/ }).click();
    await expect(page).toHaveURL(/#advanced\/lock/);
    await expect(page.getByRole('heading', { name: 'Advanced' })).toBeVisible();
  });

  test('the settings lock guards weakening changes but not strengthening ones', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#advanced`);
    await page.getByRole('button', { name: 'Set a passcode' }).click();
    await page.getByLabel('New passcode').fill('4821');
    await page.getByLabel('Confirm passcode').fill('4821');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Lock is on').first()).toBeVisible({ timeout: 15_000 });
    // Setting a passcode starts an unlock window; lock again to test the prompt.
    await page.getByRole('button', { name: 'Lock now' }).click();

    await page.goto(`chrome-extension://${extensionId}/options.html#general`);
    // Stricter: no prompt.
    await page.getByRole('radio', { name: /Maximum/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Weaker: prompt.
    await page.getByRole('switch', { name: 'Protection' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Current passcode').fill('0000');
    await dialog.getByRole('button', { name: 'Unlock' }).click();
    await expect(dialog.getByRole('alert')).toContainText('isn’t right');
    await dialog.getByLabel('Current passcode').fill('4821');
    await dialog.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('switch', { name: 'Protection' })).toHaveAttribute('aria-checked', 'false');
  });

  test('pages have no serious accessibility violations (English and Arabic)', async ({
    context,
    extensionId,
  }) => {
    for (const language of ['en', 'ar']) {
      await setSettings(context, { language });
      const page = await context.newPage();
      for (const section of [
        'general',
        'protection',
        'images',
        'sites',
        'search',
        'privacy',
        'performance',
        'advanced',
      ]) {
        await page.goto(`chrome-extension://${extensionId}/options.html#${section}`);
        await page.waitForSelector('.page__title');
        expect(await axe(page), `${language}/${section}`).toEqual([]);
      }
      await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
      await page.close();
    }
  });
});

test.describe('onboarding & interstitial', () => {
  test('first-run flow sets the chosen level and completes', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Access granted')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: /Strict/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('status')).toContainText(/Ready|didn’t finish/, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'You’re set.' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    const sw = await backgroundWorker(context);
    await page.getByRole('button', { name: 'Review settings' }).click();
    await expect
      .poll(() =>
        sw.evaluate(
          async () =>
            (await chrome.storage.local.get('veil.settings'))['veil.settings'] as {
              strictness: string;
              onboardingComplete: boolean;
            },
        ),
      )
      .toMatchObject({ strictness: 'strict', onboardingComplete: true });
  });

  test('interstitial is accessible and rejects non-http targets', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/interstitial.html#warn|javascript:alert(1)`);
    await expect(page.getByRole('heading', { name: 'Take a moment' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue/ })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
  });
});
