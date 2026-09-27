import type { Page } from '@playwright/test';
import { PAIR_SCENE } from '../../lab/png.mjs';
import { expect, setSettings, test, waitForVeil } from './fixtures';

/**
 * Region blurring in playing video: the lab "pair" clip has a woman walking
 * across while a man stands still. The overlay's boxes are read in frame
 * coordinates together with the video's current time, and compared with
 * where each person is at that moment.
 */
const { face, woman, man, seconds } = PAIR_SCENE;
const womanCentreAt = (t: number) =>
  woman.x0 + (woman.x1 - woman.x0) * ((t % seconds) / seconds) + face.w / 2;
const manCentre = man.x + face.w / 2;
const faceCentreY = face.y + face.h / 2;

async function readBoxes(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#video-pair')!;
    const rect = video.getBoundingClientRect();
    // object-fit: contain — the 16:9 frame is letterboxed in the 4:3 element.
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const fw = video.videoWidth * scale;
    const fh = video.videoHeight * scale;
    const fx = rect.left + (rect.width - fw) / 2;
    const fy = rect.top + (rect.height - fh) / 2;
    const root = document.querySelector('veil-video-layer')?.shadowRoot;
    // The overlay has a canvas per video; development builds list its boxes (canvas pixels).
    const canvas = [...(root?.querySelectorAll('canvas') ?? [])].find((c) => {
      const r = c.getBoundingClientRect();
      return !c.hidden && Math.abs(r.left - rect.left) < 2 && Math.abs(r.top - rect.top) < 2;
    });
    const origin = canvas?.getBoundingClientRect();
    const boxes = (
      JSON.parse(canvas?.dataset.boxes ?? '[]') as { x: number; y: number; w: number; h: number }[]
    ).map((b) => ({
      cx: (origin!.left + b.x + b.w / 2 - fx) / fw,
      cy: (origin!.top + b.y + b.h / 2 - fy) / fh,
    }));
    return { t: video.currentTime, boxes };
  });
}

/** Waits until the loop is in its middle part, away from the jump back to the start. */
async function midLoop(page: Page) {
  await page.waitForFunction(
    (length) => {
      const t = document.querySelector<HTMLVideoElement>('#video-pair')!.currentTime % length;
      return t > 0.8 && t < 4.6;
    },
    seconds,
    { timeout: 15_000 },
  );
}

const regionSettings = (who: 'women' | 'men') => ({
  categories: { faces: { enabled: true, threshold: 0.75, scope: 'regions' }, people: { enabled: false } },
  peopleFilter: { who, unsure: 'reveal' },
  video: { peopleInVideos: true },
});

test.describe('video regions', () => {
  test('blurs only the woman, following her as she moves', async ({ context, lab }) => {
    await setSettings(context, regionSettings('women'));
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#video-pair', 'rg', 15_000);
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      await midLoop(page);
      const { t, boxes } = await readBoxes(page);
      expect(boxes, `at ${t.toFixed(2)} s`).toHaveLength(1);
      expect(Math.abs(boxes[0]!.cx - womanCentreAt(t)), `woman at ${t.toFixed(2)} s`).toBeLessThan(0.1);
      expect(Math.abs(boxes[0]!.cy - faceCentreY)).toBeLessThan(0.12);
      seen.push(boxes[0]!.cx);
      await page.waitForTimeout(700);
    }
    // She moved, and the box moved with her.
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.03);
  });

  test('blurs only the man when men are chosen', async ({ context, lab }) => {
    await setSettings(context, regionSettings('men'));
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#video-pair', 'rg', 15_000);
    for (let i = 0; i < 2; i++) {
      await midLoop(page);
      const { t, boxes } = await readBoxes(page);
      expect(boxes, `at ${t.toFixed(2)} s`).toHaveLength(1);
      expect(Math.abs(boxes[0]!.cx - manCentre)).toBeLessThan(0.08);
      await page.waitForTimeout(700);
    }
  });

  test('the box holds a blurred copy of the frame, never the sharp picture', async ({ context, lab }) => {
    await setSettings(context, regionSettings('men'));
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#video-pair', 'rg', 15_000);
    await expect.poll(async () => (await readBoxes(page)).boxes.length, { timeout: 10_000 }).toBe(1);
    const { overlay, frame } = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('#video-pair')!;
      const rect = video.getBoundingClientRect();
      const root = document.querySelector('veil-video-layer')!.shadowRoot!;
      const canvas = [...root.querySelectorAll('canvas')].find(
        (c) => !c.hidden && Math.abs(c.getBoundingClientRect().left - rect.left) < 2,
      )!;
      const [box] = JSON.parse(canvas.dataset.boxes!) as { x: number; y: number; w: number; h: number }[];
      const y = Math.round(box!.y + box!.h / 2);
      const x0 = Math.round(box!.x + box!.w * 0.15);
      const width = Math.round(box!.w * 0.7);
      // The largest step between neighbouring pixels across the middle of the box.
      const steepest = (data: Uint8ClampedArray) => {
        let most = 0;
        for (let i = 4; i < data.length; i += 4)
          for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(data[i + c]! - data[i - 4 + c]!));
        return most;
      };
      const row = canvas.getContext('2d')!.getImageData(x0, y, width, 1).data;
      const opaque = [...row].filter((_, i) => i % 4 === 3).every((a) => a === 255);
      // The same row of the picture itself, drawn at the same size.
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const scale = Math.min(copy.width / video.videoWidth, copy.height / video.videoHeight);
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(
        video,
        (copy.width - video.videoWidth * scale) / 2,
        (copy.height - video.videoHeight * scale) / 2,
        video.videoWidth * scale,
        video.videoHeight * scale,
      );
      return {
        overlay: { opaque, steepest: steepest(row) },
        frame: { steepest: steepest(ctx.getImageData(x0, y, width, 1).data) },
      };
    });
    // The picture has hard face edges; the painted box has none, and nothing shows through it.
    expect(frame.steepest).toBeGreaterThan(60);
    expect(overlay.opaque).toBe(true);
    expect(overlay.steepest).toBeLessThan(20);
  });

  test('a paused video keeps its boxes still, and seeking re-checks the new frame', async ({
    context,
    lab,
  }) => {
    await setSettings(context, regionSettings('women'));
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#video-pair', 'rg', 15_000);
    await midLoop(page);
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('#video-pair')!.pause());
    await page.waitForTimeout(400);
    const first = await readBoxes(page);
    await page.waitForTimeout(600);
    const second = await readBoxes(page);
    expect(second.boxes).toEqual(first.boxes);

    // Seek while paused: the box follows to where she is in the new frame.
    await page.evaluate(() => {
      document.querySelector<HTMLVideoElement>('#video-pair')!.currentTime = 4.2;
    });
    await expect
      .poll(
        async () => {
          const { t, boxes } = await readBoxes(page);
          return boxes.length === 1 && Math.abs(boxes[0]!.cx - womanCentreAt(t)) < 0.08;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test('revealing the video removes the boxes, hiding restores them', async ({ context, lab }) => {
    await setSettings(context, { ...regionSettings('women'), reveal: { mode: 'click', confirm: false } });
    const page = await context.newPage();
    await page.goto(`${lab.originA}/people.html`);
    await waitForVeil(page, '#video-pair', 'rg', 15_000);
    await page.hover('#video-pair');
    const chip = page.locator('veil-layer .chip');
    await chip.getByRole('button', { name: 'Show' }).click();
    await waitForVeil(page, '#video-pair', 'r');
    await expect.poll(async () => (await readBoxes(page)).boxes.length).toBe(0);
    await page.hover('#video-pair');
    await chip.getByRole('button', { name: 'Hide again' }).click();
    await expect.poll(async () => (await readBoxes(page)).boxes.length, { timeout: 10_000 }).toBe(1);
  });
});
