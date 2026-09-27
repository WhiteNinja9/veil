/**
 * Procedural "photos": landscapes, dunes, sea, city, arches and gardens,
 * drawn as vector art from a seed. The film never shows a real image, and
 * nothing sensitive: whatever sits behind a blur is just scenery.
 */
import type { CSSProperties } from 'react';
import { random } from 'remotion';

const PALETTES = [
  // sky top, sky bottom, far, mid, near, light
  ['#1d2046', '#e8927c', '#6b5b95', '#4a3f75', '#2c2550', '#ffd3a5'], // dusk
  ['#9fb8e6', '#f6d6c2', '#8ea3c9', '#6c7fa8', '#4a5a80', '#fff1d6'], // dawn
  ['#f0bf8a', '#f8e6cc', '#d8955b', '#c07a45', '#9c5d33', '#fff4de'], // desert
  ['#0e3a56', '#57b5c9', '#1f6f8b', '#155a73', '#0c3d52', '#d9f6ff'], // ocean
  ['#b9d8c2', '#eef4e4', '#5f8f6e', '#3f6f52', '#24503a', '#fdf7e3'], // valley
  ['#0b0d24', '#2c3170', '#1e2250', '#161a3e', '#0e1130', '#c8ccff'], // night
  ['#f3c6c9', '#fbe7e1', '#c98a95', '#a86a78', '#7f4b5a', '#fff6f0'], // rose
  ['#2a3140', '#8e9bb0', '#4b566b', '#3a4456', '#262d3a', '#e9eef5'], // slate
] as const;

export type ArtKind = 'mountains' | 'dunes' | 'sea' | 'city' | 'arches' | 'garden';
const KINDS: ArtKind[] = ['mountains', 'dunes', 'sea', 'city', 'arches', 'garden'];

interface ArtTileProps {
  seed: number;
  kind?: ArtKind;
  palette?: number;
  style?: CSSProperties;
  /** Horizontal parallax of the layers, in view units (-1 … 1). */
  pan?: number;
}

function ridge(r: (k: string) => number, key: string, base: number, amp: number, steps: number, pan: number) {
  const pts: string[] = [`${-10 + pan} 100`];
  for (let i = 0; i <= steps; i++) {
    const x = -10 + (i / steps) * 180 + pan;
    const y = base - amp * (0.35 + 0.65 * r(`${key}${i}`));
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  pts.push(`${170 + pan} 100`);
  return pts.join(' ');
}

export const ArtTile: React.FC<ArtTileProps> = ({ seed, kind, palette, style, pan = 0 }) => {
  const r = (k: string) => random(`art-${seed}-${k}`);
  const k = kind ?? KINDS[Math.floor(r('kind') * KINDS.length)]!;
  const p = PALETTES[(palette ?? Math.floor(r('pal') * PALETTES.length)) % PALETTES.length]!;
  const id = `art-${seed}`;
  const sunX = 30 + r('sx') * 100;
  const sunY = 22 + r('sy') * 18;

  return (
    <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" style={{ display: 'block', ...style }}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p[0]} />
          <stop offset="1" stopColor={p[1]} />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor={p[5]} stopOpacity="1" />
          <stop offset="0.35" stopColor={p[5]} stopOpacity="0.9" />
          <stop offset="1" stopColor={p[5]} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p[2]} />
          <stop offset="1" stopColor={p[4]} />
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill={`url(#${id}-sky)`} />

      {k === 'mountains' && (
        <>
          <circle cx={sunX} cy={sunY} r={22} fill={`url(#${id}-sun)`} />
          <polygon points={ridge(r, 'a', 62, 30, 7, pan * 0.3)} fill={p[2]} opacity={0.85} />
          <polygon points={ridge(r, 'b', 76, 26, 9, pan * 0.6)} fill={p[3]} />
          <polygon points={ridge(r, 'c', 92, 18, 6, pan)} fill={p[4]} />
        </>
      )}

      {k === 'dunes' && (
        <>
          <circle cx={sunX} cy={sunY + 6} r={20} fill={`url(#${id}-sun)`} />
          <path
            d={`M-10 70 C 30 ${52 + r('d1') * 8}, 70 ${76 - r('d2') * 6}, 170 58 V100 H-10Z`}
            fill={p[2]}
          />
          <path
            d={`M-10 84 C 40 ${66 + r('d3') * 8}, 100 ${88 - r('d4') * 6}, 170 72 V100 H-10Z`}
            fill={p[3]}
          />
          <path d={`M-10 96 C 50 84, 110 98, 170 88 V100 H-10Z`} fill={p[4]} />
        </>
      )}

      {k === 'sea' && (
        <>
          <circle cx={sunX} cy={48} r={24} fill={`url(#${id}-sun)`} />
          <rect y="58" width="160" height="42" fill={`url(#${id}-sea)`} />
          {Array.from({ length: 7 }, (_, i) => (
            <rect
              key={i}
              x={sunX - 10 + r(`w${i}`) * 8 - i * 1.2 + pan * 0.4}
              y={62 + i * 5}
              width={14 + i * 2.4}
              height={0.9}
              rx={0.45}
              fill={p[5]}
              opacity={0.55 - i * 0.06}
            />
          ))}
          <polygon points={ridge(r, 'isl', 60, 6, 5, pan * 0.2)} fill={p[3]} opacity={0.5} />
        </>
      )}

      {k === 'city' && (
        <>
          <circle cx={sunX} cy={sunY + 10} r={26} fill={`url(#${id}-sun)`} opacity={0.8} />
          {Array.from({ length: 13 }, (_, i) => {
            const w = 9 + r(`bw${i}`) * 8;
            const h = 26 + r(`bh${i}`) * 44;
            const x = i * 12.6 - 6 + pan * 0.5;
            return (
              <g key={i}>
                <rect x={x} y={100 - h} width={w} height={h} fill={i % 2 ? p[3] : p[4]} />
                {Array.from({ length: Math.floor(h / 7) }, (_, j) =>
                  r(`win${i}-${j}`) > 0.45 ? (
                    <rect
                      key={j}
                      x={x + 2}
                      y={100 - h + 3 + j * 7}
                      width={w - 4}
                      height={1.6}
                      fill={p[5]}
                      opacity={0.45}
                    />
                  ) : null,
                )}
              </g>
            );
          })}
        </>
      )}

      {k === 'arches' && (
        <>
          <rect width="160" height="100" fill={p[1]} opacity={0.7} />
          {[0, 1, 2, 3].map((i) => {
            const x = 8 + i * 38 + pan * 0.4;
            return (
              <g key={i}>
                <path d={`M${x} 100 V48 A15 15 0 0 1 ${x + 30} 48 V100 Z`} fill={p[3]} />
                <path d={`M${x + 4} 100 V50 A11 11 0 0 1 ${x + 26} 50 V100 Z`} fill={p[4]} />
                <path
                  d={`M${x + 4} 100 V50 A11 11 0 0 1 ${x + 26} 50 V100 Z`}
                  fill={`url(#${id}-sun)`}
                  opacity={0.35}
                />
              </g>
            );
          })}
          <rect y="88" width="160" height="12" fill={p[2]} opacity={0.9} />
        </>
      )}

      {k === 'garden' && (
        <>
          <circle cx={sunX} cy={sunY} r={20} fill={`url(#${id}-sun)`} />
          <rect y="70" width="160" height="30" fill={p[3]} />
          {Array.from({ length: 11 }, (_, i) => {
            const x = i * 15 + r(`tx${i}`) * 6 + pan * 0.7;
            const h = 22 + r(`th${i}`) * 18;
            return (
              <g key={i}>
                <rect x={x - 0.8} y={72 - h * 0.25} width={1.6} height={h * 0.3} fill={p[4]} />
                <ellipse
                  cx={x}
                  cy={72 - h * 0.45}
                  rx={5 + r(`tr${i}`) * 3}
                  ry={h * 0.32}
                  fill={i % 2 ? p[2] : p[4]}
                />
              </g>
            );
          })}
          <rect y="84" width="160" height="16" fill={p[4]} opacity={0.9} />
        </>
      )}
    </svg>
  );
};
