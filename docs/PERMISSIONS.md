# Permissions

Veil asks for the smallest set of permissions that lets it protect media before it is shown.
Each one is listed here with what it enables, what it is *not* used for, and what would break
without it. The manifest is generated from `scripts/manifest.mjs`, so this document and the code
live side by side.

## API permissions

| Permission | Browsers | Why | Without it |
|---|---|---|---|
| `storage` | both | Save settings, site rules, the lock verifier and the backend benchmark result in `storage.local`. Hold short-lived state (unlock window, tab counters, warn-site allowances) in memory-only `storage.session`. | Nothing could be configured |
| `declarativeNetRequestWithHostAccess` | both | Browser-enforced site blocking and warning (redirect to Veil's interstitial), SafeSearch parameters and the `YouTube-Restrict` header. The browser applies the rules; Veil never sees the navigations. The *WithHostAccess* variant, rather than plain `declarativeNetRequest`, avoids a broader install warning and limits rules to hosts Veil already has access to. | No site blocking, no Strict Browsing |
| `scripting` | both | Inject the protection script into tabs that were already open when Veil was installed or updated, so they are protected without a reload. | Existing tabs stay unprotected until reloaded |
| `contextMenus` | both | "Protect this image" / "Show this image" on right-click. | No per-image control from the context menu |
| `alarms` | both | Wake the background when a temporary rule ends: a "continue anyway" allowance on a warned site, or a temporary block/warn rule. (Timed pauses end in the content script, with no alarm needed.) | Temporary rules could outlive their time |
| `offscreen` | Chrome only | Chrome's service worker cannot run WebGL/WebGPU or host a long-lived Worker. An offscreen document (reason `WORKERS`) hosts the inference worker. It has no UI and is closed when idle. | No on-device inference on Chrome |

## Host permissions

`<all_urls>` is required, and it is the permission users should scrutinise most. It is used for
three things only:

1. **Protecting pages before they paint.** Content scripts must run at `document_start` in every
   frame, including cross-origin iframes. Anything narrower would let media flash unfiltered on
   unlisted sites. `activeTab` only grants access *after* a click, which is too late to be useful.
2. **Reading cross-origin media the page already displays**, so the model can analyse it. These
   requests carry no cookies or credentials and no referrer, and they refuse private-network
   targets from public pages (see [PRIVACY.md](PRIVACY.md#network-requests-veil-makes) and
   `src/ml/host/fetch-media.ts`).
3. **Scoping declarativeNetRequest rules** (`declarativeNetRequestWithHostAccess`).

It is **not** used to read page text, forms, cookies, history or credentials. Content scripts
touch only media elements and the attributes that select their source.

## Content script flags

| Flag | Why |
|---|---|
| `run_at: document_start` | The pre-display gate must be in place before the first image can paint |
| `all_frames: true` | Embedded frames (feeds, ads, galleries) are protected too |
| `match_about_blank: true` | `about:blank` / `srcdoc` frames that pages fill with media |
| `match_origin_as_fallback: true` (Chrome) | `blob:` / `data:` / sandboxed frames inherit protection from their creator |

## Web-accessible resources

Only `interstitial.html`, the page a blocked or warned site redirects to. The DNR redirect needs it
to be loadable from web origins. It accepts only `http(s)` targets, and its "continue" action is
honoured only for sites whose rule is *warn*. Scripts, models and other pages are not exposed.

## Content Security Policy

```
script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'
```

`'wasm-unsafe-eval'` is the minimum needed to instantiate the bundled WebAssembly inference
kernels. There is no `unsafe-eval`, no `unsafe-inline` and no remote origin. The packaging script
refuses to build a release containing `eval(` or `new Function(` (`scripts/package.mjs`).

## Permissions deliberately not requested

| Permission | Why not |
|---|---|
| `tabs` | Not needed. The host permission already exposes a web page's URL where Veil needs it: the active tab's host when you press the pause-site shortcut, and the list of open http(s) tabs to protect right after install. URLs are used in the moment and never stored. |
| `webRequest` / `webRequestBlocking` | declarativeNetRequest does the job without exposing traffic to extension code |
| `history`, `cookies`, `downloads`, `bookmarks` | Unrelated to protection |
| `identity`, remote hosts for APIs | No accounts, no servers |
| `unlimitedStorage` | Veil stores kilobytes |
| `management` | Not needed; managed deployments use browser policy |
| `privacy`, `proxy` | Not a network filter |
