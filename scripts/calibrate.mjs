#!/usr/bin/env node
/**
 * Threshold calibration against a private, labelled image set.
 *
 *   npm run calibrate -- --data=<dir> [options]
 *
 *   <dir>/safe/**          images that should never be protected (required)
 *   <dir>/explicit/**      \
 *   <dir>/illustrated/**    } images for each content category (any may be omitted)
 *   <dir>/suggestive/**    /
 *
 * Options
 *   --backend=wasm|webgl|webgpu|cpu|auto   inference backend (default auto)
 *   --context             also run face/person detection and apply
 *                         context-aware scoring, as when a user enables
 *                         people protection (default: classifier only,
 *                         matching the default configuration)
 *   --out=<file>          write the aggregated report as JSON
 *   --per-image           include per-image scores and paths in the JSON
 *                         (off by default: file names can be sensitive)
 *   --from=<report.json>  re-analyse scores from an earlier --per-image
 *                         report without running inference
 *   --concurrency=<n>     requests in flight (default 8)
 *
 * Everything runs locally: images are read from disk and served to a
 * headless Chromium over 127.0.0.1 only. The inference path is the
 * extension's own worker and models; scoring is the extension's own
 * policy code. Method and caveats: docs/ML.md.
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { buildWorker, cacheDir, IMAGE_FILE, parseArgs, root, serve } from './bench/common.mjs';

const args = parseArgs();
const LABELS = ['safe', 'explicit', 'illustrated', 'suggestive'];
const LEVELS = ['minimal', 'balanced', 'strict', 'maximum'];
const pct = (v, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—');

/** Bundles the extension's own calibration and scoring code for Node. */
async function loadPolicyCode() {
  const outfile = path.join(cacheDir, 'calibration.mjs');
  await mkdir(cacheDir, { recursive: true });
  await esbuild.build({
    stdin: {
      contents: [
        "export * from './src/policy/calibration.ts';",
        "export { scoreCategories } from './src/policy/engine.ts';",
        "export { PRESETS } from './src/policy/presets.ts';",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'warning',
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

async function listImages(dir, base) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listImages(full, base)));
    else if (entry.isFile() && IMAGE_FILE.test(entry.name)) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

async function runInference(dataDir, images, signals) {
  const { chromium } = await import('@playwright/test');
  await buildWorker();
  const server = await serve({ imagesDir: dataDir });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      const text = message.text();
      if (text.startsWith('progress ')) process.stdout.write(`\r  classifying… ${text.slice(9)}   `);
      else if (message.type() === 'error') console.error(`  [page] ${text}`);
    });
    await page.goto(`${origin}/harness.html`);
    await page.waitForFunction(() => window.harnessReady === true);
    const run = await page.evaluate(
      ({ backend, images, signals, concurrency }) =>
        window.classify({ backend, images, signals, concurrency }),
      {
        backend: String(args.backend ?? 'auto'),
        images,
        signals,
        concurrency: Number(args.concurrency ?? 8),
      },
    );
    process.stdout.write('\n');
    return { ...run, browser: `Chromium ${browser.version()} (headless)` };
  } finally {
    await browser.close();
    server.close();
  }
}

function printTable(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const [index, row] of rows.entries()) {
    console.log('  ' + row.map((cell, i) => String(cell).padEnd(widths[i])).join('  '));
    if (index === 0) console.log('  ' + widths.map((w) => '─'.repeat(w)).join('  '));
  }
}

async function main() {
  const policy = await loadPolicyCode();
  const contextAware = Boolean(args.context);
  let samples;
  let meta;

  if (args.from) {
    const previous = JSON.parse(await readFile(path.resolve(String(args.from)), 'utf8'));
    if (!Array.isArray(previous.samples)) throw new Error('--from needs a report written with --per-image');
    samples = previous.samples;
    meta = { ...previous.meta, reanalysedAt: new Date().toISOString() };
  } else {
    if (typeof args.data !== 'string') {
      console.error('Usage: npm run calibrate -- --data=<dir>   (see header of scripts/calibrate.mjs)');
      process.exit(2);
    }
    const dataDir = path.resolve(args.data);
    if (!(await stat(dataDir).catch(() => null))?.isDirectory())
      throw new Error(`Not a directory: ${dataDir}`);
    const byLabel = {};
    for (const label of LABELS) byLabel[label] = await listImages(path.join(dataDir, label), dataDir);
    if (!byLabel.safe.length)
      throw new Error('No images in <data>/safe — false-positive rates need safe images.');
    const images = LABELS.flatMap((label) => byLabel[label]);
    const signals = contextAware ? ['classifier', 'faces', 'people'] : ['classifier'];
    console.log(
      `\nVeil calibration — ${images.length} images (${LABELS.map((l) => `${l} ${byLabel[l].length}`).join(' · ')})`,
    );
    const run = await runInference(dataDir, images, signals);
    const failed = run.results.filter((r) => !r.ok);
    if (failed.length) console.warn(`  ${failed.length} image(s) could not be decoded and were skipped.`);
    samples = run.results
      .filter((r) => r.ok && r.signals.classifier)
      .map((r) => {
        const label = r.name.split('/')[0];
        const scores = policy.scoreCategories(r.signals, contextAware);
        return { name: r.name, label, scores };
      });
    meta = {
      date: new Date().toISOString(),
      backend: run.backend,
      browser: run.browser,
      contextAware,
      skipped: failed.length,
    };
  }

  const counts = Object.fromEntries(LABELS.map((l) => [l, samples.filter((s) => s.label === l).length]));
  console.log(`  backend ${meta.backend} · context-aware scoring ${meta.contextAware ? 'on' : 'off'}\n`);

  // 1. Shipped levels, whole-image outcome.
  const levels = LEVELS.map((level) => policy.evaluateLevel(samples, level));
  console.log('Shipped levels — an image is protected when any enabled category reaches its threshold');
  printTable([
    ['level', 'unsafe protected', 'safe protected', '95% CI (safe)'],
    ...levels.map((o) => [
      o.level,
      o.unsafe ? pct(o.recall) : 'n/a',
      pct(o.fpr),
      `${pct(o.fprInterval[0])} – ${pct(o.fprInterval[1])}`,
    ]),
  ]);

  // 2. Per-category sweeps and suggestions.
  const categories = {};
  const suggestionRows = [
    ['category', 'level', 'FPR budget', 'shipped', 'suggested', 'recall', 'safe protected'],
  ];
  for (const category of policy.CONTENT_CATEGORIES) {
    const points = policy.sweep(samples, category);
    const suggestions = {};
    for (const level of LEVELS) {
      const budget = policy.FPR_BUDGETS[level];
      const point = policy.suggestThreshold(points, budget);
      const shipped = policy.PRESETS[level][category];
      suggestions[level] = point ? { threshold: point.threshold, tpr: point.tpr, fpr: point.fpr } : null;
      suggestionRows.push([
        category,
        level,
        pct(budget),
        shipped.enabled ? shipped.threshold.toFixed(2) : `off (${shipped.threshold.toFixed(2)})`,
        point ? point.threshold.toFixed(2) : 'none',
        counts[category] && point ? pct(point.tpr) : 'n/a',
        point ? pct(point.fpr) : '—',
      ]);
    }
    categories[category] = { positives: counts[category], points, suggestions };
  }
  console.log('\nPer category — lowest threshold whose false-positive rate on safe images fits the budget');
  printTable(suggestionRows);

  // 3. Honest caveats.
  const notes = [];
  if (counts.safe < 300) {
    notes.push(
      `Only ${counts.safe} safe images: false-positive rates move in steps of ${pct(1 / counts.safe, 2)}; ` +
        'budgets below that cannot be distinguished. Use several hundred or more, from the sites you care about.',
    );
  }
  for (const category of policy.CONTENT_CATEGORIES) {
    if (counts[category] > 0 && counts[category] < 100) {
      notes.push(`${category}: ${counts[category]} images — recall estimates are coarse.`);
    } else if (!counts[category]) notes.push(`${category}: no images — recall not measured.`);
  }
  notes.push(
    'Suggestions optimise for this set. A set unlike real browsing gives thresholds unlike real use.',
  );
  console.log('\nNotes');
  for (const note of notes) console.log(`  • ${note}`);

  if (args.out) {
    const report = {
      meta,
      counts,
      fprBudgets: policy.FPR_BUDGETS,
      levels,
      categories,
      notes,
      ...(args['per-image'] ? { samples } : {}),
    };
    const out = path.resolve(String(args.out));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(report, null, 2));
    const shown = path.relative(process.cwd(), out);
    console.log(`\nReport written to ${shown.startsWith('..') ? out : shown}`);
  }
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
