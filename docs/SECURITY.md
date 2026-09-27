# Security and threat model

Veil runs with broad host access in every page, so its first security duty is not to become a
liability. Its second is to protect as well as it can against the adversaries it can realistically
resist, and to say plainly which ones it can't.

## Assets

| Asset | Why it matters |
|---|---|
| The user's browsing | Veil sees media on every page. It must never leak, log or transmit it. |
| Extension privileges | Host access and cross-origin fetch could be abused, for example to read a user's LAN. |
| The protection itself | Users (and parents, schools, organisations) rely on it to hide media they chose not to see. |
| The lock and policy | Settings a household or administrator chose should resist casual change. |

## Adversaries and what Veil does about them

### 1. A web page trying to abuse Veil's privileges

| Attack | Mitigation |
|---|---|
| Send forged messages to the background | The background has no `externally_connectable` or web-exposed messaging. The engine port accepts only Veil's own content scripts, identified by the browser's sender record. Every message is schema-validated (`src/shared/messages.ts`). |
| Make Veil fetch internal URLs (SSRF, LAN probing) | Only `http(s)`; no credentials or referrer; URLs with embedded credentials are refused; private-network targets are refused unless the initiating page is itself private. The initiator comes from the browser, not the message (`src/ml/host/fetch-media.ts`). |
| Read responses through Veil | Fetched bytes go only to the model. Pages receive at most a verdict attribute on their own element. |
| Exhaust CPU or memory | 6 concurrent analyses per frame; 64 in-flight requests per port; 20 MB and 15 s per fetch; 8 MB data-URL cap; 20 s per detection; worker crash cooldown (3 crashes/min → 30 s pause with the fallback decision); a token bucket for video frames. |
| Exploit a decoder or model | Decoding and inference run in a dedicated worker with no DOM or extension APIs. A crash only costs a restart. |
| Craft the interstitial URL | The interstitial accepts only `http(s)` targets, shows the host isolated from surrounding bidirectional text, and can "continue" only where the matching rule is *warn*. The background re-checks this itself (`site/proceed`). |
| Inject script into Veil's UI | Preact renders text as text. ESLint forbids `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `dangerouslySetInnerHTML` in `src/`. CSP `script-src 'self' 'wasm-unsafe-eval'` rules out inline or remote script anyway. |

### 2. A web page trying to evade protection

Veil is designed against **incidental exposure**: ordinary pages, feeds, ads, search results and
embeds. It is not a guarantee against a page *engineered* to show media to a Veil user. A page
that controls its own markup can, for example:

- draw pixels on `<canvas>` or WebGL, or use SVG `<image>`, `<object>`/`<embed>`, or CSS-generated
  content; Veil analyses `img`, `video` and inline `url(...)` backgrounds only;
- set background images from **stylesheets** rather than inline styles (see
  [Known limitations](../README.md#known-limitations));
- override Veil's page CSS with more specific `!important` rules;
- serve a benign image to the analyser and a different one to the page, by varying content per
  request.

Within those bounds, Veil closes the gaps it can:

- The gate is set synchronously at `document_start`, before first paint.
- Media inside open **and closed** shadow roots, same- and cross-origin iframes, `about:blank`
  and `srcdoc` frames is covered.
- A source change (`src`, `srcset`, `<picture>` sources, poster) re-hides the element until it is
  re-verified. `tests/e2e/regressions.spec.ts` covers this.
- Video verdicts are keyed by source and timestamp, never by a perceptual hash a crafted frame could
  collide with.
- Media that can't be verified (tainted canvas, decode failure, engine unavailable) gets the
  **fallback** decision, which is *protect* at Strict, Maximum and under Strict Browsing.

### 3. Someone at the keyboard trying to turn protection off

The settings lock is a speed bump against casual changes, and the UI says so. It is a
PBKDF2-SHA-256 verifier (600,000 iterations, 16-byte random salt), compared in constant time. After
5 failed attempts it backs off from 30 s, doubling up to 15 min. It guards only *weakening* changes,
as classified by `src/security/weakening.ts`:

- disabling, pausing, or turning off Strict Browsing or any of its parts;
- lowering the level, a category threshold or the media covered;
- relaxing reveal (a weaker mode, or no confirmation) or the fallback;
- adding a site exception or a site level below the global one;
- editing, removing or shortening an existing site rule, unless the edit makes it a block that lasts
  at least as long;
- importing or resetting settings that do any of the above.

Strengthening never asks for the passcode. Things the lock cannot stop, by design of the browser:

- **uninstalling or disabling the extension** from the browser's extensions page;
- **private or incognito windows**, where extensions don't run unless the user allows them;
- **developer tools** on the extension's background page, which can edit storage;
- **another browser or profile**.

For a device that must stay protected, use browser policy: force-install Veil, pin its settings
and control private browsing ([DEPLOYMENT.md](DEPLOYMENT.md)).

### 4. Supply chain

- **Models** are fetched at build time from pinned versions and verified against hard-coded SHA-512
  or SHA-256 digests (`scripts/fetch-models.mjs`). `scripts/package.mjs` re-verifies every model
  file in the build against `models.json` before creating a release archive.
- **No remote code.** Nothing is loaded at runtime from outside the package, and the CSP enforces it.
- **Dependencies** are pinned to exact versions (`.npmrc` `save-exact`) with a committed lockfile.
  Use `npm ci` in release builds.
- **Reproducible archives** (sorted entries, fixed timestamps) let reviewers rebuild and compare
  packages byte for byte.

## Fingerprinting

Veil marks elements it handles with `data-veil` attributes, and `<html>` with `data-veil-on`. A page
can therefore tell that Veil is installed. That is unavoidable for CSS that must apply before
scripts run. The attributes carry no identifiers and nothing about the user's settings beyond the
visible state of that page's own media.

## Hardening checklist (enforced)

- [x] MV3; CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'`
- [x] No `eval`/`new Function` in shipped code (release packaging refuses otherwise)
- [x] No `innerHTML`-family sinks in `src/` (ESLint)
- [x] All inbound messages validated; privileged requests limited to extension pages
- [x] One web-accessible resource (the interstitial)
- [x] Stored settings sanitised field by field on every read; imports validated
- [x] Fetch guard: scheme, credentials, private network, size, time
- [x] No telemetry, no remote endpoints

## Reporting a vulnerability

Please report security issues privately through the repository's **Security → Report a
vulnerability** (GitHub private advisories), not in public issues. Include the browser, version and
a minimal reproduction.
