#!/usr/bin/env node
/** Renders static/brand/icon.svg to the PNG sizes the manifest needs (run after changing the mark). */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(path.join(root, 'static/brand/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await mkdir(path.join(root, 'static/icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await writeFile(path.join(root, `static/icons/icon-${size}.png`), png);
  console.log(`  ✓ icon-${size}.png`);
}
await browser.close();
