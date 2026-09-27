# Models and detection

Veil runs three small models entirely in the browser with TensorFlow.js. They are fetched at
build time from pinned sources and verified against fixed digests; the extension never downloads
anything at runtime.

| Model                         | Architecture                    | Input                                               | Output                                              | Size   | License    | Source                                                                                                                                |
| ----------------------------- | ------------------------------- | --------------------------------------------------- | --------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `nsfw-mobilenet-v2-mid`       | MobileNetV2 image classifier    | 224 × 224 RGB, `/255`                               | softmax over _drawing, hentai, neutral, porn, sexy_ | 4.4 MB | MIT        | [NSFWJS](https://github.com/infinitered/nsfwjs) 4.4.0, "mid" graph model                                                              |
| `face-blazeface-back`         | BlazeFace (back-camera variant) | 256 × 256, letterboxed, `[-1, 1]`                   | face boxes and scores (896 anchors, 2 heads)        | 0.6 MB | Apache-2.0 | MediaPipe BlazeFace, TF.js conversion from [@vladmandic/human](https://github.com/vladmandic/human) 3.3.6                             |
| `person-ssdlite-mobilenet-v2` | SSDLite MobileNetV2 (COCO)      | aspect-preserving, long side ≤ 320 px, uint8 pixels | boxes; class 0 (_person_) kept                      | 4.8 MB | Apache-2.0 | TF.js [COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd) SavedModel, weights quantised to uint8 at build time |

`scripts/fetch-models.mjs` normalises each model to `model.json` + `weights-1.bin` and writes
`assets/models/models.json` with the SHA-256 of every file. Release packaging re-checks these
hashes (`scripts/package.mjs`).

## From model outputs to decisions

The worker returns **signals**; the content script's policy engine (`src/policy/engine.ts`) turns
them into a decision. Keeping the two apart means a policy change re-decides a page instantly, with
no second inference.

### Content categories

| Category                                      | Score                      |
| --------------------------------------------- | -------------------------- |
| **Explicit**                                  | `porn`                     |
| **Illustrated** (explicit drawings/animation) | `hentai`                   |
| **Suggestive**                                | `sexy + porn`, capped at 1 |

_Suggestive_ includes the _porn_ probability because the classifier splits borderline images
between the two classes. An image that is 50 % porn and 40 % sexy is certainly suggestive.

An image is protected when any enabled category's score reaches its threshold. In detected ad
slots, thresholds are multiplied by 0.8 (stricter) when _Stricter on advertisements_ is on.

### Animated images

For GIF, animated WebP and APNG, the worker decodes up to 3 frames spread over the animation
(`ImageDecoder`). It takes the **maximum** of the unsafe classes and the **minimum** of the safe
ones, so a single unsafe frame is enough to protect.

### Context-aware scoring

The classifier's most common false positives on _suggestive_ are skin-toned scenes with nobody in
them: fruit, sand, wood, pets. When the person detector has run (that is, _People_ protection is
on) and found neither a person nor a face, the suggestive score is multiplied by 0.8. Scores of
0.9 and above are never damped. _Explicit_ is never damped, because close-up explicit images often
contain no detectable person. The setting is _Context-aware scoring_ (on by default); it has an
effect only while person detection runs.

### Faces and people (region protection)

| Category | Default threshold | Region padding    |
| -------- | ----------------- | ----------------- |
| Faces    | 0.75              | 22 % on each side |
| People   | 0.55              | 6 % on each side  |

Face candidates below 0.5 and person candidates below 0.3 are discarded inside the detectors,
before non-maximum suppression (IoU 0.3 for faces, 0.5 for people). The policy threshold then
applies. On the eval images (see [BENCHMARKS.md](BENCHMARKS.md)), real faces scored 0.85–0.90,
while the false detections on objects scored 0.54–0.63, below the default 0.75.

Each category can protect only the detected **regions**, or the **whole** image when any are found.
Regions are concealed by a worker-rendered copy of the image, so the rest stays visible.

### Why there is no gender filter

Veil deliberately does not infer gender. Classifying gender from appearance is unreliable, with
documented higher error rates for darker-skinned people and systematic misclassification of
trans and non-binary people. It also means inferring a sensitive attribute about everyone
on screen. _Faces_ and _People_ protection cover the underlying need (not seeing people you'd
rather not see) without guessing who anyone is. The provider architecture would technically
allow such a model; including one would be a product decision this project does not make.

## Thresholds and calibration

The shipped thresholds (`src/policy/presets.ts`):

| Level    | Explicit | Illustrated | Suggestive | Fallback |
| -------- | -------- | ----------- | ---------- | -------- |
| Minimal  | 0.80     | 0.85        | off (0.92) | reveal   |
| Balanced | 0.55     | 0.65        | 0.80       | reveal   |
| Strict   | 0.35     | 0.45        | 0.60       | protect  |
| Maximum  | 0.20     | 0.30        | 0.40       | protect  |

**How they were set.** The thresholds are a monotonic ladder: each level lowers every threshold, so
it catches more at the cost of hiding more safe images. They were then **checked against safe
images only**. This project did not download or commit explicit material, so **recall on unsafe
content has not been measured here**. What was measured, on the 15-image safe set in
[BENCHMARKS.md](BENCHMARKS.md):

- Minimal, Balanced and Strict protected none of the 15.
- Maximum protected one: `fruits.jpg` (explicit 0.31, suggestive 0.46), a classic skin-tone false
  positive, and the price of Maximum's low thresholds.

Fifteen images is a smoke test, not a calibration: it bounds the false-positive rate only loosely
(a 95 % interval up to about 20 %). Anyone deploying Veil at scale should calibrate on their own
data.

### `npm run calibrate`

`scripts/calibrate.mjs` runs the **extension's own worker, models and scoring code** in headless
Chromium over a private, labelled folder. It reports what each level would do and suggests
thresholds:

```
my-eval-set/
  safe/          images that should never be protected (required)
  explicit/      \
  illustrated/    } any may be omitted
  suggestive/    /
```

```sh
npm run calibrate -- --data=../my-eval-set --out=calibration.json
npm run calibrate -- --data=../my-eval-set --context   # with person detection + context scoring
npm run calibrate -- --from=calibration.json           # re-analyse saved scores (needs --per-image)
```

For each category it sweeps thresholds from 0.05 to 0.95. At each one it measures the share of
that category's images caught (recall) and the share of **safe** images hidden (false-positive
rate). Images of _other_ unsafe categories are left out of a category's numbers: hiding an explicit
image under _suggestive_ is not an error. The suggested threshold for a level is the lowest whose
false-positive rate stays within that level's budget:

| Level    | Safe images hidden, at most |
| -------- | --------------------------- |
| Minimal  | 0.5 %                       |
| Balanced | 2 %                         |
| Strict   | 5 %                         |
| Maximum  | 10 %                        |

The report shows 95 % Wilson intervals and warns when a set is too small to resolve a budget. For
Balanced's 2 %, aim for several hundred safe images drawn from the kinds of sites you actually
browse. Everything stays local: images are served to the browser over `127.0.0.1` only. The JSON
report holds aggregates only, unless you pass `--per-image`, because file names can be sensitive.

The math lives in `src/policy/calibration.ts`, with unit tests in
`tests/unit/calibration.test.ts`.

## Known model limitations

- **Skin tones and textures:** fruit, sand, wood and close-ups of skin (including medical imagery)
  can score as suggestive or explicit, especially at Strict and Maximum.
- **Swimwear, fitness, fashion and classical art** sit on the suggestive boundary by nature.
  Suggestive is off at Minimal for that reason.
- **Small images** (thumbnails below about 64 px) carry little information. Veil skips media smaller
  than the _Smallest image to check_ setting (default 36 px). Accuracy on thumbnails is lower than on large
  images.
- **Illustrated content** is harder than photos. The _hentai_ class covers explicit drawings, but
  stylised or partial content is less reliable.
- **Faces:** BlazeFace is built for frontal and near-frontal faces. Small, profile, occluded or
  heavily stylised faces may be missed. Cartoon faces and face-like objects are sometimes detected
  (below the default threshold on our samples).
- **Adversarial content:** a determined page can craft images that fool any classifier. See
  [SECURITY.md](SECURITY.md).
- The classifier was trained by its authors on web imagery whose composition this project cannot
  audit. Its errors are not evenly distributed.

## Runtime and backends

TensorFlow.js was chosen because:

- all three models are available as TF.js graph models with permissive licences;
- one runtime covers **WebGPU, WebGL, WASM and CPU**;
- its WASM backend runs under an MV3 extension CSP with only `'wasm-unsafe-eval'`.

Multithreaded WASM is disabled: its workers are created from `blob:` URLs, which the extension CSP
forbids. Only the SIMD and baseline WASM binaries ship. Backend selection and measured timings are
in [ARCHITECTURE.md](ARCHITECTURE.md#engine-lifecycle-and-backends) and
[BENCHMARKS.md](BENCHMARKS.md). ONNX Runtime Web was considered but not benchmarked here, so no
comparison is claimed.

## Replacing or adding a model

Every model sits behind a `ModelProvider` (`src/ml/providers/provider.ts`):

```ts
interface ModelProvider {
  id: string; // folder under assets/models
  signal: 'classifier' | 'faces' | 'people';
  load(ctx): Promise<void>; // from the extension package only
  warmup(): Promise<void>; // compile shaders / JIT off the critical path
  dispose(): void;
}
interface ClassifierProvider extends ModelProvider {
  maxBatch: number;
  classify(images): Promise<ClassifierScores[]>;
}
interface DetectorProvider extends ModelProvider {
  detect(image): Promise<Region[]>;
}
```

To swap the classifier:

1. Add the model to `scripts/fetch-models.mjs` with a pinned URL and digest.
2. Implement a provider that maps its outputs onto `ClassifierScores`.
3. Register it in the engine.
4. Run `npm run calibrate` on a labelled set, and update the presets if the new model's score
   distribution differs.

The deterministic test providers (`src/ml/providers/test-providers.ts`) recognise coloured marker
images. They let the whole pipeline be tested end to end without real content.
