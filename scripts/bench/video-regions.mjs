#!/usr/bin/env node
/**
 * How well blurred regions follow a moving person in playing video.
 *
 *   npm run build:test && node scripts/bench/video-regions.mjs [--seconds=30] [--rate=1]
 *
 * Plays the lab's "pair" clip (a woman walking across the frame, a man
 * standing still) with the people filter on "women", and reads, many times
 * a second, where the overlay drew its ovals and where her face really is
 * in the frame on screen. For each reading it reports the share of her face
 * that was covered, and whether the man was blurred.
 *
 * Uses the test build (dist/chrome-test): its face detector finds the
 * clip's painted faces exactly, so this measures the tracking and drawing
 * pipeline (sampling rate, messaging, prediction between analyses), not
 * detection accuracy. With the real models, analyses take longer and the
 * prediction has to bridge a longer gap.
 */
/* global chrome */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { startLab } from '../../lab/server.mjs';
import { PAIR_SCENE } from '../../lab/png.mjs';
import { parseArgs, root } from './common.mjs';

const args = parseArgs();
const seconds = Number(args.seconds ?? 30);
const rate = Number(args.rate ?? 1);
const extensionPath = path.join(root, 'dist', 'chrome-test');
if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
  console.error('Build the test extension first: npm run build:test');
  process.exit(1);
}

const lab = await startLab(4790, 4791);
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  for (let i = 0; i < 100; i++) {
    if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await worker.evaluate(() =>
    chrome.storage.local.set({
      'veil.settings': {
        onboardingComplete: true,
        categories: {
          faces: { enabled: true, threshold: 0.75, scope: 'regions' },
          people: { enabled: false },
        },
        peopleFilter: { who: 'women', unsure: 'reveal' },
        video: { peopleInVideos: true },
      },
    }),
  );
  const page = await context.newPage();
  await page.goto(`${lab.originA}/people.html`);
  await page.locator('#video-pair').scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector('#video-pair')?.getAttribute('data-veil') === 'rg',
    null,
    {
      timeout: 20_000,
    },
  );
  await page.evaluate((r) => {
    document.querySelector('#video-pair').playbackRate = r;
  }, rate);
  await page.waitForTimeout(1000);

  const readings = [];
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    // Read inside an animation frame, after the overlay has drawn for it: what gets painted.
    readings.push(
      await page.evaluate(
        ([source, scene]) =>
          new Promise((resolve) =>
            requestAnimationFrame(() => resolve(new Function(`return (${source})`)()(scene))),
          ),
        [read.toString(), PAIR_SCENE],
      ),
    );
    await page.waitForTimeout(40);
  }
  report(readings.filter(Boolean));
  reportGaps(await page.evaluate(analysisTimes, Math.min(seconds, 20) * 1000));
} finally {
  await context.close();
  await lab.close();
}

/** Runs in the page: one reading of the overlay against the true face positions (self-contained). */
function read(scene) {
  const video = document.querySelector('#video-pair');
  const rect = video.getBoundingClientRect();
  const canvas = [
    ...(document.querySelector('veil-video-layer')?.shadowRoot?.querySelectorAll('canvas') ?? []),
  ].find((c) => !c.hidden && Math.abs(c.getBoundingClientRect().left - rect.left) < 2);
  const t = video.currentTime;
  const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const frame = {
    x: (rect.width - video.videoWidth * scale) / 2,
    y: (rect.height - video.videoHeight * scale) / 2,
    w: video.videoWidth * scale,
    h: video.videoHeight * scale,
  };
  // The frame on screen (10 fps clip) and where each face is in it.
  const shown = Math.floor(t * 10 + 1e-6) / 10;
  const progress = (shown % scene.seconds) / scene.seconds;
  const faceAt = (x) => ({
    x: frame.x + x * frame.w,
    y: frame.y + scene.face.y * frame.h,
    w: scene.face.w * frame.w,
    h: scene.face.h * frame.h,
  });
  const woman = faceAt(scene.woman.x0 + (scene.woman.x1 - scene.woman.x0) * progress);
  const man = faceAt(scene.man.x);
  const cover = canvas?.dataset.cover === 'true';
  const ovals = canvas ? JSON.parse(canvas.dataset.boxes ?? '[]') : [];
  const inOval = (px, py) =>
    ovals.some((o) => ((px - o.x - o.w / 2) / (o.w / 2)) ** 2 + ((py - o.y - o.h / 2) / (o.h / 2)) ** 2 <= 1);
  const covered = (face) => {
    if (cover) return 1;
    let inside = 0;
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++)
        if (inOval(face.x + (face.w * i) / 10, face.y + (face.h * j) / 10)) inside++;
    return inside / 121;
  };
  return {
    t,
    sinceLoop: t % scene.seconds,
    cover,
    woman: covered(woman),
    manBlurred: !cover && inOval(man.x + man.w / 2, man.y + man.h / 2),
    areaRatio: ovals.length
      ? Math.max(...ovals.map((o) => (Math.PI / 4) * o.w * o.h)) / (woman.w * woman.h)
      : 0,
  };
}

function report(readings) {
  const pct = (n, d) => `${((100 * n) / d).toFixed(1)} %`;
  const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))];
  const describe = (label, rs) => {
    if (!rs.length) return;
    const full = rs.filter((r) => r.woman === 1).length;
    const areas = rs.filter((r) => r.areaRatio > 0).map((r) => r.areaRatio);
    console.log(
      [
        `${label}: ${rs.length} readings`,
        `  her face fully covered: ${full} (${pct(full, rs.length)})`,
        `  share of her face covered: min ${(100 * Math.min(...rs.map((r) => r.woman))).toFixed(0)} %, ` +
          `5th percentile ${(
            100 *
            quantile(
              rs.map((r) => r.woman),
              0.05,
            )
          ).toFixed(0)} %`,
        `  whole frame covered (cut/seek): ${rs.filter((r) => r.cover).length}`,
        `  the man blurred: ${rs.filter((r) => r.manBlurred).length}`,
        areas.length ? `  oval area / face area: median ${quantile(areas, 0.5).toFixed(2)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  };
  console.log(`Playback rate ${rate}×, ${seconds} s (clip loops every ${PAIR_SCENE.seconds} s)\n`);
  describe('All', readings);
  // The loop jumps her back to the left edge: a seek, as far as tracking is concerned.
  describe(
    'First 0.5 s after each loop',
    readings.filter((r) => r.sinceLoop < 0.5 * rate),
  );
  describe(
    'Rest',
    readings.filter((r) => r.sinceLoop >= 0.5 * rate),
  );
}

/**
 * Runs in the page: media times at which a fresh analysis reached the
 * overlay. Between analyses the oval only grows (prediction uncertainty),
 * so a narrower oval than in the previous animation frame marks a new one.
 */
function analysisTimes(duration) {
  return new Promise((resolve) => {
    const video = document.querySelector('#video-pair');
    const canvas = [...document.querySelector('veil-video-layer').shadowRoot.querySelectorAll('canvas')].find(
      (c) => !c.hidden,
    );
    const times = [];
    let previous = null;
    const end = performance.now() + duration;
    const step = () => {
      const [oval] = JSON.parse(canvas.dataset.boxes ?? '[]');
      if (oval) {
        if (previous !== null && oval.w < previous - 0.5) times.push(video.currentTime);
        previous = oval.w;
      }
      if (performance.now() < end) requestAnimationFrame(step);
      else resolve(times);
    };
    requestAnimationFrame(step);
  });
}

function reportGaps(times) {
  // Gaps across the loop point run backwards or span the jump; leave them out.
  const gaps = times
    .slice(1)
    .map((t, i) => (t - times[i]) * 1000)
    .filter((g) => g > 0 && g < 2000)
    .sort((a, b) => a - b);
  if (!gaps.length) return;
  const q = (p) => Math.round(gaps[Math.floor(p * (gaps.length - 1))]);
  console.log(
    `\nAnalyses reaching the overlay: ${times.length}; media time between them: ` +
      `median ${q(0.5)} ms, 90th percentile ${q(0.9)} ms, max ${q(1)} ms`,
  );
}
