/**
 * Web media under Veil: the browser, images in each protection state, and
 * the people illustrations used for region protection.
 */
import type { CSSProperties, ReactNode } from 'react';
import { mix } from '../lib/anim';
import { C, FONT, SHADOW_XL } from '../theme';
import { ArtTile, type ArtKind } from './ArtTile';
import { BrandIcon } from './Brand';
import { Icon } from './Icon';

/**
 * Pixelate filters, built exactly like the extension's (src/content/dom.ts):
 * sample one pixel per tile, then dilate it to fill the tile.
 */
export const PixelateDefs: React.FC<{ tiles?: number[] }> = ({ tiles = [14, 22, 34] }) => (
  <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
    <defs>
      {tiles.map((tile) => {
        const half = Math.floor(tile / 2);
        return (
          <filter
            key={tile}
            id={`px-${tile}`}
            x="0"
            y="0"
            width="1"
            height="1"
            colorInterpolationFilters="sRGB"
          >
            <feFlood x={half} y={half} width="1" height="1" />
            <feComposite width={tile} height={tile} />
            <feTile result="grid" />
            <feComposite in="SourceGraphic" in2="grid" operator="in" />
            <feMorphology operator="dilate" radius={half} />
          </filter>
        );
      })}
    </defs>
  </svg>
);

export type Look = 'blur' | 'pixelate' | 'placeholder';

interface WebImageProps {
  seed: number;
  kind?: ArtKind;
  palette?: number;
  width: number;
  height: number;
  radius?: number;
  /** 0: gated (hidden, layout kept) … 1: visible. */
  reveal?: number;
  /** 0: shown … 1: fully protected. */
  protect?: number;
  look?: Look;
  /** Crossfade between two looks: 0 = `look`, 1 = `lookB`. */
  lookB?: Look;
  lookMix?: number;
  blurPx?: number;
  pan?: number;
  surface?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export const WebImage: React.FC<WebImageProps> = ({
  seed,
  kind,
  palette,
  width,
  height,
  radius = 12,
  reveal = 1,
  protect = 0,
  look = 'blur',
  lookB,
  lookMix = 0,
  blurPx = 26,
  pan = 0,
  surface = C.lightSurface3,
  children,
  style,
}) => {
  const art = (extra?: CSSProperties) => (
    <ArtTile seed={seed} kind={kind} palette={palette} pan={pan} style={{ width, height, ...extra }} />
  );
  const layer = (l: Look, amount: number, weight: number) => {
    if (weight <= 0.001) return null;
    const common: CSSProperties = { position: 'absolute', inset: 0, opacity: weight };
    if (l === 'blur') {
      return (
        <div key="blur" style={common}>
          {art({
            filter:
              amount > 0.001
                ? `blur(${amount * blurPx}px) saturate(${1 - amount * 0.3}) brightness(${1 - amount * 0.08})`
                : undefined,
            transform: `scale(${1 + amount * 0.14})`,
          })}
        </div>
      );
    }
    if (l === 'pixelate') {
      return (
        <div key="px" style={{ ...common }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 1 - amount }}>{art()}</div>
          <div style={{ position: 'absolute', inset: 0, opacity: amount, filter: 'url(#px-34) blur(2px)' }}>
            {art()}
          </div>
        </div>
      );
    }
    return (
      <div key="ph" style={common}>
        <div style={{ position: 'absolute', inset: 0, opacity: 1 - amount }}>{art()}</div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: C.veilSurface,
            opacity: amount,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name="eyeOff" size={Math.min(56, width * 0.2)} color="#8f929c" stroke={1.6} />
        </div>
      </div>
    );
  };
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: radius,
        overflow: 'hidden',
        background: surface,
        flex: 'none',
        ...style,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, opacity: reveal }}>
        {layer(look, protect, lookB ? 1 - lookMix : 1)}
        {lookB && layer(lookB, protect, lookMix)}
      </div>
      {children}
    </div>
  );
};

/** A browser window: dark chrome, light page. */
export const BrowserWindow: React.FC<{
  width: number;
  height: number;
  url: string;
  badge?: string;
  badgeOpacity?: number;
  children: ReactNode;
  style?: CSSProperties;
  pageBg?: string;
}> = ({ width, height, url, badge, badgeOpacity = 1, children, style, pageBg = C.lightBg }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 16,
      overflow: 'hidden',
      background: '#1b1c22',
      border: '1px solid rgba(255,255,255,0.10)',
      boxShadow: SHADOW_XL,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: FONT,
      ...style,
    }}
  >
    <div
      style={{ height: 58, display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px', flex: 'none' }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c, opacity: 0.9 }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, color: '#6e717d', marginLeft: 8 }}>
        <Icon name="arrowLeft" size={18} />
        <Icon name="refresh" size={18} />
      </div>
      <div
        style={{
          flex: 1,
          height: 34,
          borderRadius: 999,
          background: '#121318',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 14px',
          color: C.text2,
          fontSize: 14,
        }}
      >
        <Icon name="lock" size={14} color="#7c7f8c" />
        <span style={{ color: C.text }}>{url.split('/')[0]}</span>
        <span style={{ color: '#6e717d' }}>
          {url.includes('/') ? `/${url.split('/').slice(1).join('/')}` : ''}
        </span>
      </div>
      <div style={{ position: 'relative', width: 26, height: 26 }}>
        <BrandIcon size={26} id="toolbar" />
        {badge && (
          <div
            style={{
              position: 'absolute',
              right: -7,
              bottom: -5,
              minWidth: 17,
              height: 15,
              padding: '0 4px',
              borderRadius: 5,
              background: C.accent,
              color: C.onAccent,
              fontSize: 10,
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
              opacity: badgeOpacity,
              transform: `scale(${mix(0.6, 1, badgeOpacity)})`,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {badge}
          </div>
        )}
      </div>
    </div>
    <div style={{ position: 'relative', flex: 1, background: pageBg, overflow: 'hidden' }}>{children}</div>
  </div>
);

/** Skeleton text bar for web pages. */
export const Bar: React.FC<{ w: number | string; h?: number; color?: string; style?: CSSProperties }> = ({
  w,
  h = 10,
  color = '#dcdde3',
  style,
}) => <div style={{ width: w, height: h, borderRadius: h / 2, background: color, ...style }} />;

// ── People ────────────────────────────────────────────────────────────────

export type Presentation = 'woman' | 'man';

export interface Figure {
  x: number; // centre, in the scene's px
  y: number; // feet
  h: number; // height
  who: Presentation;
  clothes: string;
  skin: string;
  scarf?: string;
}

/** Faceless, modest figures: a woman in a headscarf, a man with short hair. */
export const Person: React.FC<{ f: Figure }> = ({ f }) => {
  const s = f.h / 100;
  const headR = 9.5 * s;
  const headCy = f.y - 84 * s;
  return (
    <g>
      {/* body */}
      <path
        d={`M${f.x - 17 * s} ${f.y} L${f.x - 16 * s} ${f.y - 58 * s} Q${f.x - 15 * s} ${f.y - 71 * s} ${f.x} ${f.y - 72 * s}
            Q${f.x + 15 * s} ${f.y - 71 * s} ${f.x + 16 * s} ${f.y - 58 * s} L${f.x + 17 * s} ${f.y} Z`}
        fill={f.clothes}
      />
      {f.who === 'woman' ? (
        <>
          <path
            d={`M${f.x - 13 * s} ${f.y - 62 * s} Q${f.x - 15 * s} ${headCy - 16 * s} ${f.x} ${headCy - 13.5 * s}
                Q${f.x + 15 * s} ${headCy - 16 * s} ${f.x + 13 * s} ${f.y - 62 * s} Q${f.x} ${f.y - 58 * s} ${f.x - 13 * s} ${f.y - 62 * s} Z`}
            fill={f.scarf ?? '#6b5b95'}
          />
          <ellipse cx={f.x} cy={headCy + 1 * s} rx={headR * 0.78} ry={headR * 0.92} fill={f.skin} />
        </>
      ) : (
        <>
          <rect x={f.x - 4 * s} y={headCy + 6 * s} width={8 * s} height={8 * s} fill={f.skin} />
          <circle cx={f.x} cy={headCy} r={headR} fill={f.skin} />
          <path
            d={`M${f.x - headR * 0.98} ${headCy - 1.5 * s} A${headR} ${headR} 0 0 1 ${f.x + headR * 0.98} ${headCy - 1.5 * s}
                Q${f.x + headR * 0.55} ${headCy - headR * 0.62} ${f.x} ${headCy - headR * 0.7}
                Q${f.x - headR * 0.55} ${headCy - headR * 0.62} ${f.x - headR * 0.98} ${headCy - 1.5 * s} Z`}
            fill="#2b2622"
          />
        </>
      )}
    </g>
  );
};

/** Bounding boxes, in scene px. */
export function faceBox(f: Figure) {
  const s = f.h / 100;
  return { x: f.x - 15 * s, y: f.y - 100 * s, w: 30 * s, h: 30 * s };
}
export function bodyBox(f: Figure) {
  const s = f.h / 100;
  return { x: f.x - 21 * s, y: f.y - 101 * s, w: 42 * s, h: 104 * s };
}
