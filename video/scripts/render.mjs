/**
 * Render the film (or review stills) with Remotion.
 *
 *   npm run render                          # out/veil-showcase.mp4 (1080p60, H.264 + AAC)
 *   npm run render -- --stills              # one still per scene → out/stills/
 *   npm run render -- --stills=gate:0.5     # a scene at a point (0…1) of its length
 *   npm run render -- --frames=120-900      # a range, for quick previews
 *
 * Uses the Chromium set by BROWSER_EXECUTABLE, if any (for example a
 * pre-installed headless shell), instead of downloading one.
 */
import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);
const browserExecutable = process.env.BROWSER_EXECUTABLE || null;
if (!browserExecutable) await ensureBrowser();

console.log('Bundling…');
const serveUrl = await bundle({ entryPoint: join(root, 'src', 'index.ts'), publicDir: join(root, 'public') });
const composition = await selectComposition({ serveUrl, id: 'VeilShowcase', browserExecutable });
const outDir = join(root, 'out');
mkdirSync(join(outDir, 'stills'), { recursive: true });

if (args.stills) {
  // Scene ranges come from the composition itself (Root passes them as props).
  const scenes = composition.props.scenes;
  const wanted =
    typeof args.stills === 'string'
      ? args.stills.split(',').map((spec) => {
          const [id, at] = spec.split(':');
          return { id, at: at === undefined ? 0.72 : Number(at) };
        })
      : scenes.map((s) => ({ id: s.id, at: 0.72 }));
  const browser = await openBrowser('chrome', { browserExecutable });
  for (const { id, at } of wanted) {
    const scene = scenes.find((s) => s.id === id);
    if (!scene) throw new Error(`Unknown scene ${id}`);
    const frame = Math.round(scene.from + scene.length * at);
    const output = join(outDir, 'stills', `${id}-${String(Math.round(at * 100)).padStart(3, '0')}.png`);
    await renderStill({ serveUrl, composition, frame, output, puppeteerInstance: browser });
    console.log(`${output.replace(root + '/', '')}  (frame ${frame})`);
  }
  await browser.close({ silent: true });
} else {
  const output = join(outDir, args.frames ? 'preview.mp4' : 'veil-showcase.mp4');
  const frameRange = typeof args.frames === 'string' ? args.frames.split('-').map(Number) : null;
  let last = -1;
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    audioCodec: 'aac',
    audioBitrate: '192k',
    crf: 16,
    x264Preset: 'slow',
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    imageFormat: 'jpeg',
    jpegQuality: 95,
    concurrency: Number(args.concurrency) || Math.max(1, cpus().length),
    frameRange,
    outputLocation: output,
    browserExecutable,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= last + 5) {
        last = pct;
        console.log(`${pct}%`);
      }
    },
  });
  console.log(`→ ${output.replace(root + '/', '')}`);
}
