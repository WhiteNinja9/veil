/**
 * A photo of people with region protection: a copy of the picture, blurred,
 * shown only inside each selected person's box (as the engine renders it).
 */
import type { ReactNode } from 'react';
import { mix } from '../lib/anim';
import { C } from '../theme';
import { ArtTile } from './ArtTile';
import { bodyBox, faceBox, type Figure, Person } from './media';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const lerpBox = (a: Box, b: Box, t: number): Box => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  w: mix(a.w, b.w, t),
  h: mix(a.h, b.h, t),
});

export const Picture: React.FC<{ w: number; h: number; figures: Figure[]; seed: number; pan?: number }> = ({
  w,
  h,
  figures,
  seed,
  pan = 0,
}) => (
  <>
    <ArtTile
      seed={seed}
      kind="garden"
      palette={4}
      pan={pan}
      style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }}
    />
    <svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }}>
      {figures.map((f, i) => (
        <Person key={i} f={f} />
      ))}
    </svg>
  </>
);

export interface Region {
  box: Box;
  /** 0 … 1 blur */
  blur: number;
  /** 0 … 1 brackets */
  mark: number;
  selected: number;
}

export const RegionPhoto: React.FC<{
  w: number;
  h: number;
  figures: Figure[];
  seed: number;
  pan?: number;
  regions: Region[];
  children?: ReactNode;
}> = ({ w, h, figures, seed, pan, regions, children }) => (
  <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden' }}>
    <Picture w={w} h={h} figures={figures} seed={seed} pan={pan} />
    {regions.map((r, i) =>
      r.blur > 0.002 ? (
        <div
          key={`b${i}`}
          style={{
            position: 'absolute',
            left: r.box.x,
            top: r.box.y,
            width: r.box.w,
            height: r.box.h,
            overflow: 'hidden',
            borderRadius: 18,
            opacity: Math.min(1, r.blur * 1.6),
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: -r.box.x,
              top: -r.box.y,
              width: w,
              height: h,
              filter: `blur(${6 + r.blur * 16}px) saturate(0.85)`,
            }}
          >
            <Picture w={w} h={h} figures={figures} seed={seed} pan={pan} />
          </div>
        </div>
      ) : null,
    )}
    <svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      {regions.map((r, i) =>
        r.mark > 0.002 ? <Brackets key={`m${i}`} box={r.box} p={r.mark} selected={r.selected} /> : null,
      )}
    </svg>
    {children}
  </div>
);

const Brackets: React.FC<{ box: Box; p: number; selected: number }> = ({ box, p, selected }) => {
  const len = Math.min(26, box.w * 0.3);
  const grow = mix(12, 0, p);
  const { x, y, w, h } = { x: box.x - grow, y: box.y - grow, w: box.w + grow * 2, h: box.h + grow * 2 };
  const color = selected > 0.5 ? C.accentText : '#ffffff';
  const d = [
    `M${x} ${y + len} V${y} H${x + len}`,
    `M${x + w - len} ${y} H${x + w} V${y + len}`,
    `M${x} ${y + h - len} V${y + h} H${x + len}`,
    `M${x + w - len} ${y + h} H${x + w} V${y + h - len}`,
  ].join(' ');
  return (
    <path
      d={d}
      stroke={color}
      strokeWidth={4}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={p * mix(0.55, 1, selected)}
      style={{ filter: selected > 0.5 ? 'drop-shadow(0 0 8px rgba(131,135,244,0.8))' : undefined }}
    />
  );
};

export { bodyBox, faceBox };
