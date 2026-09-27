#!/usr/bin/env node
/**
 * End-to-end latency in the real extension: how long each image stays
 * hidden before Veil decides, measured from navigation start in the page.
 *
 *   npm run build:chrome && node scripts/bench/latency.mjs [--runs=5]
 *
 * Scenarios on the lab's eval page (15 safe photos, .cache/eval):
 *   cold    first page after the browser starts: offscreen document,
 *           backend initialisation and model loading are on the clock
 *   warm    engine loaded, result cache emptied: pure analysis latency
 *   cached  same page again with results cached in the background
 *
 * Uses the production build in dist/chrome (real models). Numbers depend
 * heavily on hardware and on the backend chosen; record both.
 */
/* global chrome, MutationObserver */
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { startLab } from '../../lab/server.mjs';
import { parseArgs, root } from './common.mjs';

const args = parseArgs();
const runs = Number(args.runs ?? 5);
const extensionPath = path.join(root, 'dist', 'chrome');

// Runs in the page's main world before any page script; the content script
// sets data-veil on the same shared DOM.
const OBSERVER = () => {
  const decided = new Map();
  window.__veilDecided = decided;
  new MutationObserver((records) => {
    for (const record of records) {
      const el = record.target;
      if (el.localName !== 'img' || decided.has(el.id)) continue;
      if (['ok', 'x', 'rg'].includes(el.getAttribute('data-veil') ?? ''))
        decided.set(el.id, performance.now());
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-veil'] });
};

async function measure(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll('img')];
      return imgs.length > 0 && imgs.every((img) => window.__veilDecided?.has(img.id));
    },
    undefined,
    { timeout: 180_000 },
  );
  return page.evaluate(() => [...window.__veilDecided.values()]);
}

function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

async function main() {
  if (!existsSync(path.join(extensionPath, 'models', 'models.json'))) {
    throw new Error('Production build with models not found: run `npm run models && npm run build:chrome`.');
  }
  const lab = await startLab(4720, 4721);
  const url = `${lab.originA}/eval.html`;
  const results = { cold: [], warm: [], cached: [] };
  const firsts = { cold: [], warm: [], cached: [] };
  const record = (name, samples) => {
    results[name].push(...samples);
    firsts[name].push(Math.min(...samples));
  };
  let backend = 'unknown';

  for (let run = 0; run < runs; run++) {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      let [worker] = context.serviceWorkers();
      worker ??= await context.waitForEvent('serviceworker');
      const extensionId = new URL(worker.url()).host;
      // Extension APIs are bound shortly after the worker starts evaluating.
      for (let i = 0; i < 50; i++) {
        const ready = await worker
          .evaluate(() => typeof chrome !== 'undefined' && Boolean(chrome.storage?.local))
          .catch(() => false);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await worker.evaluate(() =>
        chrome.storage.local.set({ 'veil.settings': { onboardingComplete: true } }),
      );
      await context.addInitScript(OBSERVER);
      const page = await context.newPage();

      record('cold', await measure(page, url));
      // Extension messages go through an extension page. It is closed again
      // before measuring: a background tab is throttled and would skew timings.
      const extensionMessage = async (message) => {
        const control = await context.newPage();
        await control.goto(`chrome-extension://${extensionId}/options.html`);
        const response = await control.evaluate((m) => chrome.runtime.sendMessage(m), message);
        await control.close();
        await page.bringToFront();
        return response;
      };
      await extensionMessage({ type: 'engine/clear-cache' });
      record('warm', await measure(page, url));
      record('cached', await measure(page, url));
      const status = await extensionMessage({ type: 'engine/status' });
      backend = status?.backend ?? backend;
      process.stdout.write(`  run ${run + 1}/${runs} done\n`);
    } finally {
      await context.close();
    }
  }
  lab.close?.();

  console.log(`\nVeil time-to-verdict — ${os.cpus()[0]?.model} · ${os.cpus().length} cores`);
  console.log(`Backend: ${backend} · ${runs} runs × 15 images · ms from navigation start\n`);
  console.log('  scenario  images  first*   median    p95       max');
  for (const [name, samples] of Object.entries(results)) {
    const s = summarise(samples);
    const first = summarise(firsts[name]).median;
    console.log(
      `  ${name.padEnd(8)}  ${String(s.n).padEnd(6)}  ${first.toFixed(0).padStart(6)}   ${s.median.toFixed(0).padStart(6)}    ${s.p95.toFixed(0).padStart(6)}    ${s.max.toFixed(0).padStart(6)}`,
    );
  }
  console.log('  * first image decided on the page (median over runs)');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
