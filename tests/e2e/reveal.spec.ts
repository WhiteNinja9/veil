import type { Page } from '@playwright/test';
import { expect, sendToTab, setSettings, tabIdFor, test, veilStateOf, waitForVeil } from './fixtures';

async function hoverCenter(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('reveal', () => {
  test('click to show, then hide again', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#explicit', 'x');
    await hoverCenter(page, '#explicit');
    const chip = page.locator('veil-layer .chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Protected');
    await expect(chip).toContainText('Explicit content');
    await chip.getByRole('button', { name: 'Show' }).click();
    await waitForVeil(page, '#explicit', 'r');
    await chip.getByRole('button', { name: 'Hide again' }).click();
    await waitForVeil(page, '#explicit', 'x');
  });

  test('press-and-hold requires a sustained press', async ({ context, lab }) => {
    await setSettings(context, { reveal: { mode: 'hold', confirm: false } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#explicit', 'x');
    await hoverCenter(page, '#explicit');
    const button = page.locator('veil-layer .chip button');
    await expect(button).toContainText('Hold to show');
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.up();
    expect(await veilStateOf(page, '#explicit')).toBe('x');
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await waitForVeil(page, '#explicit', 'r');
  });

  test('confirmation step before showing', async ({ context, lab }) => {
    await setSettings(context, { reveal: { mode: 'click', confirm: true } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#explicit', 'x');
    await hoverCenter(page, '#explicit');
    await page.locator('veil-layer .chip').getByRole('button', { name: 'Show' }).click();
    await expect(page.locator('veil-layer .chip')).toContainText('Show this content?');
    expect(await veilStateOf(page, '#explicit')).toBe('x');
    await page.locator('veil-layer .chip').getByRole('button', { name: 'Show' }).click();
    await waitForVeil(page, '#explicit', 'r');
  });

  test('reveal can be disabled entirely', async ({ context, lab }) => {
    await setSettings(context, { reveal: { mode: 'disabled' } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#explicit', 'x');
    await hoverCenter(page, '#explicit');
    await expect(page.locator('veil-layer .chip')).toContainText('Revealing is turned off');
    await expect(page.locator('veil-layer .chip button')).toHaveCount(0);
    // Context-menu "Show" obeys the same policy.
    const tabId = await tabIdFor(context, lab.originA);
    await sendToTab(context, tabId, {
      type: 'context',
      action: 'show',
      srcUrl: `${lab.originA}/img/explicit/400x300.png`,
    });
    await page.waitForTimeout(400);
    expect(await veilStateOf(page, '#explicit')).toBe('x');
  });

  test('keyboard shortcut reveals the media under the pointer', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#explicit-xo', 'x');
    await hoverCenter(page, '#explicit-xo');
    const tabId = await tabIdFor(context, lab.originA);
    await sendToTab(context, tabId, { type: 'command', command: 'reveal-focused' });
    await waitForVeil(page, '#explicit-xo', 'r');
  });

  test('context menu can protect or show a specific image', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#neutral', 'ok');
    const tabId = await tabIdFor(context, lab.originA);
    await sendToTab(context, tabId, {
      type: 'context',
      action: 'protect',
      srcUrl: `${lab.originA}/img/neutral/400x300.png`,
    });
    await waitForVeil(page, '#neutral', 'x');
    await hoverCenter(page, '#neutral');
    await expect(page.locator('veil-layer .chip')).toContainText('Hidden by you');
    await sendToTab(context, tabId, {
      type: 'context',
      action: 'show',
      srcUrl: `${lab.originA}/img/explicit/400x300.png`,
    });
    await waitForVeil(page, '#explicit', 'ok');
  });

  test('hover mode shows media only while hovered', async ({ context, lab }) => {
    await setSettings(context, { reveal: { mode: 'hover' } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    await waitForVeil(page, '#explicit', 'x');
    await hoverCenter(page, '#explicit');
    await waitForVeil(page, '#explicit', 'r');
    await page.mouse.move(5, 5);
    await waitForVeil(page, '#explicit', 'x');
  });
});
