#!/usr/bin/env node
/**
 * Engine benchmark & accuracy smoke test (headless Chromium via Playwright).
 *
 *   npm run bench                              # all backends, eval images
 *   npm run bench -- --backends=wasm,cpu --iterations=20
 *   npm run bench -- --webgpu                  # enable Chromium's WebGPU (software adapter in CI)
 *   npm run bench -- --out=bench-results/local/run.json
 *
 * Eval images are fetched by scripts/fetch-eval-images.mjs into .cache/eval
 * (they are not committed). Numbers are only meaningful relative to the
 * machine they were measured on — record hardware alongside results.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const backends = String(args.backends ?? 'webgpu,webgl,wasm,cpu').split(',');
const iterations = Number(args.iterations ?? 10);
const outDir = path.join(root, '.cache', 'bench');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

async function buildWorker() {
  await mkdir(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, 'src/ml/worker/index.ts')],
    bundle: true,
    format: 'iife',
    minify: true,
    outfile: path.join(outDir, 'engine-worker.js'),
    target: ['chrome116'],
    define: { __BROWSER__: '"chrome"', __DEV__: 'false', __TEST_MODEL__: 'false', __VERSION__: '"bench"', 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });
}

function serve() {
  const routes = [
    ['/models/', path.join(root, 'assets/models')],
    ['/wasm/', path.join(root, 'node_modules/@tensorflow/tfjs-backend-wasm/dist')],
    ['/eval/', path.join(root, '.cache/eval')],
  ];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file;
    if (url.pathname === '/' || url.pathname === '/harness.html') file = path.join(root, 'scripts/bench/harness.html');
    else if (url.pathname === '/harness.js') file = path.join(root, 'scripts/bench/harness.js');
    else if (url.pathname === '/engine-worker.js') file = path.join(outDir, 'engine-worker.js');
    else {
      const route = routes.find(([prefix]) => url.pathname.startsWith(prefix));
      if (route) file = path.join(route[1], decodeURIComponent(url.pathname.slice(route[0].length)));
    }
    if (!file || !file.startsWith(root)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function fmt(n) {
  return n === undefined ? '—' : `${n.toFixed(1)} ms`;
}

async function main() {
  await buildWorker();
  const evalImages = (await readdir(path.join(root, '.cache/eval')).catch(() => [])).filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f));
  if (!evalImages.length) console.warn('No eval images in .cache/eval — run `node scripts/fetch-eval-images.mjs`.');
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const launchArgs = args.webgpu ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader'] : [];
  const browser = await chromium.launch({ headless: true, args: launchArgs });
  const page = await browser.newPage();
  page.on('console', (m) => (m.type() === 'error' ? console.error('  [page]', m.text()) : undefined));
  await page.goto(`${origin}/harness.html`);
  await page.waitForFunction(() => window.harnessReady === true);

  const report = {
    date: new Date().toISOString(),
    machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}` },
    browser: `Chromium ${browser.version()} (headless)`,
    iterations,
    backends: [],
    accuracy: null,
  };

  console.log(`\nVeil engine benchmark — ${report.browser}`);
  console.log(`${report.machine.cpu} · ${report.machine.cores} cores · ${report.machine.memGB} GB\n`);
  const bench = await page.evaluate(({ backends, iterations }) => window.runBenchmark({ backends, iterations }), { backends, iterations });
  console.log('Classifier (MobileNetV2, 224²) per backend');
  console.log('  backend   init        load        first       median      batch×4/img  detail');
  for (const r of bench) {
    if (!r.ok) {
      console.log(`  ${r.backend.padEnd(8)}  unavailable — ${r.error}`);
      continue;
    }
    console.log(`  ${r.backend.padEnd(8)}  ${fmt(r.initMs).padEnd(10)}  ${fmt(r.loadMs).padEnd(10)}  ${fmt(r.firstMs).padEnd(10)}  ${fmt(r.medianMs).padEnd(10)}  ${fmt(r.batch4PerImageMs).padEnd(11)}  ${r.detail ?? ''}`);
  }
  report.backends = bench;

  const best = bench.filter((r) => r.ok).sort((a, b) => a.medianMs - b.medianMs)[0];
  if (best && evalImages.length) {
    console.log(`\nFull pipeline on ${evalImages.length} eval images (backend: ${best.backend}, signals: classifier + faces + people)`);
    const run = await page.evaluate(
      ({ backend, images }) => window.runEngine({ backend, images, signals: ['classifier', 'faces', 'people'], repeat: 2 }),
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
    const walls = warm.filter((r) => r.ok).map((r) => r.wallMs).sort((a, b) => a - b);
    console.log(`  warm wall-clock per image: median ${walls[Math.floor(walls.length / 2)]?.toFixed(1)} ms, p95 ${walls[Math.floor(walls.length * 0.95)]?.toFixed(1)} ms`);
    console.log(`  concurrent burst of ${run.burst.count}: ${run.burst.totalMs.toFixed(0)} ms total (${(run.burst.totalMs / run.burst.count).toFixed(1)} ms/image with batching)`);
    report.accuracy = { backend: best.backend, results: warm.map((r) => ({ name: r.name, ok: r.ok, wallMs: r.wallMs, signals: r.signals })), burst: run.burst, status: run.status };
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
