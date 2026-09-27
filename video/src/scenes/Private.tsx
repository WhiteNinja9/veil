/**
 * "And it all happens on your device. Nothing is uploaded. No servers. No accounts. No tracking."
 * The Privacy Center, row by row, each state landing on its word.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/Caption';
import { Icon, type IconName } from '../components/Icon';
import { Scene } from '../components/Scene';
import { Card, Pill, Row } from '../components/ui';
import { drift, mix, pop, prog } from '../lib/anim';
import { C, easeInOut, expoOut, FONT } from '../theme';
import { wordAt, type SceneTiming } from '../timeline';

export const Private: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const rows: { icon: IconName; label: string; state: string; tone: 'positive' | 'neutral'; at: number }[] = [
    {
      icon: 'device',
      label: 'On-device processing',
      state: 'On',
      tone: 'positive',
      at: wordAt(words, 'device'),
    },
    {
      icon: 'upload',
      label: 'Image & video uploads',
      state: 'Never',
      tone: 'neutral',
      at: wordAt(words, 'uploaded'),
    },
    {
      icon: 'cloudOff',
      label: 'Cloud processing',
      state: 'Off',
      tone: 'neutral',
      at: wordAt(words, 'servers'),
    },
    { icon: 'user', label: 'Account', state: 'Not required', tone: 'neutral', at: wordAt(words, 'accounts') },
    {
      icon: 'chart',
      label: 'Analytics & telemetry',
      state: 'Off',
      tone: 'neutral',
      at: wordAt(words, 'tracking'),
    },
    {
      icon: 'history',
      label: 'Browsing history',
      state: 'Not collected',
      tone: 'neutral',
      at: wordAt(words, 'tracking') + 10,
    },
  ];

  const card = prog(frame, 4, 60, expoOut);
  const float = drift(frame, 31, 0.6) * 7;
  const rotY = mix(12, 5, prog(frame, 0, t.length, easeInOut));

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 130,
            top: 0,
            bottom: 0,
            width: 760,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Caption words={words} pages={[[0, 1], [2], [3, 4, 5]]} size={82} align="left" dimPast />
        </div>
        <div style={{ position: 'absolute', right: 150, top: 150, perspective: 1600 }}>
          <div
            style={{
              opacity: card,
              transform: `translateY(${(1 - card) * 70 + float}px) rotateY(${rotY}deg)`,
              transformOrigin: '100% 50%',
            }}
          >
            <Card style={{ width: 720, boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)', overflow: 'hidden' }}>
              <div style={{ padding: '28px 26px 22px', display: 'flex', gap: 16, alignItems: 'center' }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: C.accentSoft,
                    color: C.accentText,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <Icon name="shield" size={28} />
                </div>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 660, letterSpacing: '-0.02em' }}>
                    Privacy Center
                  </div>
                  <div style={{ fontSize: 15, color: C.text2, marginTop: 3 }}>
                    What Veil knows about you — which is as little as possible.
                  </div>
                </div>
              </div>
              {rows.map((row) => {
                const on = pop(frame, row.at - 2, 190, 18);
                const flash = prog(frame, row.at - 2, 12) * (1 - prog(frame, row.at + 16, 40));
                return (
                  <Row
                    key={row.label}
                    icon={row.icon}
                    label={row.label}
                    highlight={flash}
                    style={{ padding: '17px 26px' }}
                  >
                    <div style={{ minWidth: 120, display: 'flex', justifyContent: 'flex-end' }}>
                      <span
                        style={{
                          opacity: Math.min(1, on),
                          transform: `scale(${mix(0.7, 1, Math.min(on, 1.2))})`,
                          display: 'inline-block',
                        }}
                      >
                        <Pill
                          tone={row.tone}
                          icon={row.tone === 'positive' ? 'check' : undefined}
                          scale={1.2}
                        >
                          {row.state}
                        </Pill>
                      </span>
                      <span
                        style={{
                          position: 'absolute',
                          right: 0,
                          opacity: 1 - Math.min(1, on),
                          fontFamily: FONT,
                          color: C.text3,
                          fontSize: 15,
                        }}
                      >
                        —
                      </span>
                    </div>
                  </Row>
                );
              })}
            </Card>
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
