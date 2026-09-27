/**
 * "Soft blur. Pixelate. Or hide it completely. Shown only when you choose."
 * One image cycles through protection styles, then is revealed with a click.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/Caption';
import { Icon } from '../components/Icon';
import { WebImage } from '../components/media';
import { Scene } from '../components/Scene';
import { Cursor, ProtectedChip, Segmented } from '../components/ui';
import { drift, mix, pop, prog, steps } from '../lib/anim';
import { C, easeInOut, expoOut, FONT, SHADOW_XL } from '../theme';
import { wordAt, type SceneTiming } from '../timeline';

const IW = 880;
const IH = 540;
const STYLE_NAMES = ['Soft blur', 'Strong blur', 'Pixelate', 'Solid', 'Placeholder', 'Hide'];

export const Styles: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const soft = wordAt(words, 'soft');
  const pixelate = wordAt(words, 'pixelate');
  const hide = wordAt(words, 'hide');
  const shown = wordAt(words, 'shown');
  const you = wordAt(words, 'you');
  const choose = wordAt(words, 'choose');

  const enter = prog(frame, 0, 60, expoOut);
  const float = drift(frame, 81, 0.6) * 6;
  const protect = prog(frame, soft - 6, 26, easeInOut) * (1 - prog(frame, you + 4, 30, easeInOut));
  const toPixel = prog(frame, pixelate - 4, 22, easeInOut);
  const hidden = prog(frame, hide - 2, 24, easeInOut) * (1 - prog(frame, you + 4, 30, easeInOut));
  const styleIndex = steps(frame, [pixelate - 4, hide - 2], [0, 2, 5], 24);
  const selector = prog(frame, soft - 30, 40, expoOut) * (1 - prog(frame, shown - 10, 30));

  const chip = pop(frame, shown - 4, 200, 20) * (1 - prog(frame, you + 6, 18));
  // The pointer glides to "Show" and presses it on "you".
  const cx = 900 + IW / 2;
  const cy = 170 + IH / 2;
  const arrive = prog(frame, shown + 2, Math.max(12, you - shown - 8), easeInOut);
  const cursorX = mix(cx + 330, cx + 70, arrive);
  const cursorY = mix(cy + 250, cy + 4, arrive);
  const press = prog(frame, you - 5, 5) * (1 - prog(frame, you + 2, 8));
  const cursorOpacity = prog(frame, shown - 4, 14) * (1 - prog(frame, choose + 30, 20));
  const glow = prog(frame, choose - 6, 20) * (1 - prog(frame, choose + 24, 50));

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 130,
            top: 0,
            bottom: 0,
            width: 700,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Caption words={words} pages={[[0, 1, 2], [3]]} size={84} align="left" dimPast lineHeight={1.12} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 900,
            top: 170,
            opacity: enter,
            transform: `translateY(${(1 - enter) * 70 + float}px)`,
          }}
        >
          <div style={{ position: 'relative', width: IW, height: IH }}>
            <WebImage
              seed={91}
              kind="sea"
              palette={0}
              width={IW}
              height={IH}
              radius={24}
              protect={protect}
              blurPx={mix(18, 34, prog(frame, soft + 24, 40))}
              look="blur"
              lookB="pixelate"
              lookMix={toPixel}
              reveal={1 - hidden}
              surface="rgba(255,255,255,0.02)"
              style={{
                boxShadow: `${SHADOW_XL}, 0 0 ${glow * 80}px rgba(131,135,244,${glow * 0.45})`,
              }}
            />
            {/* Hidden: the box keeps its place, nothing shows. */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 24,
                border: `2px dashed rgba(255,255,255,${0.16 * hidden})`,
                display: 'grid',
                placeItems: 'center',
                opacity: hidden,
              }}
            >
              <Icon
                name="eyeOff"
                size={64}
                color="rgba(255,255,255,0.28)"
                stroke={1.5}
                style={{ opacity: 1 - Math.min(1, chip) }}
              />
            </div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                opacity: Math.min(1, chip),
                transform: `translateY(56px) scale(${mix(0.9, 1, Math.min(1, chip))})`,
              }}
            >
              <ProtectedChip scale={1.7} press={press} />
            </div>
          </div>
          <div
            style={{
              marginTop: 34,
              opacity: selector,
              transform: `translateY(${(1 - selector) * 20}px)`,
            }}
          >
            <div
              style={{ fontFamily: FONT, fontSize: 20, fontWeight: 600, color: C.text2, marginBottom: 12 }}
            >
              Protection style
            </div>
            <Segmented options={STYLE_NAMES} position={styleIndex} width={IW} scale={1.45} />
          </div>
        </div>
        <Cursor x={cursorX} y={cursorY + 56} press={press} opacity={cursorOpacity} />
      </AbsoluteFill>
    </Scene>
  );
};
