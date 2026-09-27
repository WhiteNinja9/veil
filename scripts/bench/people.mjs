#!/usr/bin/env node
/**
 * People filter check: runs the shipped worker (face detection with tiling,
 * then apparent gender) on hand-labelled photos and scores the result with
 * Veil's own cut-offs and default face threshold.
 *
 *   node scripts/fetch-eval-images.mjs      # photos → .cache/eval/people
 *   node scripts/bench/people.mjs [--list]  # --list prints every labelled face
 *
 * Labels: scripts/bench/people-labels.json. The sample is small (see
 * docs/ML.md); treat the output as a sanity check, not a benchmark.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from '@playwright/test';
import { buildWorker, cacheDir, parseArgs, root, serve } from './common.mjs';

const args = parseArgs();
const FACE_THRESHOLD = 0.75; // default Faces threshold (src/policy/presets.ts)

async function loadPolicy() {
  const outfile = path.join(cacheDir, 'people-policy.mjs');
  await esbuild.build({
    stdin: {
      contents: "export { apparentGender } from './src/policy/engine.ts';",
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

function auc(women, men) {
  let sum = 0;
  for (const f of women) for (const m of men) sum += f > m ? 1 : f === m ? 0.5 : 0;
  return sum / (women.length * men.length);
}

async function main() {
  const { apparentGender } = await loadPolicy();
  const { labels } = JSON.parse(await readFile(path.join(root, 'scripts/bench/people-labels.json'), 'utf8'));
  const evalDir = path.join(root, '.cache', 'eval');
  const images = Object.keys(labels).map((f) => `people/${f}`);

  await buildWorker();
  const server = await serve({ imagesDir: evalDir });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/harness.html`);
  await page.waitForFunction(() => window.harnessReady === true);
  const run = await page.evaluate(
    (images) => window.classify({ backend: 'wasm', images, signals: ['gender'], concurrency: 1 }),
    images,
  );
  await browser.close();
  server.close();

  const faces = [];
  let labelled = 0;
  let totalMs = 0;
  let judged = 0;
  for (const result of run.results) {
    const file = result.name.replace(/^people\//, '');
    if (!result.ok) {
      console.warn(`  ! ${file}: ${result.error} (run scripts/fetch-eval-images.mjs)`);
      continue;
    }
    totalMs += result.signals.ms;
    const detected = result.signals.gender.filter((f) => f.score >= FACE_THRESHOLD);
    judged += detected.filter((f) => f.female !== undefined).length;
    const label = labels[file];
    const wanted =
      typeof label === 'string' ? detected.map((f) => [f.x + f.w / 2, f.y + f.h / 2, label]) : label;
    for (const [x, y, gender] of wanted) {
      labelled++;
      const face = detected.find(
        (f) => x >= f.x && x <= f.x + f.w && y >= f.y - 0.05 && y <= f.y + f.h + 0.05,
      );
      if (face)
        faces.push({ file, gender, female: face.female, px: Math.round(face.w * result.signals.width) });
    }
  }

  const reading = (f) => apparentGender(f.female);
  const women = faces.filter((f) => f.gender === 'F');
  const men = faces.filter((f) => f.gender === 'M');
  const count = (list, pick) => list.filter(pick).length;
  const scored = faces.filter((f) => f.female !== undefined);
  const correctAtHalf = scored.filter((f) => f.female >= 0.5 === (f.gender === 'F')).length;

  console.log(`\nVeil people filter — ${images.length} photos, ${labelled} labelled faces`);
  console.log(`  detected at the default face threshold (${FACE_THRESHOLD}): ${faces.length}`);
  console.log(`  with a gender estimate: ${scored.length} (${women.length} women, ${men.length} men)`);
  console.log(
    `  single 0.5 cut-off: ${correctAtHalf}/${scored.length} correct (${((100 * correctAtHalf) / scored.length).toFixed(0)}%), ` +
      `ROC AUC ${auc(
        women.filter((f) => f.female !== undefined).map((f) => f.female),
        men.filter((f) => f.female !== undefined).map((f) => f.female),
      ).toFixed(3)}`,
  );
  console.log('\n  setting                target blurred     others blurred');
  const rows = [
    ['Women, unsure → Blur', women, men, (f) => reading(f) !== 'male'],
    ['Women, unsure → Show', women, men, (f) => reading(f) === 'female'],
    ['Men, unsure → Blur', men, women, (f) => reading(f) !== 'female'],
    ['Men, unsure → Show', men, women, (f) => reading(f) === 'male'],
  ];
  for (const [name, target, others, blurred] of rows) {
    console.log(
      `  ${name.padEnd(22)} ${`${count(target, blurred)} / ${target.length}`.padEnd(18)} ${count(others, blurred)} / ${others.length}`,
    );
  }
  console.log(
    `\n  ${judged} faces judged in ${(totalMs / 1000).toFixed(1)} s of engine time (incl. detection)`,
  );
  if (args.list) {
    for (const f of [...faces].sort((a, b) => (a.female ?? -1) - (b.female ?? -1))) {
      console.log(
        `   ${f.gender} ${f.female === undefined ? '  — ' : f.female.toFixed(2)} ${reading(f).padEnd(6)} ${String(f.px).padStart(4)}px  ${f.file}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
