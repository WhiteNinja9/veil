import { expect, tabIdFor, test, waitForVeil } from './fixtures';

/** Each test documents a bug that was found and fixed; they must never regress. */
test.describe('regressions', () => {
  test('first page after install gets real verdicts, not fallbacks (offscreen listener race)', async ({ context, lab, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/static.html`);
    for (const id of ['explicit', 'suggestive', 'illustrated']) await waitForVeil(page, `#${id}`, 'x');
    const tabId = await tabIdFor(context, lab.originA);
    // Ask the background from an extension page, as the popup does.
    const probe = await context.newPage();
    await probe.goto(`chrome-extension://${extensionId}/popup.html`);
    const stats = async () =>
      probe.evaluate(async (id) => ((await chrome.runtime.sendMessage({ type: 'tab/state', tabId: id })) as { stats: { unverified: number; scanned: number } }).stats, tabId);
    await expect.poll(async () => (await stats()).scanned).toBeGreaterThan(0);
    expect((await stats()).unverified).toBe(0);
  });

  test('images whose source changes are re-verified before being shown', async ({ context, lab }) => {
    const page = await context.newPage();
    await page.goto(`${lab.originA}/srcset.html`);
    await waitForVeil(page, '#swap', 'ok');
    await waitForVeil(page, '#swap', 'x');
  });
});
