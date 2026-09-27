# Architecture

Veil is a Manifest V3 extension with one TypeScript codebase for Chrome and Firefox.
Media is hidden **before it paints**, analysed **on the device**, and then either shown
or kept protected according to the user's policy.

```
┌───────────────────────── web page (every frame) ─────────────────────────┐
│ content.css (manifest-injected)  html[data-veil-on] img:not(ok) → hidden │
│ content.js  ─ scanner ─ visibility ─ scheduler ─ capture ─ policy ─ render│
└───────────────┬───────────────────────────────────────────────────────────┘
                │ Port "veil-engine" (validated, per-frame in-flight cap)
┌───────────────▼───────────────────────────────────────────────────────────┐
│ background (Chrome: service worker · Firefox: event page)                │
│ router ─ EngineService (LRU cache, dedupe) ─ InferenceClient             │
│ DNR rules (site block/warn, SafeSearch) ─ tab stats ─ commands ─ menus   │
└───────────────┬───────────────────────────────────────────────────────────┘
                │ Chrome: offscreen document (reason WORKERS) · Firefox: direct
┌───────────────▼───────────────────────────────────────────────────────────┐
│ InferenceHost: guarded media fetch, timeouts, crash cooldown             │
│   └─ dedicated Worker: TF.js (WebGPU → WebGL → WASM SIMD → CPU)          │
│      classifier · face detector · person detector · region renderer      │
└───────────────────────────────────────────────────────────────────────────┘
```

## Processes and why they exist

| Component | Where it runs | Responsibility |
|---|---|---|
| **Content script** (`src/content`) | Every frame, `document_start`, including `about:blank` and sandboxed frames | Pre-display gate, media discovery, capture, policy decisions, rendering protection, reveal UI |
| **Background** (`src/background`) | Chrome service worker / Firefox event page | Message routing and validation, engine cache, DNR rules, badge, commands, context menu, managed-policy mirror |
| **Inference host** (`src/ml/host`) | Chrome offscreen document; Firefox background page | Owns the worker; fetches cross-origin media under strict rules; restarts a crashed worker with back-off |
| **Engine worker** (`src/ml/worker`) | Dedicated Worker | Decoding, batching, model execution, region rendering |
| **Extension pages** (`src/popup`, `src/options`, `src/onboarding`, `src/interstitial`) | Extension origin | UI; read and write settings through `SettingsStore` |

Chrome service workers cannot run WebGL/WebGPU or keep a Worker alive, so Chrome hosts inference in an
offscreen document. Firefox event pages can host the Worker directly, so the offscreen code is compiled
out of the Firefox bundle (`__BROWSER__` constant, dead-code elimination).

## Life of an image

1. **Gate (synchronous).** The first statement of `content.js` sets `data-veil-on` on `<html>`.
   `content.css`, injected by the manifest before any page CSS runs, then hides every `img`,
   `video`, and inline background image that doesn't yet carry a verdict: `opacity: 0` for media
   elements, `background-image: none` for backgrounds. Layout is untouched: dimensions, flow and
   click targets stay the same.
2. **Settings.** The script reads settings and the managed-policy mirror from `storage.local` and
   resolves the *effective policy* for this site (see [Policy resolution](#policy-resolution)). If
   protection is off here, the gate is released at once. If anything throws during start-up, the
   script **fails open**: it releases the gate, so Veil can never leave a page blank.
3. **Discovery.** A `MutationObserver` watches the document and every shadow root, open or closed
   (via the browser's privileged `openOrClosedShadowRoot`). It picks up `img`, `video`,
   `<picture>`/`srcset` changes, `poster`, and inline `url(...)` backgrounds. Recycled nodes
   (virtualised lists, SPA routes) are re-verified when their source signature changes.
4. **Priority.** An `IntersectionObserver` sorts media into *visible* (0), *near viewport* (1) and
   *other* (2). The per-frame `AnalysisScheduler` runs at most 6 requests at once and caps
   low-priority work at half of that, so above-the-fold media is decided first even on a page with
   hundreds of thumbnails.
5. **Capture.**
   - Same-origin, `data:` and `blob:` media is drawn to a small canvas in the page (up to 320 px on the
     long side, 768 px when region protection is on) and sent as pixels.
   - Cross-origin media is sent as a URL. The inference host fetches it without credentials and with
     no referrer, refuses private-network targets from public pages, caps size at 20 MB and times out
     after 15 s (`src/ml/host/fetch-media.ts`).
6. **Engine.** The background `EngineService` checks its LRU cache (5,000 entries, 30 min TTL,
   memory only) and de-duplicates identical in-flight requests across tabs. The worker decodes the
   media: `ImageDecoder` samples several frames of animated images; otherwise `createImageBitmap`.
   It batches concurrent requests and runs only the models the policy needs.
7. **Signals → decision.** The worker returns raw **signals**: classifier scores, face boxes and
   person boxes. The content script turns signals into a **decision** with the pure policy engine
   (`src/policy/engine.ts`). Signals are cached separately from decisions, so changing the level
   re-decides every item on the page instantly, with no re-inference.
8. **Render.** The element's `data-veil` attribute becomes `ok` (shown), `x` (protected), `rg`
   (region-protected) or `r` (revealed by the user). Protection styles are pure CSS keyed off
   `data-veil-style` on the root: soft/strong blur, pixelate, solid, placeholder or hide. For region
   protection, the worker renders a copy with only the face or person boxes concealed. That copy is
   drawn over the original through CSS custom properties. If the page's CSP forbids the `data:` image,
   the element falls back to whole-element protection.

## Video

`src/content/media/video.ts` samples playing videos on a 200 ms tick.

- **Scene detection.** A difference hash (dHash, with a dead-band against gradient noise) plus
  mean-colour distance decide whether the picture has changed enough to analyse.
- **Adaptive cadence.** The interval adapts between ¼× and 3× of the level's base interval. A token
  bucket (4 frames/s per page, ≥ 250 ms between frames of one video) keeps cost bounded. The most
  overdue video goes first.
- **Stability.** Scores are smoothed with an exponential moving average. Protection lifts only after
  3 consecutive safe frames and a 2 s minimum, and only when *auto-restore* is on.
- **Keys.** Frames are keyed by `src` and `currentTime`, never by hash, so a safe verdict can't be
  reused for an unsafe frame that happens to hash alike.
- **Unreadable video.** A cross-origin video without CORS taints the canvas, so its frames can't be
  read. Veil applies the **fallback** policy: *reveal* at Minimal/Balanced, *protect* at
  Strict/Maximum.

## Policy resolution

Managed policy is applied first, as an overlay on the stored settings inside `SettingsStore`. A
user change can't take effect underneath it (see [DEPLOYMENT.md](DEPLOYMENT.md)).
`src/policy/resolve.ts` then turns those settings, the site rules and Strict Browsing into one
`EffectivePolicy` per frame. Precedence:

1. Disabled or paused → off. Pause doesn't apply under Strict Browsing.
2. A site rule set to `off` → off, unless Strict Browsing ignores site exceptions.
3. A site rule with its own level → that level's thresholds.
4. Strict Browsing raises the floor to **Strict**: reveal needs at least *hold* plus a confirmation,
   the fallback is *protect*, and there is no auto-restore.

Site patterns (`src/sites/rules.ts`) support `example.com` (domain and subdomains), `*.example.com`
(subdomains only), `=example.com` (exact host) and globs such as `cdn*.example.*`. The most specific
match wins; a temporary rule beats a permanent one of equal specificity.

## Site blocking and Strict Browsing (declarativeNetRequest)

`src/background/dnr.ts` compiles settings into browser-enforced rules. The browser applies them to
navigations; Veil's code never observes the pages you visit.

| Rule IDs | Purpose | Mechanism |
|---|---|---|
| 1–99 | SafeSearch (Google, Bing, DuckDuckGo, Yandex…), YouTube Restricted Mode | `queryTransform` redirects adding the engine's safe parameter; `YouTube-Restrict: Strict` request header |
| 1000–8999 | Blocked and warned sites | Regex redirect to `interstitial.html#block\|<url>` or `#warn\|<url>` |
| 10000+ | "Continue anyway" on warned sites | Session-scoped allow rules that expire through `alarms` (≤ 60 min) |

The background grants an allowance only when the matching rule's mode is `warn`. A crafted
interstitial URL therefore can't unblock a blocked site; `tests/e2e/sites.spec.ts` covers this.

Two deliberate properties:

- **Block and warn cover their whole pattern.** A more specific rule, such as a level for
  `=news.example.com`, does not lift a block on `example.com`; narrow or remove the block
  instead. Lifting it would need a DNR `allow` rule, and that rule would also outrank SafeSearch on
  that host.
- **Temporary block and warn rules end on time.** Dynamic rules don't expire by themselves, so
  the background sets an alarm for the next expiry and rebuilds the rules when it fires.

## Settings, lock and managed policy

- `SettingsStore` (`src/storage/settings-store.ts`) wraps `storage.local` under the key
  `veil.settings`. It validates every field on read (`sanitizeSettings`), so a corrupt value falls
  back to its default *individually* and can't weaken the rest. It notifies subscribers on change.
- **Lock** (`src/security/lock.ts`): a PBKDF2-SHA-256 verifier with 600,000 iterations, a 16-byte
  salt and constant-time comparison. After 5 failures it backs off progressively. An unlock lasts
  5 minutes in `storage.session`. `weakenedScopes()` classifies each change, so only *weakening*
  changes (lower level, disable, site exceptions…) ask for the passcode; strengthening never does.
- **Managed policy** (Chrome `storage.managed`, see [DEPLOYMENT.md](DEPLOYMENT.md)) is read only by
  the background, with a 3 s bound. It is mirrored to `veil.managedPolicy` in `storage.local`, so
  content scripts never block on the slow managed-storage call.

## Messaging and trust boundaries

`src/shared/messages.ts` holds a validator for every message shape (`src/security/validate.ts`).

- **Content → background** uses the `veil-engine` port. The router accepts it only from Veil's own
  content scripts (sender id, tab present, not an extension page). It takes the request initiator
  from the browser's sender record, never from message fields. It caps in-flight requests at 64 per
  port and cancels a frame's work when the port closes.
- **Extension pages → background** use one-shot runtime messages. Privileged requests (engine
  reset, benchmark, site allowances) are refused from content scripts.
- **Background → host → worker** messages are typed (`src/ml/worker/protocol.ts`). Every detect has
  a 20 s timeout. Three crashes within a minute trigger a 30 s cooldown, during which media receives
  the fallback decision.

See [SECURITY.md](SECURITY.md) for the threat model.

## Engine lifecycle and backends

`src/ml/backend.ts` tries, in order: **WebGPU**, **WebGL** (hardware), **WASM SIMD**, then
**CPU**. Each candidate must initialise within 10 s and pass a numeric smoke test.

- **Software GPUs.** Software WebGL renderers and CPU-emulated WebGPU adapters (SwiftShader,
  llvmpipe, WARP) are deferred behind WASM. They are much slower (see [BENCHMARKS.md](BENCHMARKS.md)),
  but are still tried before plain-JS CPU.
- **Hangs.** The WebGPU adapter request has a 2.5 s deadline, because on some virtualised systems it
  never settles.
- **Benchmark.** Settings → Performance runs each backend in an isolated worker and stores the
  winner as `veil.engine.profile`. The engine then starts with that backend.
- **Unloading.** Models load lazily per signal and unload after the idle time set in settings.

## Directory map

```
src/
  background/     router, engine cache, inference client, DNR, stats, commands
  browser/        cross-browser API access and capability probes
  content/        gate, scanner, scheduler, capture, video, renderer, reveal
  i18n/           runtime translator, catalogs (en, ar, fr)
  interstitial/   block / warn page
  ml/             model providers, worker, host, decode, render, backend selection
  offscreen/      Chrome offscreen document entry
  onboarding/     first-run flow
  options/        settings app (sections/*)
  policy/         presets, resolver, decision engine, calibration math
  popup/          toolbar popup
  security/       validation, lock, weakening classification
  shared/         LRU, hashing, URL helpers, messages, logger
  sites/          site pattern parsing and matching
  storage/        schema, sanitisation, migrations, SettingsStore
  ui/             design system: tokens, components, icons, app context
scripts/          build, manifest, models, packaging, benchmark, calibration
lab/              compatibility lab (local test site with two origins)
tests/            unit, integration (Vitest) and E2E (Playwright)
```
