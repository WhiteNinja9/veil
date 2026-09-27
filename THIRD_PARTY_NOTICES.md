# Third-party notices

Veil's distributed packages include the following third-party software, models and fonts. Each
is used under its licence, summarised here. Full licence texts are linked, and per-file licence
headers extracted at build time ship next to the bundles (`*.LEGAL.txt`).

Veil's own code, visual identity, icons and copy are original. No code, assets or text from other
content-filtering extensions are used.

## Runtime libraries

| Component                                                                                                                                                                | Version                              | Licence                                                                | Copyright                            | Used for                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------ | --------------------------- |
| [Preact](https://github.com/preactjs/preact)                                                                                                                             | 10.29.8                              | [MIT](https://github.com/preactjs/preact/blob/main/LICENSE)            | © 2015–present Jason Miller          | Extension page UI           |
| [TensorFlow.js](https://github.com/tensorflow/tfjs): `tfjs-core`, `tfjs-converter`, `tfjs-backend-cpu`, `tfjs-backend-webgl`, `tfjs-backend-webgpu`, `tfjs-backend-wasm` | 4.22.0                               | [Apache-2.0](https://github.com/tensorflow/tfjs/blob/master/LICENSE)   | © Google LLC, The TensorFlow Authors | On-device inference         |
| [XNNPACK](https://github.com/google/XNNPACK) (compiled into the TF.js WASM kernels)                                                                                      | as built by tfjs-backend-wasm 4.22.0 | [BSD-3-Clause](https://github.com/google/XNNPACK/blob/master/LICENSE)  | © Facebook, Inc. and Google LLC      | WASM neural-network kernels |
| [Emscripten](https://github.com/emscripten-core/emscripten) runtime (in the WASM kernels)                                                                                | as built by tfjs-backend-wasm 4.22.0 | [MIT](https://github.com/emscripten-core/emscripten/blob/main/LICENSE) | © Emscripten authors                 | WASM runtime glue           |
| [long.js](https://github.com/dcodeIO/long.js) (TF.js dependency)                                                                                                         | 4.0.0                                | [Apache-2.0](https://github.com/dcodeIO/long.js/blob/master/LICENSE)   | © Daniel Wirtz                       | 64-bit integer support      |

## Font

| Component                                                               | Version | Licence                                                                            | Copyright                        |
| ----------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| [Inter](https://github.com/rsms/inter) via `@fontsource-variable/inter` | 5.3.0   | [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt) | © 2016 The Inter Project Authors |

## Models

| Model                                                                                                                                 | Licence                                                                            | Copyright / origin                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NSFW classifier, MobileNetV2 "mid" (from [NSFWJS](https://github.com/infinitered/nsfwjs) 4.4.0)                                       | [MIT](https://github.com/infinitered/nsfwjs/blob/master/LICENSE)                   | © 2019 Infinite Red, Inc.                                                                                                                                                                              |
| BlazeFace face detector, back-camera variant ([MediaPipe](https://github.com/google-ai-edge/mediapipe))                               | [Apache-2.0](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)      | © Google LLC                                                                                                                                                                                           |
| TF.js conversion of BlazeFace (from [@vladmandic/human](https://github.com/vladmandic/human) 3.3.6)                                   | [MIT](https://github.com/vladmandic/human/blob/main/LICENSE)                       | © 2020 Vladimir Mandic                                                                                                                                                                                 |
| SSDLite MobileNetV2 (COCO) person detector ([TF.js models, COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd)) | [Apache-2.0](https://github.com/tensorflow/tfjs-models/blob/master/LICENSE)        | © Google LLC. Weights quantised to uint8 by Veil's build script.                                                                                                                                       |
| HSE-FaceRes face-attribute model, gender head used ([HSE_FaceRec_tf](https://github.com/HSE-asavchenko/HSE_FaceRec_tf))               | [Apache-2.0](https://github.com/HSE-asavchenko/HSE_FaceRec_tf/blob/master/LICENSE) | © Andrey Savchenko. TF.js conversion from [@vladmandic/human](https://github.com/vladmandic/human) 3.3.6 (MIT, © 2020 Vladimir Mandic). Input shape relaxed by Veil's build script; weights unchanged. |

Changes made to the models by Veil's build (`scripts/fetch-models.mjs`): repackaging into a single
weights file, uint8 weight quantisation for the person detector, and a relaxed input shape for the
face-attribute model (so it accepts 160 px crops). The model architectures and
learned parameters are otherwise unmodified.

## Development-only tools

Build and test tools (esbuild, TypeScript, Vitest, Playwright, ESLint, Prettier, web-ext, axe-core,
jsdom, jpeg-js) are not included in the distributed packages. Their licences are
in `node_modules/*/LICENSE` after `npm ci`.
