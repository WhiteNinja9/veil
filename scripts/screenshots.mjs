#!/usr/bin/env node
/* global chrome */
/**
 * Captures the extension UI (popup, settings, onboarding, interstitial, and
 * in-page protection) in light, dark and Arabic/RTL for design review and
 * store listings. Uses the development test-model build.
 *
 *   node scripts/screenshots.mjs [--only=popup,options] [--out=artifacts/screenshots]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLab } from '../lab/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = args.only ? new Set(args.only.split(',')) : null;
const out = path.resolve(root, args.out ?? 'artifacts/screenshots');
const extensionPath = path.resolve(root, args.build ?? 'dist/chrome-test');

const want = (name) => !only || only.has(name);

async function main() {
  await mkdir(out, { recursive: true });
  const lab = await startLab(4790, 4791);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    deviceScaleFactor: 2,
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const base = `chrome-extension://${id}`;

  const setSettings = (patch) =>
    sw.evaluate(async (p) => {
      const key = 'veil.settings';
      const cur = (await chrome.storage.local.get(key))[key] ?? {};
      const merge = (a, b) => {
        const o = { ...a };
        for (const [k, v] of Object.entries(b))
          o[k] =
            v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object'
              ? merge(a[k], v)
              : v;
        return o;
      };
      await chrome.storage.local.set({ [key]: merge(cur, { onboardingComplete: true, ...p }) });
    }, patch);

  // A content page for the popup to describe.
  const site = await context.newPage();
  await site.goto(`${lab.originA}/static.html`);
  await site.waitForTimeout(2500);
  const tabId = await sw.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url))?.id,
    lab.originA,
  );

  const variants = [
    { name: 'light', scheme: 'light', language: 'en' },
    { name: 'dark', scheme: 'dark', language: 'en' },
    { name: 'ar', scheme: 'light', language: 'ar' },
  ];

  for (const v of variants) {
    await setSettings({ language: v.language, appearance: { theme: 'system' } });
    if (want('popup')) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: v.scheme });
      await page.setViewportSize({ width: 360, height: 620 });
      await page.goto(`${base}/popup.html?tabId=${tabId}`);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, `popup-${v.name}.png`), fullPage: true });
      await page.close();
    }
    if (want('options')) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: v.scheme });
      await page.setViewportSize({ width: 1280, height: 900 });
      for (const section of [
        'general',
        'protection',
        'images',
        'sites',
        'privacy',
        'performance',
        'advanced',
      ]) {
        await page.goto(`${base}/options.html#${section}`);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(out, `options-${section}-${v.name}.png`) });
      }
      await page.close();
    }
    if (want('onboarding')) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: v.scheme });
      await page.setViewportSize({ width: 1180, height: 820 });
      await page.goto(`${base}/onboarding.html`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `onboarding-${v.name}.png`) });
      await page.close();
    }
    if (want('interstitial')) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: v.scheme });
      await page.setViewportSize({ width: 1180, height: 760 });
      await page.goto(`${base}/interstitial.html#warn|https://example.com/`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, `interstitial-${v.name}.png`) });
      await page.close();
    }
  }

  if (want('page')) {
    await setSettings({ language: 'en' });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1180, height: 800 });
    await page.goto(`${lab.originA}/static.html`);
    await page.waitForTimeout(2500);
    const box = await page.locator('#explicit').boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'page-protected.png') });
    await page.close();
  }

  await context.close();
  await lab.close();
  console.log(`Screenshots written to ${path.relative(root, out)}/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
