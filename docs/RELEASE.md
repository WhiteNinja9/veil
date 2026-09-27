# Setup, build and release

## Requirements

- Node.js **20 or newer** (CI uses 22) and npm
- Network access once, to fetch the pinned models
- Chrome/Chromium 116+ and/or Firefox 140+ for manual testing

## First-time setup

```sh
npm ci                                 # exact dependency versions from the lockfile
npm run models                         # fetch and verify models → assets/models (≈ 10 MB, not committed)
node scripts/fetch-eval-images.mjs     # optional: safe sample photos for real-model tests/benchmarks
npx playwright install chromium        # only if Playwright's Chromium is not already installed
```

`npm run models` downloads from the npm registry and Google's TF.js model storage. It verifies every
file against a hard-coded digest and fails loudly on any mismatch. Downloads are cached in
`.cache/models`.

## Development

```sh
npm run dev              # Chrome, development build with source maps, rebuilds on change → dist/chrome
npm run dev:firefox      # the same for Firefox → dist/firefox
npm run lab              # compatibility lab at http://127.0.0.1:4700
```

Load the unpacked build:

- **Chrome:** `chrome://extensions` → _Developer mode_ → _Load unpacked_ → `dist/chrome`. After a
  rebuild, click the reload icon on Veil's card.
- **Firefox:** `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on_ →
  `dist/firefox/manifest.json`, or run `npx web-ext run --source-dir dist/firefox`.

Development builds are named **Veil (Dev)**. They keep the in-page chip's shadow root open for
inspection and enable debug logging (`__DEV__`). Production builds strip both.

### Build flags

`node scripts/build.mjs [flags]`

| Flag                             | Effect                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| `--target=chrome\|firefox\|all`  | Browser bundle(s)                                             |
| `--mode=production\|development` | Minification, source maps, dev logging                        |
| `--watch`                        | Rebuild on change                                             |
| `--test-model`                   | Swap the real models for deterministic marker detectors (E2E) |
| `--out=<dir>`                    | Output directory (single target)                              |

## Quality gates

```sh
npm run check            # typecheck + ESLint + unit/integration tests
npm run format:check     # Prettier
npm run test:e2e         # Playwright (builds test-model and production bundles first)
npm run lint:firefox     # addons-linter on dist/firefox (expect 0 errors, 1 known warning)
```

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request, and uploads the
packaged archives as a build artifact.

## Packaging

```sh
npm run package
```

This builds both browsers in production mode, **verifies** each build, and writes to `artifacts/`:

| File                         | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `veil-chrome-<version>.zip`  | Chrome Web Store upload                                                     |
| `veil-firefox-<version>.zip` | addons.mozilla.org upload                                                   |
| `veil-source-<version>.zip`  | Source code for store review (models excluded, fetched by `npm run models`) |
| `SHA256SUMS`                 | Checksums of the three archives                                             |

Packaging refuses to produce archives when:

- the manifest version doesn't match `package.json`;
- any file is a source map, TypeScript source or dotfile;
- any shipped JS or HTML contains `eval(`, `new Function(` or a `sourceMappingURL`;
- models are missing (for example, from a `--test-model` build) or any model file's hash differs
  from `models.json`;
- the Firefox manifest contains Chrome-only permissions.

Archives are **reproducible**: entries are sorted, timestamps fixed (`SOURCE_DATE_EPOCH`, default
1980-01-01) and permissions normalised. Two runs on the same inputs produce identical bytes.
`npm run package -- --skip-build` re-packages existing `dist/` output.

## Releasing

1. **Version.** Bump `version` in `package.json` (semver). The manifest version is derived from it.
2. **Changelog.** Note user-visible changes. Call out anything touching permissions, data handling
   ([PRIVACY.md](PRIVACY.md)) or default thresholds.
3. **Gates.** Run `npm ci && npm run models && npm run check && npm run test:e2e && npm run lint:firefox`.
4. **Manual pass** from [TESTING.md](TESTING.md#firefox) on Firefox, plus a quick real-site
   spot-check on Chrome. Do a keyboard-only walk-through of the popup, settings and onboarding. Check
   Arabic layout (`node scripts/screenshots.mjs` renders every page in light, dark and Arabic).
5. **Package** with `npm run package`, and keep `SHA256SUMS`.
6. **Tag** as `git tag v<version> && git push --tags`.

### Chrome Web Store

- Upload `veil-chrome-<version>.zip` in the developer dashboard.
- **Privacy practices:** _single purpose_: "Hides images and videos matching the user's filter
  settings before they are displayed, using on-device models." Declare **no** data collection.
  Justify each permission from [PERMISSIONS.md](PERMISSIONS.md). `<all_urls>` is required to protect
  pages before they paint.
- **Remote code:** declare _No_. Models and WASM are packaged.

### addons.mozilla.org

- Upload `veil-firefox-<version>.zip`. The manifest declares
  `data_collection_permissions: { required: ["none"] }`.
- Bundled and minified code requires **source code submission**: upload
  `veil-source-<version>.zip` with these reviewer notes:

  ```
  Build: Node 22, then `npm ci && npm run models && npm run build:firefox`.
  Output: dist/firefox. Models are fetched from pinned URLs and verified by
  SHA-512/SHA-256 in scripts/fetch-models.mjs.
  Third-party: TensorFlow.js 4.22.0 (bundled in engine-worker.js), Preact 10.29.8.
  addons-linter reports one UNSAFE_VAR_ASSIGNMENT warning inside Preact's DOM
  diffing (the dangerouslySetInnerHTML path); Veil never uses it and ESLint
  forbids it in src/.
  'wasm-unsafe-eval' is required to instantiate the bundled TF.js WASM kernels.
  ```

- For self-distribution (unlisted), sign with `npx web-ext sign --channel=unlisted` using AMO API
  credentials.

### Rolling back

Both stores keep previous versions; re-upload the previous archive with a **higher** version number
(stores reject downgrades). Settings migrate forward only (`src/storage/schema.ts`), so a rollback
build must not predate a settings schema change.

## Updating models

1. Change the pinned URL and digest in `scripts/fetch-models.mjs`, and adapt the provider if the
   outputs changed.
2. `npm run models -- --force`, then `npm run test:e2e` (the real-model tests catch loading and
   output-shape problems).
3. Re-calibrate thresholds with `npm run calibrate` on a labelled set ([ML.md](ML.md)), and update
   [BENCHMARKS.md](BENCHMARKS.md) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
