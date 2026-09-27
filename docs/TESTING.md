# Testing

| Layer             | Tool                                | Where                  | Runs in                         |
| ----------------- | ----------------------------------- | ---------------------- | ------------------------------- |
| Unit              | Vitest                              | `tests/unit`           | Node                            |
| Integration       | Vitest + jsdom                      | `tests/integration`    | Node                            |
| End-to-end        | Playwright + the unpacked extension | `tests/e2e`            | Headless Chromium               |
| Accessibility     | axe-core inside E2E                 | `tests/e2e/ui.spec.ts` | Headless Chromium               |
| Compatibility lab | Local two-origin test site          | `lab/`                 | Any browser, by hand or via E2E |
| Performance       | Benchmark scripts                   | `scripts/bench`        | Headless Chromium               |

```sh
npm run check        # typecheck (src + tests) → ESLint → unit + integration
npm run test:e2e     # builds the test-model and production bundles, then runs Playwright
npm run test:watch   # Vitest in watch mode
npx vitest run --coverage
```

At the time of writing: 20 Vitest files with 162 tests, and 55 Playwright tests (52 with the test
model, 3 with the real models). All pass on Chromium 141.

## Unit and integration

The pure core is tested exhaustively, because everything else rests on it:

- **Policy:** `policy`, `resolve` and `calibration` cover presets, thresholds, context damping, ad
  factor, region padding, resolver precedence (site levels, pauses, Strict Browsing floors) and the
  calibration math.
- **Security:** `validate`, `lock` and `weakening` cover message validation, PBKDF2 verifier,
  lockout back-off, and which changes need the passcode (including site-rule edge cases).
- **Storage:** `schema` and `settings-store` cover field-level sanitisation, migrations, the managed
  policy overlay and its mirror, and never blocking on `storage.managed`.
- **Sites and network rules:** `rules` and `dnr` cover pattern parsing and specificity, RE2-safe
  regexes, the rule-ID layout, SafeSearch rules, and expiry scheduling for temporary rules.
- **Engine:** `backend`, `postprocess` and `engine-service` cover backend order (software GPU
  deferral, CPU last), batch sizing, NMS and anchor decoding, frame aggregation, the cache,
  de-duplication and the cache-only probe.
- **Content:** `scanner` and `scheduler` (jsdom) cover discovery of inserted, attribute-changed and
  shadow-root media, and priority ordering and concurrency limits.
- **Fetch guard:** `fetch-media` covers schemes, credentials, private-network rules, size and
  timeout.
- **UI and i18n:** `ui-model` and `i18n` cover popup state derivation, plural rules (Arabic six
  forms), French spacing, and catalogue completeness across `en`, `ar` and `fr`.

`tests/helpers/chrome-mock.ts` provides an in-memory `storage.local`/`session`/`managed` and
`runtime` with change events.

## End-to-end

Playwright launches Chromium with the **unpacked extension** (`--load-extension`). Two projects:

- **`chromium-test-model`** uses `dist/chrome-test` (`npm run build:test`). Models are replaced by
  deterministic providers that recognise coloured **marker images** from the lab:

  | Marker  | Meaning                     |
  | ------- | --------------------------- |
  | magenta | explicit                    |
  | cyan    | illustrated                 |
  | orange  | suggestive                  |
  | yellow  | borderline (between levels) |
  | green   | contains a face             |
  | teal    | a face that appears female  |
  | blue    | a face that appears male    |

  This exercises the whole pipeline (gate, discovery, capture, messaging, policy, rendering,
  reveal, DNR) with exact, reproducible verdicts, and without any real sensitive content in the
  repository.

- **`chromium-real-model`** uses the production build `dist/chrome` with the real models, on safe
  sample photos (`node scripts/fetch-eval-images.mjs`). It checks that model loading, backend
  selection and inference work, that no safe photo is protected at Balanced, and that face
  protection blurs only face regions. With the people filter set to men, it checks that real men's
  faces are blurred and a photo without people is not. It is skipped when models or images are
  missing. Accuracy of the people filter is measured separately by `node scripts/bench/people.mjs`
  ([ML.md](ML.md#people-filter-women-men-or-everyone)).

What the E2E suite covers (`tests/e2e/*.spec.ts`):

- **No flash:** a sampler reads every animation frame while pages load and fails if any unsafe
  marker pixel is ever painted. The gate is released at once on sites where protection is off.
- **Discovery:** static, lazy (native and scripted), `srcset`/`<picture>`/swapped sources,
  inline backgrounds, `data:` thumbnails, ad slots, infinite feeds, virtualised SPA lists that
  recycle nodes, open/closed/late shadow roots, cross-origin iframes, and 600 thumbnails with
  visible-first ordering.
- **Video:** protection when content turns unsafe (and not before), CORS-readable cross-origin
  video, the fallback for unreadable frames, and auto-restore after safe frames.
- **Policy:** instant re-decision on level change, style changes, off state, face regions, and
  media-type exclusions.
- **Reveal:** click, hold, hover, confirmation, disabled, keyboard shortcut and context menu.
- **Sites:** block before load, warn with timed continue, crafted-interstitial bypass attempts,
  and Strict Browsing rules installed and removed.
- **UI:** popup status and pause, level change, settings search and deep links, the lock
  (weakening only), onboarding, the interstitial, and **axe** checks (no serious or critical
  violations) on every page in English and Arabic.
- **People filter:** women only and men only (same- and cross-origin), the unsure setting, whole
  image vs regions, instant re-decision when the choice changes, and hiding a whole video while a
  matching face is on screen (scope _whole image_). The test gender model reads the colour of the
  actual face crop, so the cropping path is covered.
- **People in video** (`video-regions.spec.ts`, lab _pair_ clip): only the woman is blurred and the
  blur follows her as she walks; only the man with _men_; the painted box is opaque and has no
  sharp edges while the frame under it does (pixel check); a paused video's blur stays still and a
  seek re-checks the new frame; reveal removes the blur and hide restores it.
- **Regressions:** the offscreen-listener start-up race, and re-verification when an image's
  source changes.

## Compatibility lab

```sh
npm run lab     # http://127.0.0.1:4700  (second origin: http://localhost:4701)
```

| Page                     | Exercises                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Static images            | Baseline: every marker at several sizes                                                                                        |
| Lazy-loaded images       | `loading="lazy"` and JS lazy loaders (`data-src` swaps)                                                                        |
| srcset and `<picture>`   | Responsive sources, art direction, runtime `src` swaps                                                                         |
| Inline background images | `style="background-image: url(…)"`, gradients with images                                                                      |
| Infinite feed            | Cards appended on scroll (sentinel observer)                                                                                   |
| SPA with recycled nodes  | A virtual list that reuses `<img>` nodes with new sources                                                                      |
| Shadow DOM               | Open, closed and late-attached shadow roots                                                                                    |
| Cross-origin iframe      | Media in a frame from the second origin                                                                                        |
| Advertisement slots      | Ad-like containers (stricter thresholds)                                                                                       |
| Video                    | Generated WebM clips that switch from safe to unsafe, same- and cross-origin                                                   |
| People filter            | Faces that appear female, male or undecided (images and video), same- and cross-origin; a clip with a woman walking past a man |
| Search results           | Base64 `data:` thumbnails like image search results                                                                            |
| Stress                   | 600 thumbnails: priority, concurrency, memory                                                                                  |

Marker images come from `/img/<marker>/<w>x<h>.png` and videos from `/video/*.webm`. Both are
generated on the fly (`lab/png.mjs`, with ffmpeg from Playwright for video). No binary fixtures are
committed.

## Firefox

Playwright cannot load WebExtensions into Firefox, so the Firefox build is verified by linting and
by hand:

```sh
npm run build:firefox
npm run lint:firefox          # addons-linter: expect 0 errors, 1 warning (below)
npx web-ext run --source-dir dist/firefox --firefox=firefoxdeveloperedition   # or your Firefox 140+
```

The single warning is `UNSAFE_VAR_ASSIGNMENT` in a shared UI chunk. It is Preact's own DOM
diffing code, which assigns `innerHTML` only to support `dangerouslySetInnerHTML`. Veil never uses
that, and ESLint forbids it in `src/`. AMO reviewers see the same warning; mention it in the review
notes.

**Manual pass** (about 15 minutes, with the lab running):

1. Install via `about:debugging` → _Load Temporary Add-on_ → `dist/firefox/manifest.json`, or with
   `web-ext run`. Onboarding opens; finish it at Balanced.
2. Open each lab page and confirm that unsafe markers never appear, even briefly while scrolling
   quickly.
3. **Popup:** status, counters, pause for 15 minutes and resume, level change.
4. **Reveal** a protected image with click, then switch to hold in Settings and repeat.
5. **Settings → Sites:** block `localhost`. Opening `http://localhost:4701/` shows the interstitial.
   Change the rule to _warn_ and use _Continue for 15 minutes_.
6. **Strict Browsing on:** a Google search URL gains `safe=active`.
7. **Settings → Performance → Benchmark:** results appear, and a backend is chosen.
8. **Lock:** set a passcode. Lowering the level asks for it; raising it doesn't.
9. Switch the language to العربية: the layout mirrors and nothing overlaps.
10. Check `about:debugging` → _Inspect_ → Console for errors.

## Real-world sites

The lab covers mechanisms; real sites add scale and oddities. Before a release, spot-check a
**safe** browsing session on a news site, a social feed, an image search (with safe queries), a
video site and a web mail client. Look for anything that stays hidden too long, flickers, breaks
layout or stops working. Never test with explicit material on shared or work machines.

## Performance

See [BENCHMARKS.md](BENCHMARKS.md): `npm run bench` (engine per backend),
`node scripts/bench/latency.mjs` (time-to-verdict in the extension) and `npm run calibrate`
(accuracy on your own labelled set).
