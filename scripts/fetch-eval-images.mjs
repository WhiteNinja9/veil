#!/usr/bin/env node
/**
 * Downloads a small set of *safe* evaluation images (OpenCV sample data) into
 * .cache/eval for benchmarks and the real-model smoke test. They are not
 * committed: licensing stays with their sources, and the repository ships no
 * third-party media. For accuracy calibration use your own labelled set with
 * `npm run calibrate` (see docs/ML.md).
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'eval');
const SAMPLES = 'https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/';
const CASCADE = 'https://raw.githubusercontent.com/opencv/opencv_extra/4.x/testdata/cv/cascadeandhog/images/';
const FILES = [
  ...['messi5.jpg', 'fruits.jpg', 'baboon.jpg', 'starry_night.jpg', 'building.jpg', 'home.jpg', 'graf1.png', 'box.png', 'pic1.png', 'smarties.png', 'orange.jpg', 'apple.jpg', 'butterfly.jpg'].map((f) => [SAMPLES + f, f]),
  ...['class57.png', 'karen-and-rob.png'].map((f) => [CASCADE + f, f]),
];

await mkdir(out, { recursive: true });
for (const [url, name] of FILES) {
  const target = path.join(out, name);
  try {
    await stat(target);
    continue;
  } catch {
    // download
  }
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`  ! ${name}: HTTP ${response.status}`);
    continue;
  }
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  console.log(`  ✓ ${name}`);
}
console.log(`Evaluation images in ${path.relative(root, out)}/`);
