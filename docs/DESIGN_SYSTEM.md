# Design system

Veil's interface should feel calm, precise and trustworthy: a quiet tool that gets out of the way.
Every visual value comes from tokens in `src/ui/styles/tokens.css`. Components are thin, accessible
wrappers around native elements (`src/ui/components`).

## Principles

1. **Calm over alarming.** Protection is routine, not an emergency. Neutral language, no red unless
   something is actually wrong.
2. **Honest.** Say what Veil does and doesn't do. No fake certainty, no invented numbers.
3. **Respectful.** No guilt, urgency, streaks or nagging. Turning Veil off is as easy to find as
   turning it on (unless a lock the user set says otherwise).
4. **Quiet by default, deep on request.** The popup covers the everyday; everything else is one
   click away in Settings, and searchable.
5. **Native first.** Real buttons, inputs, selects and dialogs, so keyboard, screen-reader and
   platform behaviour come for free.

## Brand

The mark is two strokes forming a **layered V**: a translucent stroke behind a solid one, like a
veil in front of an image. It appears on a deep indigo gradient for the icon
(`static/brand/icon.svg`, rendered to PNG by `scripts/generate-icons.mjs`) and in the accent colour
in headers (`Mark` in `src/ui/icons.tsx`). The mark, icon set, palette and copy are original to
Veil.

## Tokens

### Colour

Semantic tokens (`--bg`, `--surface`, `--surface-2/3`, `--border`, `--text`, `--text-2/3`,
`--accent*`, `--positive`, `--caution`, `--critical`, and `*-soft` tints) are redefined per theme:

- **Light:** the default.
- **Dark:** `prefers-color-scheme: dark`, or forced with `[data-theme="dark"]` from Settings →
  General → Theme.
- **Increased contrast:** `prefers-contrast: more` strengthens borders and secondary text.

Accent: indigo `#5357d4` (light) and `#8387f4` (dark). Status colours are reserved for status.

**Verified text contrast (WCAG 2.2, AA requires 4.5:1)**, computed from the token values:

| Pair                                               | Light | Dark  |
| -------------------------------------------------- | ----- | ----- |
| `--text` on `--surface`                            | 18.05 | 15.26 |
| `--text` on `--bg`                                 | 16.58 | 16.62 |
| `--text-2` on `--surface`                          | 6.94  | 7.57  |
| `--text-2` on `--surface-2`                        | 6.21  | 7.01  |
| `--text-3` on `--surface`                          | 5.80  | 6.17  |
| `--text-3` on `--bg`                               | 5.32  | 6.72  |
| `--text-3` on `--surface-2`                        | 5.19  | 5.71  |
| `--accent-text` on `--surface`                     | 7.34  | 8.46  |
| `--text-on-accent` on `--accent` (primary buttons) | 5.70  | 6.11  |
| `--positive` on `--surface`                        | 5.96  | 8.57  |
| `--caution` on `--surface`                         | 6.38  | 8.43  |
| `--critical` on `--surface`                        | 6.64  | 6.16  |

### Typography

Inter (variable, bundled locally from `@fontsource-variable/inter`) for Latin text, and the
platform's Arabic UI fonts for Arabic. Scale, in px: 11 · 12 · 13 · **14 (body)** · 15 · 17 · 20 ·
26 · 34. Tight tracking for display sizes, 1.5 line height for body, tabular numerals for counters.

### Space, radius, elevation

- **Space**, a 4 px grid: 2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64.
- **Radius:** 6 · 8 · 12 · 16 · 20 · full.
- **Shadows:** `xs` → `lg`, soft and low-contrast. Dark mode relies on surface steps more than
  shadows.

### Motion

| Token           | Value                      | Use                      |
| --------------- | -------------------------- | ------------------------ |
| `--dur-1`       | 110 ms                     | Hover, press             |
| `--dur-2`       | 180 ms                     | Toggles, segmented thumb |
| `--dur-3`       | 280 ms                     | Panels, dialogs          |
| `--ease-out`    | `cubic-bezier(.2,.8,.2,1)` | Most transitions         |
| `--ease-spring` | slight overshoot           | Switch thumb only        |

Every duration becomes 0 under `prefers-reduced-motion`, or when _Motion: Reduced_ is chosen in
Settings. Nothing essential is conveyed by motion.

## Components

| Component          | Element                         | Notes                                                                                                                                |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`           | `<button>`                      | Variants: primary, secondary, ghost, soft, danger. Sizes: sm, md, lg. `busy` shows a spinner and sets `aria-busy`.                   |
| `IconButton`       | `<button>`                      | Always has an `aria-label` and a tooltip                                                                                             |
| `Switch`           | `<button role="switch">`        | `aria-checked`; md and lg sizes                                                                                                      |
| `Segmented`        | `radiogroup` of `radio` buttons | Sliding thumb; roving tabindex; arrow keys (RTL-aware)                                                                               |
| `Slider`           | `<input type="range">`          | `aria-valuetext` for human values (for example "48 px", "55%")                                                                       |
| `Select`           | `<select>`                      | Native menus on every platform                                                                                                       |
| `Row`              | settings row                    | Label, description and control. Shows _disabled_ with colour, not opacity (keeps contrast), and a _Managed_ pill when policy-locked. |
| `Card`             | `<section>`                     | Optional header and actions; groups rows                                                                                             |
| `Banner`           | `<div>`                         | neutral, accent, caution or positive; optional `role="status"`/`alert`                                                               |
| `Choice`           | `<button role="radio">`         | Large selectable cards (onboarding levels, protection styles)                                                                        |
| `Stat` / `CountUp` | —                               | Animated counters; final value only under reduced motion                                                                             |
| `Dialog`           | `<dialog>`                      | `showModal()`; Escape and backdrop handled natively                                                                                  |
| `Icon` / `Mark`    | inline SVG                      | 24 × 24 grid, 1.75 stroke, round caps; decorative unless labelled; directional icons mirror in RTL                                   |

CSS classes (`.btn`, `.row`, `.card`, `.pill`, `.banner`, `.switch`, `.segmented`, `.field`, …)
live in `components.css`. Pages add layout only (`popup.css`, `options.css`, …).

## Surfaces

- **Popup (360 px):** site status, protected count, pause options, level picker, a link to
  Settings. It answers "is this page protected, and how do I change that?" in one glance.
- **Settings:** a sidebar with 11 sections, a search field that deep-links to any setting, and
  export, import and reset.
- **Onboarding:** 6 short steps: welcome, _on-device_ promise, permissions explained, level,
  optional tuning, done. The level step starts on Balanced (the default), the performance check in
  the tuning step can be skipped, and _Back_ is always available.
- **Interstitial:** a centred card, a clear title, the host, and _Go back_ as the primary action.
  On warned sites, _Continue_ is a secondary action with explicit durations.

## In-page UI

On web pages Veil draws as little as possible.

- **Protection styles:** soft blur, strong blur (default), pixelate, solid, placeholder (a neutral
  panel with the eye-off glyph) and hide (keeps layout, shows nothing). All are pure CSS on the
  element itself, with no wrappers and no reflow.
- **The chip:** a small "Protected" pill with the reveal action, shown on hover or focus. It is
  rendered in a closed shadow root with its own tiny stylesheet (`chip-styles.ts`), so page CSS
  can't touch it. It follows the user's theme and language direction.
- **Hold-to-reveal:** a progress ring fills during the 0.7 s hold; releasing early cancels.

## Voice and tone

- Plain, short, second person. "Veil hides images before they appear." not "Our AI-powered
  engine…".
- Name what happened and what the user can do. Avoid words that shame (_inappropriate_, _bad_,
  _dirty_); prefer _protected_, _hidden_, _shown_.
- Never promise perfection. The About page says that some unwanted media will be missed and some
  safe media hidden. Strict Browsing says it reduces exposure but can't guarantee it.
- No exclamation marks.

## Not allowed (dark patterns)

- Making _Turn off_ or _Uninstall_ harder to find than _Turn on_.
- Countdown timers, fake scarcity, guilt copy ("Are you sure you want to be unprotected?").
- Pre-checked data sharing (there is none to share).
- Hiding settings behind accounts, upsells or modal chains.
