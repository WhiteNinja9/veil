/**
 * The stage: Veil's dark background with two slow indigo glows, a vignette
 * and a fine grain (which also keeps the dark gradients from banding).
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { drift } from '../lib/anim';
import { C } from '../theme';

export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const ax = 30 + drift(frame, 1, 0.5) * 14;
  const ay = 24 + drift(frame, 2, 0.5) * 10;
  const bx = 74 + drift(frame, 3, 0.4) * 12;
  const by = 78 + drift(frame, 4, 0.4) * 10;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          background: [
            `radial-gradient(60% 55% at ${ax}% ${ay}%, rgba(83, 87, 212, 0.20) 0%, rgba(83, 87, 212, 0) 70%)`,
            `radial-gradient(55% 60% at ${bx}% ${by}%, rgba(125, 130, 242, 0.13) 0%, rgba(125, 130, 242, 0) 70%)`,
            `radial-gradient(90% 80% at 50% 50%, rgba(18, 19, 24, 0) 40%, rgba(5, 6, 9, 0.85) 100%)`,
          ].join(', '),
        }}
      />
    </AbsoluteFill>
  );
};

/** Fine grain on top of everything, rendered at half resolution. */
export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.09 }}>
      <svg width={960} height={540} style={{ width: '100%', height: '100%' }}>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={2}
            seed={frame % 24}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};
