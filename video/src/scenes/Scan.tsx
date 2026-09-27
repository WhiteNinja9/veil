/**
 * "The moment a page loads, it checks each image, and each video as it plays."
 * An image is examined under a reticle; a playing video is sampled frame by frame.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ArtTile } from '../components/ArtTile';
import { Caption } from '../components/Caption';
import { Icon } from '../components/Icon';
import { WebImage } from '../components/media';
import { Scene } from '../components/Scene';
import { Pill } from '../components/ui';
import { drift, mix, pop, prog } from '../lib/anim';
import { C, easeInOut, expoOut, FONT, SHADOW_LG } from '../theme';
import { lineAt, wordAt, type SceneTiming } from '../timeline';

export const Scan: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const loads = wordAt(words, 'loads');
  const image = wordAt(words, 'image');
  const video = wordAt(words, 'video');
  const plays = wordAt(words, 'plays');

  const load = prog(frame, 6, loads + 10, easeInOut);
  const imgIn = prog(frame, lineAt(words, 1) - 16, 40, expoOut);
  const vidIn = prog(frame, lineAt(words, 2) - 16, 40, expoOut);
  const reticle = prog(frame, image - 4, 30, expoOut);
  const sweep = prog(frame, image + 6, 60, easeInOut);
  const verdict = pop(frame, image + 58);
  const play = Math.max(0, frame - (video - 6));
  const head = prog(frame, video - 6, t.length - video, (x) => x);
  const float1 = drift(frame, 21, 0.7) * 6;
  const float2 = drift(frame, 22, 0.7) * 6;

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            top: 120,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Caption words={words} pages={[[0], [1], [2, 3]]} size={74} />
        </div>
        {/* Page load progress */}
        <div
          style={{
            position: 'absolute',
            left: 260,
            right: 260,
            top: 300,
            height: 3,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.06)',
            opacity: 1 - prog(frame, loads + 30, 30),
          }}
        >
          <div
            style={{
              width: `${load * 100}%`,
              height: '100%',
              borderRadius: 2,
              background: `linear-gradient(90deg, ${C.accent}, ${C.accentText})`,
              boxShadow: `0 0 16px rgba(131,135,244,0.6)`,
            }}
          />
        </div>

        {/* Image under examination */}
        <div
          style={{
            position: 'absolute',
            left: 250,
            top: 380,
            opacity: imgIn,
            transform: `translateY(${(1 - imgIn) * 60 + float1}px) scale(${mix(0.94, 1, imgIn)})`,
          }}
        >
          <WebImage
            seed={31}
            kind="mountains"
            palette={0}
            width={620}
            height={420}
            radius={20}
            style={{ boxShadow: SHADOW_LG }}
          >
            {/* Scan sweep */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(180deg, rgba(131,135,244,0) ${sweep * 100 - 18}%, rgba(131,135,244,0.28) ${sweep * 100}%, rgba(131,135,244,0) ${sweep * 100 + 0.5}%)`,
                opacity: sweep > 0 && sweep < 1 ? 1 : 0,
              }}
            />
          </WebImage>
          <Reticle w={620} h={420} p={reticle} done={verdict} />
          <div
            style={{
              position: 'absolute',
              left: 20,
              bottom: 20,
              opacity: Math.min(1, verdict),
              transform: `translateY(${(1 - Math.min(1, verdict)) * 10}px)`,
            }}
          >
            <Pill tone="positive" icon="check" scale={1.5} style={{ background: 'rgba(14, 40, 30, 0.85)' }}>
              Checked on this device
            </Pill>
          </div>
        </div>

        {/* Video, sampled as it plays */}
        <div
          style={{
            position: 'absolute',
            left: 950,
            top: 380,
            width: 720,
            opacity: vidIn,
            transform: `translateY(${(1 - vidIn) * 60 + float2}px) scale(${mix(0.94, 1, vidIn)})`,
          }}
        >
          <div
            style={{
              position: 'relative',
              width: 720,
              height: 405,
              borderRadius: 20,
              overflow: 'hidden',
              boxShadow: SHADOW_LG,
            }}
          >
            <ArtTile
              seed={32}
              kind="sea"
              palette={3}
              pan={-play * 0.05}
              style={{ width: 720, height: 405 }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(180deg, rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 22,
                bottom: 18,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                color: '#fff',
              }}
            >
              <Icon name="pause" size={22} color="#fff" stroke={2.4} />
              <span
                style={{ fontFamily: FONT, fontSize: 16, fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}
              >
                0:{String(8 + Math.floor(head * 6)).padStart(2, '0')}
              </span>
            </div>
          </div>
          {/* Sampled frames along the timeline */}
          <div style={{ position: 'relative', height: 40, marginTop: 20 }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 18,
                height: 4,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.08)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                width: `${head * 100}%`,
                top: 18,
                height: 4,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.28)',
              }}
            />
            {Array.from({ length: 12 }, (_, i) => {
              const at = (i + 0.5) / 12;
              const hit = head >= at;
              const since = hit ? frame - (video - 6 + at * (t.length - video)) : -1;
              const ring = hit ? prog(since, 0, 24, expoOut) : 0;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: `${at * 100}%`,
                    top: 20,
                    width: 12,
                    height: 12,
                    marginLeft: -6,
                    marginTop: -6,
                    borderRadius: '50%',
                    background: hit ? C.accent : C.surface3,
                    boxShadow: hit
                      ? `0 0 0 ${ring * 8}px rgba(131,135,244,${0.35 * (1 - ring)}), 0 0 12px rgba(131,135,244,0.6)`
                      : 'none',
                  }}
                />
              );
            })}
            <div
              style={{
                position: 'absolute',
                left: `${head * 100}%`,
                top: 8,
                width: 3,
                height: 24,
                marginLeft: -1.5,
                borderRadius: 2,
                background: '#fff',
                opacity: prog(frame, plays - 40, 20),
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

/** Focus brackets that close in on the image. */
const Reticle: React.FC<{ w: number; h: number; p: number; done: number }> = ({ w, h, p, done }) => {
  const inset = mix(-40, 14, p);
  const len = 44;
  const color = done > 0.5 ? C.positive : C.accentText;
  const corner = (x: number, y: number, sx: number, sy: number) => (
    <path
      d={`M${x} ${y + sy * len} V${y} H${x + sx * len}`}
      stroke={color}
      strokeWidth={4}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  return (
    <svg
      width={w}
      height={h}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'visible',
        opacity: p * (1 - Math.max(0, done - 1) * 0),
      }}
    >
      {corner(inset, inset, 1, 1)}
      {corner(w - inset, inset, -1, 1)}
      {corner(inset, h - inset, 1, -1)}
      {corner(w - inset, h - inset, -1, -1)}
    </svg>
  );
};
