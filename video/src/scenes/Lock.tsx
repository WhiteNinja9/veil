/**
 * "Lock your settings with a passcode, so protection stays on."
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/Caption';
import { Scene } from '../components/Scene';
import { Card, Pill, Row, Switch } from '../components/ui';
import { drift, mix, pop, prog } from '../lib/anim';
import { C, easeInOut, expoOut } from '../theme';
import { wordAt, type SceneTiming } from '../timeline';

export const Lock: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const settings = wordAt(words, 'settings');
  const passcode = wordAt(words, 'passcode');
  const stays = wordAt(words, 'stays');

  const enter = prog(frame, 0, 60, expoOut);
  const float = drift(frame, 101, 0.6) * 6;
  const typedFrom = settings;
  const typedTo = passcode + 16;
  const closed = prog(frame, passcode + 22, 14, easeInOut);
  const snap = pop(frame, passcode + 34, 260, 14);
  const locked = pop(frame, stays - 4, 200, 18);
  const ring = prog(frame, stays - 4, 50, expoOut);

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 120,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Caption words={words} size={76} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: (1920 - 640) / 2,
            top: 420,
            opacity: enter,
            transform: `translateY(${(1 - enter) * 70 + float}px) scale(1.2)`,
            transformOrigin: '50% 0%',
          }}
        >
          <Card style={{ width: 640, overflow: 'hidden', boxShadow: '0 50px 110px -30px rgba(0,0,0,0.85)' }}>
            <div
              style={{
                padding: '38px 40px 30px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: 96,
                  height: 96,
                  borderRadius: 26,
                  background: C.accentSoft,
                  display: 'grid',
                  placeItems: 'center',
                  transform: `scale(${1 + (snap > 0 ? (snap - Math.min(snap, 1)) * 0.6 + Math.sin(Math.min(snap, 1) * Math.PI) * 0.06 : 0)})`,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 26,
                    boxShadow: `0 0 0 ${ring * 26}px rgba(131,135,244,${0.3 * (1 - ring)})`,
                  }}
                />
                <svg
                  width={54}
                  height={54}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={C.accentText}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5.5 11.5h13v8.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5.5 20v-8.5z" />
                  <path d="M12 15.5v2" />
                  <path
                    d="M8.5 11.5V8a3.5 3.5 0 0 1 7 0v3.5"
                    transform={`translate(${mix(2.5, 0, closed)} ${mix(-2.6, 0, closed)})`}
                  />
                </svg>
              </div>
              <div style={{ fontSize: 28, fontWeight: 660, letterSpacing: '-0.02em', marginTop: 22 }}>
                {closed > 0.5 ? 'Settings are locked' : 'Set a passcode'}
              </div>
              <div style={{ fontSize: 16, color: C.text2, marginTop: 6 }}>
                Changes that weaken protection need your passcode.
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 28 }}>
                {Array.from({ length: 6 }, (_, i) => {
                  const at = typedFrom + ((typedTo - typedFrom) * (i + 1)) / 7;
                  const fill = pop(frame, at, 320, 18);
                  return (
                    <div
                      key={i}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: `2px solid ${fill > 0.5 ? C.accent : C.borderStrong}`,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: C.accentText,
                          transform: `scale(${Math.min(fill, 1.25)})`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <Row
              icon="shield"
              label="Protection"
              desc="On · Balanced"
              style={{ padding: '20px 30px' }}
              highlight={locked * (1 - prog(frame, stays + 40, 40))}
            >
              <span
                style={{
                  opacity: Math.min(1, locked),
                  transform: `scale(${mix(0.8, 1, Math.min(locked, 1))})`,
                  display: 'inline-block',
                  marginRight: 12,
                }}
              >
                <Pill tone="accent" icon="lock" scale={1.2}>
                  Locked
                </Pill>
              </span>
              <Switch on={1} scale={1.2} locked={locked > 0.5} />
            </Row>
          </Card>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
