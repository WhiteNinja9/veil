#!/usr/bin/env node
/**
 * Engine benchmark & accuracy smoke test (headless Chromium via Playwright).
 *
 *   npm run bench                              # all backends, eval images
 *   npm run bench -- --backends=wasm,cpu --iterations=20
 *   npm run bench -- --webgpu                  # enable Chromium's WebGPU (software adapter in CI)
 *   npm run bench -- --swiftshader             # software WebGL (code-path check, not a GPU timing)
 *   npm run bench -- --csp                     # serve with the extension's CSP
 *   npm run bench -- --out=bench-results/local/run.json
 *
 * Eval images are fetched by scripts/fetch-eval-images.mjs into .cache/eval
 * (they are not committed). Numbers are only meaningful relative to the
 * machine they were measured on — record hardware alongside results.
 */
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { buildWorker, IMAGE_FILE, parseArgs, root, serve } from './common.mjs';

const args = parseArgs();
const backends = String(args.backends ?? 'webgpu,webgl,wasm,cpu').split(',');
const iterations = Number(args.iterations ?? 10);
const evalDir = path.join(root, '.cache', 'eval');

function fmt(n) {
  return n === undefined ? '—' : `${n.toFixed(1)} ms`;
}

async function main() {
  await buildWorker();
  const evalImages = (await readdir(evalDir).catch(() => [])).filter((f) => IMAGE_FILE.test(f));
  if (!evalImages.length)
    console.warn('No eval images in .cache/eval — run `node scripts/fetch-eval-images.mjs`.');
  const server = await serve({ imagesDir: evalDir, csp: Boolean(args.csp) });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Software adapters exercise the WebGPU/WebGL code paths on GPU-less
  // machines; their timings say nothing about real GPUs.
  const launchArgs = [];
  if (args.webgpu)
    launchArgs.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader');
  if (args.swiftshader) launchArgs.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const browser = await chromium.launch({ headless: true, args: launchArgs });
  const page = await browser.newPage();
  page.on('console', (m) => (m.type() === 'error' ? console.error('  [page]', m.text()) : undefined));
  await page.goto(`${origin}/harness.html`);
  await page.waitForFunction(() => window.harnessReady === true);

  const report = {
    date: new Date().toISOString(),
    machine: {
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memGB: Math.round(os.totalmem() / 2 ** 30),
      platform: `${os.platform()} ${os.release()}`,
    },
    browser: `Chromium ${browser.version()} (headless)`,
    iterations,
    backends: [],
    accuracy: null,
  };

  console.log(`\nVeil engine benchmark — ${report.browser}`);
  console.log(`${report.machine.cpu} · ${report.machine.cores} cores · ${report.machine.memGB} GB\n`);
  const bench = await page.evaluate(
    ({ backends, iterations }) => window.runBenchmark({ backends, iterations }),
    { backends, iterations },
  );
  console.log('Classifier (MobileNetV2, 224²) per backend');
  console.log('  backend   init        load        first       median      batch×4/img  detail');
  for (const r of bench) {
    if (!r.ok) {
      console.log(`  ${r.backend.padEnd(8)}  unavailable — ${r.error}`);
      continue;
    }
    console.log(
      `  ${r.backend.padEnd(8)}  ${fmt(r.initMs).padEnd(10)}  ${fmt(r.loadMs).padEnd(10)}  ${fmt(r.firstMs).padEnd(10)}  ${fmt(r.medianMs).padEnd(10)}  ${fmt(r.batch4PerImageMs).padEnd(11)}  ${r.detail ?? ''}`,
    );
  }
  report.backends = bench;

  const best = bench.filter((r) => r.ok).sort((a, b) => a.medianMs - b.medianMs)[0];
  if (best && evalImages.length) {
    console.log(
      `\nFull pipeline on ${evalImages.length} eval images (backend: ${best.backend}, signals: classifier + faces + people)`,
    );
    const run = await page.evaluate(
      ({ backend, images }) =>
        window.runEngine({ backend, images, signals: ['classifier', 'faces', 'people'], repeat: 2 }),
      { backend: best.backend, images: evalImages },
    );
    const warm = run.results.filter((r) => r.round === 1);
    for (const r of warm) {
      if (!r.ok) {
        console.log(`  ${r.name.padEnd(22)} error: ${r.error} ${r.message ?? ''}`);
        continue;
      }
      const c = r.signals.classifier;
      const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      console.log(
        `  ${r.name.padEnd(22)} ${String(r.signals.width + '×' + r.signals.height).padEnd(10)} ${top[0].padEnd(8)} ${top[1].toFixed(3)}  porn ${c.porn.toFixed(3)} sexy ${c.sexy.toFixed(3)} hentai ${c.hentai.toFixed(3)}  faces ${r.signals.faces.length}  people ${r.signals.people.length}  ${r.wallMs.toFixed(0)} ms`,
      );
    }
    const walls = warm
      .filter((r) => r.ok)
      .map((r) => r.wallMs)
      .sort((a, b) => a - b);
    console.log(
      `  warm wall-clock per image: median ${walls[Math.floor(walls.length / 2)]?.toFixed(1)} ms, p95 ${walls[Math.floor(walls.length * 0.95)]?.toFixed(1)} ms`,
    );
    console.log(
      `  concurrent burst of ${run.burst.count}: ${run.burst.totalMs.toFixed(0)} ms total (${(run.burst.totalMs / run.burst.count).toFixed(1)} ms/image; batched only on GPU backends)`,
    );
    report.accuracy = {
      backend: best.backend,
      results: warm.map((r) => ({ name: r.name, ok: r.ok, wallMs: r.wallMs, signals: r.signals })),
      burst: run.burst,
      status: run.status,
    };
  }

  if (args.out) {
    const out = path.resolve(root, String(args.out));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${path.relative(root, out)}`);
  }
  await browser.close();
  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
