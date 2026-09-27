/**
 * "Veil. See what you choose to see. For Chrome and Firefox."
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { BrandIcon } from '../components/Brand';
import { Caption } from '../components/Caption';
import { Icon } from '../components/Icon';
import { Scene } from '../components/Scene';
import { mix, pop, prog } from '../lib/anim';
import { C, easeInOut, expoOut, FONT } from '../theme';
import { wordAt, type SceneTiming } from '../timeline';

export const Outro: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const veil = wordAt(words, 'veil');
  const chrome = wordAt(words, 'chrome');
  const firefox = wordAt(words, 'firefox');

  const icon = pop(frame, veil - 20, 120, 16);
  const draw = prog(frame, veil - 16, 44, easeInOut);
  const name = prog(frame, veil - 4, 30, expoOut);
  const glow = prog(frame, veil - 10, 90, expoOut);
  const shine = prog(frame, veil + 40, 70, easeInOut);
  const push = mix(1.02, 1, prog(frame, 0, t.length, easeInOut));
  const tagline = words.filter((w) => w.line === 1);

  return (
    <Scene length={t.length} exit={false}>
      <AbsoluteFill style={{ display: 'grid', placeItems: 'center', transform: `scale(${push})` }}>
        <div
          style={{
            position: 'absolute',
            width: 1100,
            height: 1100,
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(131,135,244,0.24), rgba(131,135,244,0) 70%)',
            opacity: glow,
            top: -160,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
            <div
              style={{
                opacity: Math.min(1, icon * 1.4),
                transform: `scale(${mix(0.7, 1, icon)})`,
                filter:
                  'drop-shadow(0 30px 50px rgba(0,0,0,0.55)) drop-shadow(0 0 50px rgba(131,135,244,0.25))',
              }}
            >
              <BrandIcon size={170} draw={draw} id="outro" shine={shine > 0 && shine < 1 ? shine : -1} />
            </div>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 170,
                fontWeight: 700,
                letterSpacing: '-0.055em',
                lineHeight: 1,
                color: C.text,
                opacity: name,
                transform: `translateY(${(1 - name) * 30}px)`,
                filter: name < 0.999 ? `blur(${(1 - name) * 20}px)` : undefined,
                paddingBottom: 12,
              }}
            >
              Veil
            </div>
          </div>
          <div style={{ marginTop: 44 }}>
            <Caption words={tagline} size={60} weight={560} color={C.text2} />
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 64 }}>
            {[
              { label: 'Chrome', at: chrome },
              { label: 'Firefox', at: firefox },
            ].map(({ label, at }) => {
              const p = pop(frame, at - 4, 200, 20);
              return (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 26px 14px 20px',
                    borderRadius: 999,
                    background: C.surface,
                    border: `1px solid ${C.borderStrong}`,
                    fontFamily: FONT,
                    fontSize: 28,
                    fontWeight: 600,
                    color: C.text,
                    opacity: Math.min(1, p),
                    transform: `translateY(${(1 - Math.min(p, 1)) * 20}px) scale(${mix(0.85, 1, Math.min(p, 1.1))})`,
                  }}
                >
                  <Icon name="globe" size={28} color={C.accentText} />
                  {label}
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
