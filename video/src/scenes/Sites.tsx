/**
 * "Pause a site, make it stricter, or block it. Strict Browsing enforces
 * SafeSearch on major search engines."
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/Caption';
import { Icon, type IconName } from '../components/Icon';
import { Scene } from '../components/Scene';
import { Card, Pill, Row, Switch } from '../components/ui';
import { drift, mix, pop, prog } from '../lib/anim';
import { C, easeInOut, expoOut } from '../theme';
import { lineAt, wordAt, type SceneTiming } from '../timeline';

const ENGINES = ['Google', 'Bing', 'DuckDuckGo', 'Yahoo', 'Brave Search', 'Yandex'];

export const Sites: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const pause = wordAt(words, 'pause');
  const stricter = wordAt(words, 'stricter');
  const block = wordAt(words, 'block');
  const strictLine = lineAt(words, 3);
  const safe = wordAt(words, 'safesearch');
  const engines = wordAt(words, 'engines');

  const enterA = prog(frame, 0, 60, expoOut);
  const swap = prog(frame, strictLine - 18, 34, easeInOut);
  const enterB = prog(frame, strictLine - 8, 40, expoOut);
  const float = drift(frame, 91, 0.6) * 6;
  const toggle = prog(frame, strictLine + 6, 16, easeInOut);

  const rules: {
    host: string;
    letter: string;
    at: number;
    state: string;
    tone: 'neutral' | 'accent' | 'caution';
    icon: IconName;
    desc: string;
  }[] = [
    {
      host: 'news.example.com',
      letter: 'N',
      at: pause,
      state: 'Paused · 1 hour',
      tone: 'neutral',
      icon: 'pause',
      desc: 'Resumes automatically',
    },
    {
      host: 'forum.example.net',
      letter: 'F',
      at: stricter,
      state: 'Strict',
      tone: 'accent',
      icon: 'shield',
      desc: 'Its own level',
    },
    {
      host: 'unwanted.example',
      letter: 'U',
      at: block,
      state: 'Blocked',
      tone: 'caution',
      icon: 'ban',
      desc: 'Never opens',
    },
  ];

  const cardStyle = {
    width: 740,
    boxShadow: '0 40px 90px -30px rgba(0,0,0,0.8)',
    overflow: 'hidden' as const,
  };

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 130,
            top: 0,
            bottom: 0,
            width: 780,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Caption
            words={words}
            pages={[
              [0, 1, 2],
              [3, 4, 5],
            ]}
            size={80}
            align="left"
            dimPast
            lineHeight={1.12}
          />
        </div>

        {/* Site rules */}
        <div
          style={{
            position: 'absolute',
            right: 150,
            top: 290,
            opacity: enterA * (1 - swap),
            transform: `translateY(${(1 - enterA) * 70 + float}px) translateX(${-swap * 60}px) scale(${mix(1, 0.94, swap)})`,
            filter: swap > 0.01 ? `blur(${swap * 14}px)` : undefined,
          }}
        >
          <Card style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '24px 26px 18px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 26, fontWeight: 660, letterSpacing: '-0.02em' }}>Sites</div>
                <div style={{ fontSize: 15, color: C.text2, marginTop: 3 }}>
                  Rules for the sites you choose.
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 16px',
                  borderRadius: 10,
                  background: C.accent,
                  color: C.onAccent,
                  fontSize: 15,
                  fontWeight: 620,
                }}
              >
                <Icon name="plus" size={17} stroke={2.2} /> Add site
              </div>
            </div>
            {rules.map((rule) => {
              const on = pop(frame, rule.at - 2, 200, 19);
              const flash = prog(frame, rule.at - 2, 10) * (1 - prog(frame, rule.at + 14, 40));
              return (
                <Row
                  key={rule.host}
                  label={rule.host}
                  desc={on > 0.5 ? rule.desc : 'Default level'}
                  highlight={flash}
                  style={{ padding: '18px 26px' }}
                >
                  <div
                    style={{
                      position: 'relative',
                      minWidth: 190,
                      display: 'flex',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <span style={{ opacity: 1 - Math.min(1, on), position: 'absolute', right: 0 }}>
                      <Pill scale={1.25}>Default</Pill>
                    </span>
                    <span
                      style={{
                        opacity: Math.min(1, on),
                        transform: `scale(${mix(0.7, 1, Math.min(on, 1.15))})`,
                        display: 'inline-block',
                      }}
                    >
                      <Pill tone={rule.tone} icon={rule.icon} scale={1.25}>
                        {rule.state}
                      </Pill>
                    </span>
                  </div>
                </Row>
              );
            })}
          </Card>
        </div>

        {/* Strict Browsing */}
        <div
          style={{
            position: 'absolute',
            right: 150,
            top: 250,
            opacity: enterB,
            transform: `translateY(${(1 - enterB) * 60 + float}px) scale(${mix(1.04, 1, enterB)})`,
            filter: enterB < 0.99 ? `blur(${(1 - enterB) * 14}px)` : undefined,
          }}
        >
          <Card style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '26px 26px 20px' }}>
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
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 26, fontWeight: 660, letterSpacing: '-0.02em' }}>Strict Browsing</div>
                <div style={{ fontSize: 15, color: C.text2, marginTop: 3 }}>
                  SafeSearch, Restricted Mode and a higher floor.
                </div>
              </div>
              <Switch on={toggle} scale={1.3} />
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 10,
                padding: '6px 26px 18px',
              }}
            >
              {ENGINES.map((name, i) => {
                const on = pop(frame, safe - 4 + i * 5, 200, 19);
                return (
                  <div
                    key={name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                      borderRadius: 12,
                      background: C.surface2,
                      border: `1px solid ${on > 0.5 ? 'rgba(63,203,145,0.25)' : 'transparent'}`,
                    }}
                  >
                    <Icon name="search" size={19} color={C.text2} />
                    <span style={{ flex: 1, fontSize: 17, fontWeight: 580 }}>{name}</span>
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        background: C.positiveSoft,
                        color: C.positive,
                        opacity: Math.min(1, on),
                        transform: `scale(${Math.min(on, 1.2)})`,
                      }}
                    >
                      <Icon name="check" size={16} stroke={2.4} />
                    </span>
                  </div>
                );
              })}
            </div>
            <Row icon="video" label="YouTube Restricted Mode" style={{ padding: '16px 26px 20px' }}>
              <span style={{ opacity: Math.min(1, pop(frame, engines)), display: 'inline-block' }}>
                <Pill tone="positive" icon="check" scale={1.25}>
                  On
                </Pill>
              </span>
            </Row>
          </Card>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
