# Privacy

**Short version:** Veil analyses images and video on your device with models packaged inside the
extension. Nothing you browse, see or protect is sent anywhere. There is no Veil server, account,
analytics, telemetry or crash reporting.

This document is the privacy policy for the extension and a precise inventory of what it
stores. The in-product **Privacy Center** (Settings → Privacy) says the same thing in plain
language.

## What never happens

- No image, video frame, page content or URL is uploaded. There is no remote classification API.
- No browsing history is recorded, locally or remotely.
- No analytics, telemetry, crash reports, advertising identifiers or fingerprinting.
- No account or sign-in, and no cloud processing of any kind.
- No data is sold or shared. There is none to share.
- No remote code. Every script, model and WebAssembly binary ships inside the package, and the
  Content Security Policy (`script-src 'self' 'wasm-unsafe-eval'`) makes loading anything else
  impossible.

## Network requests Veil makes

Veil makes **one** kind of network request: fetching a cross-origin image or video that a page
is _already displaying_, so the on-device model can analyse it. That request:

- goes only to the server the page already loaded the media from;
- carries **no cookies or credentials** and **no referrer**;
- is refused for private-network addresses (for example `192.168.x.x` or `localhost`) unless the
  page itself is on a private network, so a public page can't use Veil to probe your LAN;
- is capped at 20 MB and 15 seconds;
- is often served from the browser's HTTP cache, because the page has just loaded the same file.

Same-origin, `data:` and `blob:` media is read from the page directly, without any request.

## What is stored on your device

| Key                   | Area                       | Contents                                                                                                          | Lifetime                                     |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `veil.settings`       | `storage.local`            | Your settings and site rules                                                                                      | Until you reset, change or uninstall         |
| `veil.lock`           | `storage.local`            | Passcode _verifier_ (PBKDF2-SHA-256 hash with salt, iteration count, failure counter). Never the passcode itself. | Until you remove the lock or uninstall       |
| `veil.engine.profile` | `storage.local`            | Which inference backend was fastest in your benchmark, with timings                                               | Until the next benchmark or uninstall        |
| `veil.shortcuts`      | `storage.local`            | Your keyboard shortcut assignments, so pages can show the right hint                                              | Until uninstall                              |
| `veil.managedPolicy`  | `storage.local`            | Copy of administrator policy, if your organisation set one                                                        | While the policy exists                      |
| `veil.unlockedUntil`  | `storage.session` (memory) | When a lock unlock expires                                                                                        | Browser session; at most 5 minutes           |
| `veil.allowances`     | `storage.session` (memory) | Hosts you chose to "continue anyway" on a _warned_ site, with expiry                                              | Browser session; at most 60 minutes          |
| `veil.tabStats`       | `storage.session` (memory) | Per-tab counters (checked, protected, revealed) for the popup                                                     | Browser session; cleared when the tab closes |

Session storage lives in memory and is never written to disk.

The allowance entries necessarily name a host. They exist only for sites _you_ configured as
"warn", and only until they expire.

**Not stored anywhere:**

- Which pages you visited.
- Which images were protected.
- Image contents and model outputs, including the people filter's apparent-gender estimates, which
  exist only to decide what to blur on your screen. Model outputs are kept in memory caches (the background's
  5,000-entry, 30-minute cache and a per-page cache) keyed by a hash of the media's address. They are
  never persisted. Settings → Privacy → _Clear recent results_ empties the background cache
  immediately. A per-page cache disappears when its page is closed or reloaded.

## Settings export

_Export settings_ writes a JSON file of your settings and site rules to a location you choose. It
does not include the lock verifier. Import is validated field by field, and importing settings that
weaken protection asks for the passcode if a lock is set.

## Permissions

Every permission and why it is needed is listed in [PERMISSIONS.md](PERMISSIONS.md).

## Firefox data-collection declaration

The Firefox manifest declares `data_collection_permissions: { required: ["none"] }`, the formal
statement that Veil collects no data.

## Enterprise and family deployments

Administrators can pin settings through browser policy ([DEPLOYMENT.md](DEPLOYMENT.md)). Policy
flows _into_ the extension. Nothing flows back out: Veil has no reporting channel, so an
administrator cannot see what a user browsed or what was protected.

## Changes

A change to this policy that affected data handling would be listed in the release notes and would
never apply retroactively. If Veil ever needed a network service, it would be opt-in, off by
default and described here first.
