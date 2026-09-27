/**
 * "Even in video, the blur follows them as they move."
 * People walk through a playing video; the blur tracks the ones selected.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/Caption';
import { Icon } from '../components/Icon';
import type { Figure } from '../components/media';
import { bodyBox, RegionPhoto } from '../components/PeoplePhoto';
import { Scene } from '../components/Scene';
import { mix, prog } from '../lib/anim';
import { C, easeInOut, expoOut, FONT, SHADOW_XL } from '../theme';
import { type SceneTiming } from '../timeline';

const W = 1280;
const H = 640;

const WALKERS: (Omit<Figure, 'x' | 'y'> & { x0: number; v: number; phase: number })[] = [
  { x0: 170, v: 1.05, phase: 0, h: 380, who: 'man', clothes: '#3a4456', skin: '#c99a76' },
  {
    x0: 640,
    v: 0.35,
    phase: 1.3,
    h: 360,
    who: 'woman',
    clothes: '#4b5f8a',
    scarf: '#8d6ba8',
    skin: '#e8c4a6',
  },
  { x0: 1080, v: -0.6, phase: 2.1, h: 400, who: 'man', clothes: '#3f6f52', skin: '#f0d2b8' },
];

export const VideoScene: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const enter = prog(frame, 0, 60, expoOut);
  const marks = prog(frame, 20, 30, expoOut);
  const zoom = mix(1, 1.05, prog(frame, 0, t.length, easeInOut));

  const figures: Figure[] = WALKERS.map((w) => ({
    ...w,
    x: w.x0 + w.v * frame,
    y: 594 + Math.abs(Math.sin(frame * 0.16 + w.phase)) * -7,
  }));
  const regions = figures.map((f) => {
    const selected = f.who === 'man' ? 1 : 0;
    const b = bodyBox(f);
    const pad = 10;
    return {
      box: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 },
      blur: selected * prog(frame, 8, 26, easeInOut),
      mark: marks,
      selected,
    };
  });
  const head = 0.34 + frame / 2400;

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: (1920 - W) / 2,
            top: 90,
            borderRadius: 26,
            overflow: 'hidden',
            boxShadow: SHADOW_XL,
            border: '1px solid rgba(255,255,255,0.08)',
            opacity: enter,
            transform: `translateY(${(1 - enter) * 70}px) scale(${zoom})`,
          }}
        >
          <RegionPhoto w={W} h={H} figures={figures} seed={71} pan={-frame * 0.04} regions={regions}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 72%, rgba(0,0,0,0.6) 100%)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 24,
                top: 22,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 14px 7px 10px',
                borderRadius: 999,
                background: 'rgba(22,23,27,0.78)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontFamily: FONT,
                fontSize: 17,
                fontWeight: 600,
                color: '#f5f6f8',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: C.accent,
                  boxShadow: '0 0 10px rgba(131,135,244,0.9)',
                }}
              />
              Blur people · Men
            </div>
            <div
              style={{
                position: 'absolute',
                left: 26,
                right: 26,
                bottom: 22,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <Icon name="pause" size={24} color="#fff" stroke={2.4} />
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  height: 5,
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.25)',
                }}
              >
                <div
                  style={{ width: `${head * 100}%`, height: '100%', borderRadius: 3, background: '#fff' }}
                />
              </div>
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: 17,
                  color: '#fff',
                  fontVariantNumeric: 'tabular-nums',
                  opacity: 0.9,
                }}
              >
                1:{String(Math.floor(12 + frame / 60)).padStart(2, '0')} / 3:40
              </span>
            </div>
          </RegionPhoto>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 800,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Caption words={t.words} size={72} inline />
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
