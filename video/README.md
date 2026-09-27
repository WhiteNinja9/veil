# Veil showcase film

A 71-second motion-graphics film about Veil, built with [Remotion](https://www.remotion.dev). The
narration is recorded with Gemini TTS, and every caption word appears exactly as it is spoken.
There is no music: the soundtrack is the voice and synthesized sound effects.

The film uses the product's own design: the dark tokens from `src/ui/styles/tokens.css`, Inter, the
layered-V mark, the extension's icon set, and recreations of the popup, the Privacy Center, the site
rules, Strict Browsing, the lock and the in-page "Protected · Show" chip. Every image in it is
procedural vector art (`src/components/ArtTile.tsx`), so the film contains no real photos and
nothing sensitive.

## Pipeline

```
narration.json ──► npm run voice ──► public/voice/full.wav        (Gemini TTS, one request)
               ──► npm run align ──► src/data/alignment.json      (word timings, PocketSphinx)
               ──► src/timeline.ts ──► scenes ──► npm run render ──► out/veil-showcase.mp4
scripts/sfx.py ──► npm run sfx   ──► public/sfx/*.wav             (sound effects, cued in src/sfx.ts)
```

- **`narration.json`**: the script, one entry per scene. `|` starts a new caption line and
  `*word*` shows a word in the accent gradient. It also holds the voice (`Charon`, a male voice),
  the TTS model and the delivery notes.
- **`scripts/voice.mjs`**: records the whole narration in **one** request, which gives one consistent
  read and uses the free tier's small daily quota sparingly. `--scene=<id>` re-records a single
  scene into `public/voice/scenes/<id>.wav`, which then replaces that scene's part.
- **`scripts/align.py`**: forced alignment of the known text against the recording with PocketSphinx.
  Its English model ships inside the pip package, so nothing is downloaded. It splits the
  recording into scenes at the pauses. Words missing from its dictionary go in
  `EXTRA_PRONUNCIATIONS`.
- **`src/timeline.ts`**: places each scene on the film's timeline: the pause after each line, the lead
  before it, and the overlap for transitions.
- **`scripts/sfx.py`** and **`src/sfx.ts`**: sound effects synthesized from noise and sweeps
  (whooshes, clicks, taps, a low swell for the logo; nothing melodic), and the cue sheet that ties
  each one to the same word timings the animation uses.
- **`src/components/Caption.tsx`**: the word-by-word type. Each word lifts out of a blur as it is
  spoken, like Veil lifting its protection.

## Commands

```sh
npm ci
pip install pocketsphinx numpy

GEMINI_API_KEY=… npm run voice          # only when the script changes (never commit the key)
npm run align                           # after every new recording
npm run sfx                             # only when scripts/sfx.py changes
npm run studio                          # preview and scrub in the browser
npm run render                          # out/veil-showcase.mp4, 1920×1080, 60 fps, H.264 + AAC
npm run render -- --stills              # a review still per scene → out/stills/
npm run render -- --stills=gate:0.5     # one scene at a point of its length
npm run render -- --frames=0-600        # a quick preview range → out/preview.mp4
npm run typecheck
```

To render with an existing Chromium instead of downloading one, set `BROWSER_EXECUTABLE`, for
example to Playwright's `chrome-headless-shell`.

The recorded narration (`public/voice/full.wav`), its timings and the sound effects are
committed, so the film renders without an API key.
