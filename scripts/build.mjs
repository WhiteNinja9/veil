#!/usr/bin/env node
/**
 * Veil build pipeline (esbuild).
 *
 *   --target=chrome|firefox|all   browser bundle(s) to produce
 *   --mode=production|development
 *   --watch                       rebuild on change (development)
 *   --test-model                  swap real models for the deterministic
 *                                 test provider (used by E2E tests)
 *   --out=<dir>                   override output directory (single target)
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManifest } from './manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);

const mode = args.mode === 'development' ? 'development' : 'production';
const targets = args.target === 'all' || !args.target ? ['chrome', 'firefox'] : [args.target];
const watch = Boolean(args.watch);
const testModel = Boolean(args['test-model']);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const PAGES = [
  { name: 'popup', title: 'Veil', bodyClass: 'surface-popup' },
  { name: 'options', title: 'Veil Settings', bodyClass: 'surface-app' },
  { name: 'onboarding', title: 'Welcome to Veil', bodyClass: 'surface-app' },
  { name: 'interstitial', title: 'Veil', bodyClass: 'surface-app' },
];

function pageHtml({ name, title, bodyClass }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${title}</title>
    <link rel="stylesheet" href="${name}.css" />
    <script type="module" src="${name}.js"></script>
  </head>
  <body class="${bodyClass}">
    <div id="app"></div>
  </body>
</html>
`;
}

const OFFSCREEN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Veil inference host</title>
    <script type="module" src="offscreen.js"></script>
  </head>
  <body></body>
</html>
`;

async function copyStatic(outDir, target) {
  await cp(path.join(root, 'static', 'icons'), path.join(outDir, 'icons'), { recursive: true });
  await cp(path.join(root, 'static', '_locales'), path.join(outDir, '_locales'), { recursive: true });
  if (target === 'chrome') {
    await cp(path.join(root, 'static', 'managed_schema.json'), path.join(outDir, 'managed_schema.json'));
    await writeFile(path.join(outDir, 'offscreen.html'), OFFSCREEN_HTML);
  }
  for (const page of PAGES) await writeFile(path.join(outDir, `${page.name}.html`), pageHtml(page));

  // Inference kernels for the WASM backend (loaded only when WebGPU/WebGL are unavailable).
  const wasmSrc = path.join(root, 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist');
  await mkdir(path.join(outDir, 'wasm'), { recursive: true });
  for (const file of ['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-threaded-simd.wasm']) {
    await cp(path.join(wasmSrc, file), path.join(outDir, 'wasm', file));
  }

  if (!testModel) {
    const modelsDir = path.join(root, 'assets', 'models');
    if (!existsSync(path.join(modelsDir, 'models.json'))) {
      throw new Error('Models missing. Run `npm run models` first (fetches and verifies pinned model files).');
    }
    await cp(modelsDir, path.join(outDir, 'models'), { recursive: true });
  }
}

function sharedOptions(target) {
  return {
    bundle: true,
    minify: mode === 'production',
    sourcemap: mode === 'development' ? 'linked' : false,
    target: ['chrome116', 'firefox128'],
    legalComments: mode === 'production' ? 'linked' : 'inline',
    logLevel: 'warning',
    charset: 'utf8',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    alias: { '@': path.join(root, 'src') },
    loader: { '.woff2': 'file', '.svg': 'text' },
    assetNames: 'assets/[name]-[hash]',
    define: {
      __BROWSER__: JSON.stringify(target),
      __DEV__: JSON.stringify(mode === 'development'),
      __TEST_MODEL__: JSON.stringify(testModel),
      __VERSION__: JSON.stringify(pkg.version),
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
  };
}

function buildConfigs(target, outDir) {
  const shared = sharedOptions(target);
  const moduleEntries = {
    background: 'src/background/index.ts',
    popup: 'src/popup/index.tsx',
    options: 'src/options/index.tsx',
    onboarding: 'src/onboarding/index.tsx',
    interstitial: 'src/interstitial/index.tsx',
  };
  if (target === 'chrome') moduleEntries.offscreen = 'src/offscreen/index.ts';

  return [
    {
      ...shared,
      entryPoints: moduleEntries,
      outdir: outDir,
      format: 'esm',
      splitting: true,
      chunkNames: 'chunks/[name]-[hash]',
    },
    {
      // Content scripts cannot be ES modules; the worker is kept classic for
      // the widest compatibility across Chromium and Gecko.
      ...shared,
      entryPoints: { content: 'src/content/index.ts', 'engine-worker': 'src/ml/worker/index.ts' },
      outdir: outDir,
      format: 'iife',
    },
    {
      ...shared,
      entryPoints: { content: 'src/content/protection.css' },
      outdir: outDir,
    },
  ];
}

async function sizeReport(outDir) {
  const rows = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'models' && entry.name !== '_locales') await walk(full);
      } else if (/\.(js|css|wasm)$/.test(entry.name)) {
        rows.push([path.relative(outDir, full), (await stat(full)).size]);
      }
    }
  }
  await walk(outDir);
  rows.sort((a, b) => b[1] - a[1]);
  for (const [file, size] of rows.slice(0, 14)) {
    console.log(`    ${file.padEnd(46)} ${(size / 1024).toFixed(1).padStart(8)} KB`);
  }
}

async function buildTarget(target) {
  const outDir = path.resolve(root, typeof args.out === 'string' ? args.out : path.join('dist', target));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyStatic(outDir, target);
  const manifest = createManifest({ target, version: pkg.version, mode });
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const configs = buildConfigs(target, outDir);
  if (watch) {
    for (const config of configs) {
      const ctx = await esbuild.context(config);
      await ctx.watch();
    }
    console.log(`  ◉ watching ${target} → ${path.relative(root, outDir)}`);
    return;
  }
  const started = performance.now();
  await Promise.all(configs.map((config) => esbuild.build(config)));
  console.log(
    `  ✓ ${target} (${mode}${testModel ? ', test model' : ''}) → ${path.relative(root, outDir)} in ${Math.round(performance.now() - started)} ms`,
  );
  await sizeReport(outDir);
}

try {
  for (const target of targets) await buildTarget(target);
} catch (error) {
  console.error(`✗ Build failed: ${error.message}`);
  process.exit(1);
}
