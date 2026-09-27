# Benchmarks

Every number on this page was measured with the scripts in this repository. The conditions are
listed with each table. The numbers describe **one machine without a GPU**: treat them as a floor
and as a way to compare backends, not as what your computer will do. Re-run the scripts on your
hardware before quoting anything.

## Test machine

|         |                                           |
| ------- | ----------------------------------------- |
| CPU     | Intel Xeon @ 2.80 GHz, 4 cores (cloud VM) |
| Memory  | 16 GB                                     |
| GPU     | none (software rasterisers only)          |
| Browser | Chromium 141.0.7390.37, headless          |
| OS      | Linux 6.18                                |
| Date    | September 2026                            |

Because the machine has no GPU, the hardware WebGPU and WebGL paths, which most desktops and
laptops would use, **were not measured**. Only software emulations of them were.

## 1. Classifier inference per backend

`npm run bench -- --csp` builds the shipped worker and serves it under the extension's CSP. It then
times the content classifier (MobileNetV2, 224 × 224), 10 iterations after warm-up.

| Backend                        | Init   | Model load | First inference | Median    | Batch of 4, per image |
| ------------------------------ | ------ | ---------- | --------------- | --------- | --------------------- |
| **WASM SIMD**                  | 22 ms  | 97 ms      | 169 ms          | **94 ms** | 91 ms                 |
| CPU (plain JS)                 | 3 ms   | 99 ms      | 2,628 ms        | 2,573 ms  | 2,489 ms              |
| WebGL, SwiftShader (software)  | 408 ms | 135 ms     | 4,865 ms        | 570 ms    | 1,377 ms              |
| WebGPU, SwiftShader (software) | 244 ms | 90 ms      | 16,103 ms       | 2,879 ms  | 4,680 ms              |

The software rows come from `npm run bench -- --webgpu --swiftshader` and exercise those code paths
without a GPU. They are **not** GPU timings. Across runs, the WASM median ranged from 84 to 94 ms.

What this shows, and what Veil does about it:

- **Software GPU backends are far slower than WASM:** 6× for WebGL and 31× for WebGPU here. Veil
  therefore defers them behind WASM automatically (`src/ml/backend.ts`), and the unit tests pin
  that ordering (`tests/unit/backend.test.ts`).
- **Batching doesn't help CPU-bound backends:** 91 vs 94 ms per image. It only delays results. Veil
  batches on WebGL and WebGPU only; on WASM and CPU each image is analysed and returned in turn.
- **Plain-JS CPU is about 27× slower than WASM SIMD.** It is the last resort only.

## 2. Full pipeline per image

Same harness; all three models (classifier, face detector, person detector) on the 15 eval images
(`node scripts/fetch-eval-images.mjs`), WASM backend, second pass (warm):

| Metric                      | Value  |
| --------------------------- | ------ |
| Median wall-clock per image | 277 ms |
| p95                         | 340 ms |

This is the cost with _Faces_ and _People_ protection **both** on. With the default settings
(classifier only), analysis is the classifier row above plus decode.

## 3. Time-to-verdict in the extension

`node scripts/bench/latency.mjs --runs=5` loads the production extension (real models) in Chromium
and opens a page of 15 photos, 324 × 223 to 1280 × 1024 pixels. It records when each image receives
its verdict, measured **from navigation start**. Until then the image is hidden and its layout space
is reserved. Default settings (Balanced, classifier only), WASM backend, 5 runs × 15 images:

| Scenario                                                                                       | First image | Median image | p95      | Slowest  |
| ---------------------------------------------------------------------------------------------- | ----------- | ------------ | -------- | -------- |
| **Cold**: first page after browser start, including offscreen document, backend and model load | 710 ms      | 1,478 ms     | 2,231 ms | 2,534 ms |
| **Warm**: engine loaded, nothing cached                                                        | 276 ms      | 990 ms       | 1,677 ms | 1,823 ms |
| **Cached**: page seen before (in-memory results)                                               | 58 ms       | 76 ms        | 99 ms    | 100 ms   |

On this 4-core machine, a page's images are decided at roughly 90 ms each, with visible images
first. A laptop with a GPU running WebGL or WebGPU should be substantially faster, but that was not
measured here.

Two optimisations came out of these measurements:

| Change                            | Before                     | After                           |
| --------------------------------- | -------------------------- | ------------------------------- |
| Cache probe before pixel capture  | cached median ≈ 150–280 ms | **76 ms**                       |
| No batching on CPU-bound backends | warm median 1,329 ms       | **990 ms** (first image 276 ms) |

## 4. Accuracy smoke test (safe images only)

On the same 15 safe photos:

| Level    | Safe images protected                                 |
| -------- | ----------------------------------------------------- |
| Minimal  | 0 / 15                                                |
| Balanced | 0 / 15                                                |
| Strict   | 0 / 15                                                |
| Maximum  | 1 / 15 (`fruits.jpg`: explicit 0.31, suggestive 0.46) |

Fifteen images bound the false-positive rate only loosely (95 % upper bound ≈ 20 %), and **recall on
unsafe content was not measured**. See [ML.md](ML.md#thresholds-and-calibration) for why, and for
how to calibrate on your own data with `npm run calibrate`.

Face detector scores on the same images: real faces 0.85–0.90; false detections on objects
0.54–0.63, all below the default threshold of 0.75.

## 5. Package size

Production Chrome build (`npm run build:chrome`):

| File                                   | Size           | gzip    |
| -------------------------------------- | -------------- | ------- |
| `content.js` (runs in every frame)     | 72.5 KB        | 23.8 KB |
| `content.css`                          | 3.3 KB         | 1.0 KB  |
| `background.js`                        | 23.6 KB        | 8.5 KB  |
| `engine-worker.js` (TF.js + providers) | 1.24 MB        | 305 KB  |
| Models (3)                             | 9.4 MB         | —       |
| WASM kernels (SIMD + baseline)         | 724 KB         | —       |
| **Store upload** (`npm run package`)   | **7.2 MB** zip |         |

The engine worker and models load only in the offscreen document (Chrome) or background page
(Firefox), never in web pages. `content.js` is all first-party code, with no ML runtime.

## Reproducing

```sh
npm ci
npm run models                         # fetch and verify models
node scripts/fetch-eval-images.mjs     # safe sample photos → .cache/eval
npm run bench -- --csp                 # §1, §2  (add --webgpu --swiftshader for software GPU paths)
npm run build:chrome
node scripts/bench/latency.mjs --runs=5   # §3
npm run test:e2e                       # includes the real-model smoke tests (§4)
```

`npm run bench -- --out=bench-results/local/<name>.json` saves a machine-readable report.
`bench-results/local/` is ignored by git.
