import {
  type BrowserContext,
  chromium,
  type Frame,
  type Page,
  test as base,
  type Worker,
} from '@playwright/test';
import path from 'node:path';
// @ts-expect-error — plain ESM module without types
import { startLab } from '../../lab/server.mjs';

interface Lab {
  originA: string;
  originB: string;
  close(): Promise<void>;
}

export const TEST_BUILD = path.resolve('dist/chrome-test');
export const REAL_BUILD = path.resolve('dist/chrome');

async function launch(extensionPath: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
}

export async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  let sw = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  if (!sw)
    sw = await context.waitForEvent('serviceworker', {
      predicate: (w) => w.url().startsWith('chrome-extension://'),
    });
  // Extension APIs are bound shortly after the worker starts evaluating.
  for (let i = 0; i < 50; i++) {
    if (
      await sw
        .evaluate(() => typeof chrome !== 'undefined' && Boolean(chrome.storage?.local))
        .catch(() => false)
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return sw;
}

/** Writes a settings patch through the background (as the options page would). */
export async function setSettings(context: BrowserContext, patch: Record<string, unknown>): Promise<void> {
  const sw = await backgroundWorker(context);
  await sw.evaluate(async (p) => {
    const key = 'veil.settings';
    const current = ((await chrome.storage.local.get(key))[key] ?? {}) as Record<string, unknown>;
    const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
      const out = { ...a };
      for (const [k, v] of Object.entries(b)) {
        out[k] =
          v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object'
            ? merge(a[k] as Record<string, unknown>, v as Record<string, unknown>)
            : v;
      }
      return out;
    };
    await chrome.storage.local.set({ [key]: merge(current, { onboardingComplete: true, ...p }) });
  }, patch);
}

export const test = base.extend<
  { context: BrowserContext; extensionId: string; build: string },
  { lab: Lab }
>({
  lab: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern
    async ({}, use, workerInfo) => {
      const lab = (await startLab(
        4700 + workerInfo.workerIndex * 2,
        4701 + workerInfo.workerIndex * 2,
      )) as Lab;
      await use(lab);
      await lab.close();
    },
    { scope: 'worker' },
  ],
  build: [TEST_BUILD, { option: true }],
  context: async ({ build }, use) => {
    const context = await launch(build);
    await backgroundWorker(context);
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const sw = await backgroundWorker(context);
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;

/** State attribute Veil sets on a media element (null while unseen). */
export const veilState = (selector: string) =>
  `document.querySelector(${JSON.stringify(selector)})?.getAttribute('data-veil')`;

/** Waits until `selector` carries one of the expected Veil states. */
export async function waitForVeil(
  target: Page | Frame,
  selector: string,
  expected: string | string[],
  timeout = 15_000,
): Promise<void> {
  const wanted = Array.isArray(expected) ? expected : [expected];
  await target.waitForFunction(
    ([sel, states]) => {
      const el = document.querySelector(sel as string);
      return Boolean(el && (states as string[]).includes(el.getAttribute('data-veil') ?? ''));
    },
    [selector, wanted] as const,
    { timeout },
  );
}

export async function veilStateOf(target: Page | Frame, selector: string): Promise<string | null> {
  return target.evaluate((sel) => document.querySelector(sel)?.getAttribute('data-veil') ?? null, selector);
}

/** Tab id of the first tab whose URL starts with `prefix` (resolved in the background). */
export async function tabIdFor(context: BrowserContext, prefix: string): Promise<number> {
  const sw = await backgroundWorker(context);
  return sw.evaluate(
    async (p) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(p))?.id ?? -1,
    prefix,
  );
}

/** Sends a message from the background to a tab, like a keyboard command or context menu would. */
export async function sendToTab(context: BrowserContext, tabId: number, message: unknown): Promise<void> {
  const sw = await backgroundWorker(context);
  await sw.evaluate(
    async ([id, m]) => {
      await chrome.tabs.sendMessage(id as number, m).catch(() => undefined);
    },
    [tabId, message] as const,
  );
}
