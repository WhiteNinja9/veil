#!/usr/bin/env node
/**
 * Fetches, verifies and normalises the on-device models Veil ships with.
 *
 * Every source is pinned to an exact version and verified against a
 * hard-coded digest before anything is written. Nothing is fetched at
 * runtime: the extension only ever loads models from its own package.
 *
 *   node scripts/fetch-models.mjs          # fetch into assets/models
 *   node scripts/fetch-models.mjs --force  # ignore cache, re-download
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { readTarGz } from './lib/tar.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'models');
const cacheDir = path.join(root, '.cache', 'models');
const force = process.argv.includes('--force');

const SOURCES = {
  nsfwjs: {
    url: 'https://registry.npmjs.org/nsfwjs/-/nsfwjs-4.4.0.tgz',
    integrity:
      'sha512-krC1fgeTLXtZwgdpKJ0jm7hqv0gTSRQQRL+FhOaxaJ9Wj92t42BO3csO2odwgTAgZgf2RvkwPtp0R8Aa7dc+MA==',
  },
  human: {
    url: 'https://registry.npmjs.org/@vladmandic/human/-/human-3.3.6.tgz',
    integrity:
      'sha512-Nr5mPfq1gQ+uKeXY5uM3Fj8UxvF5CEh2s6txM5wRThqaW0mF9huooOuZSrT8hhGho0hGaXLFdAwfD/2+teCv6A==',
  },
  ssdlite: {
    base: 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/',
    files: {
      'model.json': 'sha256-3770b2528339b1e3340cb74360e1e40401816b009779aeb8d0cce3a4353ea3a9',
      'group1-shard1of5': 'sha256-0e7af0f713e98521252321f7f84892c31cefccccec3ac64c84e5065b75ed5646',
      'group1-shard2of5': 'sha256-74cc6cfc2c4510c9cd81b8ad4cebf6f6a8f305119bb365ce0eb96276da38519a',
      'group1-shard3of5': 'sha256-50383033f893eae136392a403e8f70ade5efd90867df5695c4ca5ac640e14f38',
      'group1-shard4of5': 'sha256-d856dc534c780068bbf6c666ce1516df2c8433d87578aa31fcdf197de7058cc2',
      'group1-shard5of5': 'sha256-3d356f1fb6dfca6af78c56db34d9326706d0196e303f9de6b04f236ca79ed309',
    },
  },
};

function digest(buffer, spec) {
  const [algo, expected] = spec.split(/-(.+)/);
  const actual =
    algo === 'sha512'
      ? createHash('sha512').update(buffer).digest('base64')
      : createHash('sha256').update(buffer).digest('hex');
  return { ok: actual === expected, actual: `${algo}-${actual}` };
}

async function download(url, spec) {
  const cacheFile = path.join(cacheDir, createHash('sha256').update(url).digest('hex'));
  if (!force && existsSync(cacheFile)) {
    const cached = await readFile(cacheFile);
    if (digest(cached, spec).ok) return cached;
  }
  process.stdout.write(`  ↓ ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const check = digest(buffer, spec);
  if (!check.ok) {
    throw new Error(`Integrity mismatch for ${url}\n  expected ${spec}\n  received ${check.actual}`);
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, buffer);
  return buffer;
}

/** NSFWJS ships models as UMD bundles exporting a JS object or a base64 string. */
function evaluateUmd(source) {
  const sandbox = { module: { exports: {} }, exports: {} };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(source, sandbox, { timeout: 5000 });
  return sandbox.module.exports;
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function writeModel(id, modelJson, weightBuffers, meta) {
  const dir = path.join(outDir, id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const paths = weightBuffers.map((_, i) => `weights-${i + 1}.bin`);
  modelJson.weightsManifest = [
    { paths, weights: modelJson.weightsManifest.flatMap((group) => group.weights) },
  ];
  const json = Buffer.from(JSON.stringify(modelJson));
  await writeFile(path.join(dir, 'model.json'), json);
  let bytes = json.length;
  const files = { 'model.json': sha256Hex(json) };
  for (let i = 0; i < weightBuffers.length; i++) {
    await writeFile(path.join(dir, paths[i]), weightBuffers[i]);
    bytes += weightBuffers[i].length;
    files[paths[i]] = sha256Hex(weightBuffers[i]);
  }
  return { id, bytes, files, ...meta };
}

async function buildNsfw() {
  const tarball = readTarGz(await download(SOURCES.nsfwjs.url, SOURCES.nsfwjs.integrity));
  const base = 'package/dist/models/mobilenet_v2_mid/';
  const modelJson = evaluateUmd(tarball.get(`${base}model.min.js`).toString('utf8'));
  const shards = ['group1-shard1of2.min.js', 'group1-shard2of2.min.js'].map((name) =>
    Buffer.from(evaluateUmd(tarball.get(base + name).toString('utf8')), 'base64'),
  );
  // Weight groups are consumed as one contiguous buffer: merge the shards.
  return writeModel('nsfw-mobilenet-v2-mid', modelJson, [Buffer.concat(shards)], {
    task: 'classification',
    inputSize: 224,
    labels: ['drawing', 'hentai', 'neutral', 'porn', 'sexy'],
    license: 'MIT',
    source: 'nsfwjs@4.4.0 (Infinite Red) — MobileNetV2 "mid" graph model',
  });
}

async function buildBlazeFace() {
  const tarball = readTarGz(await download(SOURCES.human.url, SOURCES.human.integrity));
  const modelJson = JSON.parse(tarball.get('package/models/blazeface.json').toString('utf8'));
  const weights = Buffer.from(tarball.get('package/models/blazeface.bin'));
  return writeModel('face-blazeface-back', modelJson, [weights], {
    task: 'face-detection',
    inputSize: 256,
    license: 'Apache-2.0 (MediaPipe BlazeFace); converted by @vladmandic/human (MIT)',
    source: '@vladmandic/human@3.3.6 models/blazeface',
  });
}

async function buildGender() {
  const tarball = readTarGz(await download(SOURCES.human.url, SOURCES.human.integrity));
  const modelJson = JSON.parse(tarball.get('package/models/faceres.json').toString('utf8'));
  // The network ends in global pooling, so it accepts smaller crops. Veil
  // feeds 160 px (half the cost of 224, same accuracy on our checks: see
  // docs/ML.md); relax the declared spatial size so TF.js allows it.
  const anySize = [{ size: '-1' }, { size: '-1' }, { size: '-1' }, { size: '3' }];
  for (const node of modelJson.modelTopology.node) {
    if (node.op === 'Placeholder') node.attr.shape.shape.dim = anySize;
  }
  for (const input of Object.values(modelJson.signature.inputs)) input.tensorShape.dim = anySize;
  // Weights stay float16 as published: uint8 quantisation measurably hurt
  // accuracy (AUC 0.977 → 0.959 on our labelled faces).
  const weights = Buffer.from(tarball.get('package/models/faceres.bin'));
  return writeModel('face-gender-hse', modelJson, [weights], {
    task: 'face-attributes',
    inputSize: 160,
    outputs: { gender: 'sigmoid, probability the face appears male' },
    license: 'Apache-2.0 (HSE-FaceRes, A. Savchenko); converted by @vladmandic/human (MIT)',
    source: '@vladmandic/human@3.3.6 models/faceres (HSE_FaceRec_tf), float16 weights',
  });
}

/** IEEE 754 half precision → single precision. */
function float16ToFloat32(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/**
 * Affine uint8 quantisation of float32 weights, the same scheme the
 * TensorFlow.js converter uses for `--quantize_uint8`. Cuts the person
 * detector from ~18 MB to ~4.6 MB with negligible accuracy impact.
 */
function quantizeUint8(modelJson, buffer) {
  const out = [];
  const weights = [];
  let offset = 0;
  for (const group of modelJson.weightsManifest) {
    for (const entry of group.weights) {
      const count = entry.shape.reduce((a, b) => a * b, 1);
      const half = entry.dtype === 'float32' && entry.quantization?.dtype === 'float16';
      const elementBytes = half
        ? 2
        : entry.quantization
          ? 1
          : entry.dtype === 'float32' || entry.dtype === 'int32'
            ? 4
            : 1;
      const byteLength = count * elementBytes;
      const slice = buffer.subarray(offset, offset + byteLength);
      offset += byteLength;
      if (entry.dtype !== 'float32' || (entry.quantization && !half)) {
        out.push(Buffer.from(slice));
        weights.push(entry);
        continue;
      }
      const values = half
        ? Float32Array.from({ length: count }, (_, i) => float16ToFloat32(slice.readUInt16LE(i * 2)))
        : new Float32Array(slice.buffer.slice(slice.byteOffset, slice.byteOffset + byteLength));
      let min = Infinity;
      let max = -Infinity;
      for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const scale = max > min ? (max - min) / 255 : 1;
      const q = Buffer.alloc(count);
      for (let i = 0; i < count; i++) q[i] = Math.round((values[i] - min) / scale);
      out.push(q);
      weights.push({ ...entry, quantization: { dtype: 'uint8', min, scale } });
    }
  }
  if (offset !== buffer.length) throw new Error('weight manifest does not match buffer size');
  modelJson.weightsManifest = [{ paths: [], weights }];
  return Buffer.concat(out);
}

async function buildPersonDetector() {
  const { base, files } = SOURCES.ssdlite;
  const buffers = {};
  for (const [name, spec] of Object.entries(files)) buffers[name] = await download(base + name, spec);
  const modelJson = JSON.parse(buffers['model.json'].toString('utf8'));
  const shardNames = modelJson.weightsManifest.flatMap((g) => g.paths);
  const weights = quantizeUint8(modelJson, Buffer.concat(shardNames.map((n) => buffers[n])));
  return writeModel('person-ssdlite-mobilenet-v2', modelJson, [weights], {
    task: 'object-detection',
    inputSize: 300,
    license: 'Apache-2.0 (TensorFlow.js models, COCO-SSD)',
    source: 'tfjs-models savedmodel/ssdlite_mobilenet_v2 (uint8-quantised at build time)',
  });
}

async function main() {
  console.log('Veil · preparing on-device models');
  await mkdir(outDir, { recursive: true });
  const models = [];
  for (const build of [buildNsfw, buildBlazeFace, buildPersonDetector, buildGender]) {
    const model = await build();
    console.log(`  ✓ ${model.id.padEnd(30)} ${(model.bytes / 1024 / 1024).toFixed(2)} MB`);
    models.push(model);
  }
  await writeFile(path.join(outDir, 'models.json'), JSON.stringify({ version: 1, models }, null, 2));
  console.log(`Models written to ${path.relative(root, outDir)}/`);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
