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
  ...[
    'messi5.jpg',
    'fruits.jpg',
    'baboon.jpg',
    'starry_night.jpg',
    'building.jpg',
    'home.jpg',
    'graf1.png',
    'box.png',
    'pic1.png',
    'smarties.png',
    'orange.jpg',
    'apple.jpg',
    'butterfly.jpg',
  ].map((f) => [SAMPLES + f, f]),
  ...['class57.png', 'karen-and-rob.png'].map((f) => [CASCADE + f, f]),
  // People photos for the apparent-gender check (scripts/bench/people.mjs).
  ...['mona-lisa.png', 'audrybt1.png', 'addams-family.png', 'karen-and-rob.png', 'class57.png'].map((f) => [
    CASCADE + f,
    `people/${f}`,
  ]),
  ...['messi5.jpg', 'basketball1.png'].map((f) => [SAMPLES + f, `people/${f}`]),
  [
    'https://raw.githubusercontent.com/tensorflow/tensorflow/master/tensorflow/examples/label_image/data/grace_hopper.jpg',
    'people/grace-hopper.jpg',
  ],
  ...['biden.jpg', 'obama.jpg', 'two_people.jpg'].map((f) => [
    `https://raw.githubusercontent.com/ageitgey/face_recognition/master/examples/${f}`,
    `people/${f.replace('_', '-')}`,
  ]),
  ...[
    '2008_002470',
    '2009_004587',
    '2008_001322',
    '2008_001009',
    '2008_004176',
    '2007_007763',
    'bald_guys',
  ].map((f) => [
    `https://raw.githubusercontent.com/davisking/dlib/master/examples/faces/${f}.jpg`,
    `people/${f.startsWith('20') ? `voc-${f.replace('_', '-')}` : f.replace('_', '-')}.jpg`,
  ]),
];

await mkdir(path.join(out, 'people'), { recursive: true });
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
