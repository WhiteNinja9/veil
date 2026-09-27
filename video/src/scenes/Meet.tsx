/**
 * "Meet Veil." The layered V draws itself on the icon tile; the name lifts in.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { BrandIcon } from '../components/Brand';
import { Scene } from '../components/Scene';
import { drift, mix, pop, prog } from '../lib/anim';
import { C, easeInOut, expoOut, FONT } from '../theme';
import { wordAt, type SceneTiming } from '../timeline';

export const Meet: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const meet = wordAt(t.words, 'meet');
  const veil = wordAt(t.words, 'veil');

  const tile = pop(frame, meet - 16, 120, 16);
  const draw = prog(frame, meet - 4, 46, easeInOut);
  const name = prog(frame, veil - 4, 30, expoOut);
  const small = prog(frame, meet - 4, 24, expoOut);
  const shine = prog(frame, veil + 16, 60, easeInOut);
  const glow = prog(frame, meet, 60, expoOut);
  const float = drift(frame, 5, 0.6) * 6;
  const push = mix(1, 1.06, prog(frame, 0, t.length, easeInOut));

  return (
    <Scene length={t.length}>
      <AbsoluteFill style={{ display: 'grid', placeItems: 'center', transform: `scale(${push})` }}>
        <div
          style={{
            position: 'absolute',
            width: 900,
            height: 900,
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(131,135,244,0.30), rgba(131,135,244,0) 70%)',
            opacity: glow,
            transform: `translateX(-190px) scale(${mix(0.6, 1, glow)})`,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 64, transform: `translateY(${float}px)` }}>
          <div
            style={{
              transform: `scale(${mix(0.72, 1, tile)}) rotate(${(1 - tile) * -8}deg)`,
              opacity: Math.min(1, tile * 1.4),
              filter:
                'drop-shadow(0 40px 60px rgba(0,0,0,0.55)) drop-shadow(0 0 60px rgba(131,135,244,0.25))',
            }}
          >
            <BrandIcon size={300} draw={draw} id="meet" shine={shine > 0 && shine < 1 ? shine : -1} />
          </div>
          <div style={{ fontFamily: FONT, color: C.text }}>
            <div
              style={{
                fontSize: 46,
                fontWeight: 520,
                color: C.text2,
                letterSpacing: '-0.01em',
                opacity: small,
                transform: `translateY(${(1 - small) * 18}px)`,
                filter: small < 0.999 ? `blur(${(1 - small) * 10}px)` : undefined,
                marginBottom: 6,
                marginLeft: 6,
              }}
            >
              Meet
            </div>
            <div
              style={{
                fontSize: 220,
                fontWeight: 700,
                letterSpacing: '-0.055em',
                lineHeight: 0.9,
                backgroundImage: `linear-gradient(180deg, #ffffff 0%, #eceef3 50%, #c9cbff 100%)`,
                WebkitBackgroundClip: 'text',
                color: 'transparent',
                opacity: name,
                transform: `translateY(${(1 - name) * 40}px)`,
                filter: name < 0.999 ? `blur(${(1 - name) * 22}px)` : undefined,
                paddingBottom: 20,
              }}
            >
              Veil
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
