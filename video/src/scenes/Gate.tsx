/**
 * "Veil hides unwanted images and video before they appear on your screen."
 * A feed loads with every image held back (layout intact), each is checked,
 * safe ones appear, one stays protected with the reveal chip.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { ArtKind } from '../components/ArtTile';
import { Caption } from '../components/Caption';
import { Icon } from '../components/Icon';
import { Bar, BrowserWindow, WebImage } from '../components/media';
import { Scene } from '../components/Scene';
import { ProtectedChip } from '../components/ui';
import { drift, mix, pop, prog } from '../lib/anim';
import { C, easeInOut, expoOut } from '../theme';
import { wordAt, type SceneTiming } from '../timeline';

const CARDS: { seed: number; kind: ArtKind; palette: number; unwanted?: boolean; video?: boolean }[] = [
  { seed: 11, kind: 'mountains', palette: 1 },
  { seed: 12, kind: 'sea', palette: 3, video: true },
  { seed: 13, kind: 'city', palette: 7 },
  { seed: 14, kind: 'arches', palette: 2 },
  { seed: 15, kind: 'dunes', palette: 6, unwanted: true },
  { seed: 16, kind: 'garden', palette: 4 },
];

export const Gate: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const before = wordAt(words, 'before');
  const appear = wordAt(words, 'appear');
  const screen = wordAt(words, 'screen');

  const win = prog(frame, 0, 70, expoOut);
  const rotY = mix(-16, -7, prog(frame, 0, t.length, easeInOut));
  const float = drift(frame, 9, 0.6) * 8;

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 130,
            top: 0,
            bottom: 0,
            width: 640,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Caption words={words} size={70} align="left" weight={650} lineHeight={1.12} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 820,
            top: 170,
            perspective: 1800,
          }}
        >
          <div
            style={{
              transform: `translateY(${(1 - win) * 80 + float}px) rotateY(${rotY}deg) rotateX(3deg)`,
              transformOrigin: '0% 50%',
              opacity: win,
            }}
          >
            <BrowserWindow
              width={1000}
              height={720}
              url="dailyfeed.example/today"
              badge="1"
              badgeOpacity={pop(frame, screen + 6)}
            >
              <FeedPage frame={frame} before={before} appear={appear} screen={screen} />
            </BrowserWindow>
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

const FeedPage: React.FC<{ frame: number; before: number; appear: number; screen: number }> = ({
  frame,
  before,
  appear,
  screen,
}) => {
  const IW = 290;
  const IH = 176;
  return (
    <div style={{ padding: '26px 34px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: '#1f2a44' }} />
        <Bar w={120} h={12} color="#2b2f3d" />
        <div style={{ flex: 1 }} />
        <Bar w={60} />
        <Bar w={60} />
        <Bar w={60} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(3, ${IW}px)`, gap: 22 }}>
        {CARDS.map((card, i) => {
          // Each image is checked in turn: a scan line passes, then a verdict.
          const scanStart = before - 20 + i * 7;
          const scan = prog(frame, scanStart, 34, easeInOut);
          const decided = appear - 6 + i * 5;
          const reveal = prog(frame, decided, 26, expoOut);
          const protect = card.unwanted ? 1 : 0;
          const chip = card.unwanted ? pop(frame, screen - 2, 200, 20) : 0;
          return (
            <div key={card.seed}>
              <WebImage
                seed={card.seed}
                kind={card.kind}
                palette={card.palette}
                width={IW}
                height={IH}
                reveal={reveal}
                protect={protect}
                blurPx={30}
              >
                <Shimmer frame={frame} opacity={1 - reveal} />
                {scan > 0 && scan < 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: `${scan * 100}%`,
                      height: 2,
                      background: C.lightAccent,
                      boxShadow: `0 0 18px 4px rgba(83,87,212,0.45)`,
                      opacity: Math.sin(scan * Math.PI),
                    }}
                  />
                )}
                {card.video && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      opacity: reveal,
                    }}
                  >
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: '50%',
                        background: 'rgba(0,0,0,0.45)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <Icon name="play" size={20} color="#fff" style={{ marginLeft: 3 }} />
                    </div>
                  </div>
                )}
                {chip > 0.001 && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      opacity: Math.min(1, chip),
                      transform: `scale(${mix(0.9, 1, chip)})`,
                    }}
                  >
                    <ProtectedChip scale={1.05} />
                  </div>
                )}
              </WebImage>
              <Bar w="88%" h={11} color="#c9cbd3" style={{ marginTop: 14 }} />
              <Bar w="62%" h={9} style={{ marginTop: 9 }} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Gated media keeps its box: a quiet placeholder sheen, no content. */
const Shimmer: React.FC<{ frame: number; opacity: number }> = ({ frame, opacity }) => {
  if (opacity <= 0.001) return null;
  const x = ((frame * 2.2) % 260) - 80;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity,
        background: `linear-gradient(100deg, rgba(255,255,255,0) ${x - 30}%, rgba(255,255,255,0.55) ${x}%, rgba(255,255,255,0) ${x + 30}%)`,
      }}
    />
  );
};
