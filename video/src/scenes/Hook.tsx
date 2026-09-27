/**
 * "Every day, the web shows you thousands of images. You never chose most of them."
 * An endless wall of images streams past in perspective, then slows and dims.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ArtTile } from '../components/ArtTile';
import { Caption } from '../components/Caption';
import { Scene } from '../components/Scene';
import { mix, prog } from '../lib/anim';
import { easeInOut, expoOut } from '../theme';
import { lineAt, wordAt, type SceneTiming } from '../timeline';

const COLS = 8;
const ROWS = 16;
const TW = 300;
const TH = 196;
const GAP = 24;

export const Hook: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const thousands = wordAt(words, 'thousands');
  const never = lineAt(words, 2);

  // Scroll position: steady, a rush on "thousands", easing off on "never".
  const scroll =
    frame * 1.5 +
    420 * prog(frame, thousands - 30, 110, easeInOut) -
    160 * prog(frame, never, 140, expoOut) +
    Math.max(0, frame - never) * -0.9;
  const dim = prog(frame, never - 6, 70, easeInOut);
  const tilt = mix(34, 26, prog(frame, 0, 300, easeInOut));
  const zoom = mix(1.08, 0.94, prog(frame, 0, t.length, easeInOut));

  return (
    <Scene length={t.length} enter={false}>
      <AbsoluteFill style={{ perspective: 1400, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: COLS * (TW + GAP),
            height: ROWS * (TH + GAP),
            transform: `translate(-50%, -38%) rotateX(${tilt}deg) rotateZ(-9deg) scale(${zoom})`,
            transformStyle: 'preserve-3d',
            filter: `saturate(${1 - dim * 0.75}) brightness(${1 - dim * 0.6})`,
          }}
        >
          {Array.from({ length: ROWS * COLS }, (_, i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const span = ROWS * (TH + GAP);
            // Columns scroll at slightly different speeds, wrapping around.
            const speed = 1 + ((col * 37) % 5) * 0.06;
            let y = row * (TH + GAP) - scroll * speed + (col % 2) * 90;
            y = ((y % span) + span) % span;
            const appear = prog(frame, 4 + ((col * 7 + row * 3) % 23) * 2, 40, expoOut);
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: col * (TW + GAP),
                  top: y - (TH + GAP),
                  width: TW,
                  height: TH,
                  borderRadius: 18,
                  overflow: 'hidden',
                  opacity: appear,
                  transform: `translateZ(${(1 - appear) * -300}px)`,
                  boxShadow: '0 20px 40px -20px rgba(0,0,0,0.6)',
                }}
              >
                <ArtTile seed={i * 7 + 3} style={{ width: TW, height: TH }} />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {/* Edges fall into darkness; a pool of shade keeps the words legible. */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(58% 46% at 50% 50%, rgba(13,14,18,0.86) 0%, rgba(13,14,18,0.55) 55%, rgba(13,14,18,0) 100%), linear-gradient(180deg, #0d0e12 0%, rgba(13,14,18,0) 22%, rgba(13,14,18,0) 70%, #0d0e12 100%)',
        }}
      />
      <AbsoluteFill style={{ display: 'grid', placeItems: 'center' }}>
        <Caption
          words={words}
          pages={[
            [0, 1],
            [2, 3],
          ]}
          size={100}
          weight={660}
        />
      </AbsoluteFill>
    </Scene>
  );
};
