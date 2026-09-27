/**
 * The layered V: a translucent stroke behind a solid one, like a veil in
 * front of an image (static/brand/mark.svg and icon.svg).
 */
import { C } from '../theme';

/** Header mark, in the accent colour. `draw` animates each stroke in (0 → 1). */
export const Mark: React.FC<{ size: number; draw?: number; color?: string }> = ({
  size,
  draw = 1,
  color = C.accent,
}) => {
  const a = Math.min(1, draw * 1.6);
  const b = Math.max(0, Math.min(1, draw * 1.6 - 0.6));
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ flex: 'none' }}>
      <path
        d="M15 16 32 49"
        stroke={color}
        strokeOpacity={0.55}
        strokeWidth={9}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - a}
        opacity={a > 0.01 ? 1 : 0}
      />
      <path
        d="M49 16 32 49"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - b}
        opacity={b > 0.01 ? 1 : 0}
      />
    </svg>
  );
};

/** The app icon: the mark on the deep indigo tile. */
export const BrandIcon: React.FC<{ size: number; draw?: number; id?: string; shine?: number }> = ({
  size,
  draw = 1,
  id = 'icon',
  shine = -1,
}) => {
  const a = Math.min(1, draw * 1.6);
  const b = Math.max(0, Math.min(1, draw * 1.6 - 0.6));
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" style={{ flex: 'none', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={C.iconTop} />
          <stop offset="1" stopColor={C.iconBottom} />
        </linearGradient>
        <linearGradient id={`${id}-left`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.markLight} />
          <stop offset="1" stopColor={C.markDeep} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect width="128" height="128" rx="29" />
        </clipPath>
      </defs>
      <rect width="128" height="128" rx="29" fill={`url(#${id}-bg)`} />
      <rect width="128" height="128" rx="29" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
      <path
        d="M34 36 64 94"
        stroke={`url(#${id}-left)`}
        strokeWidth={17}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - a}
        opacity={a > 0.01 ? 1 : 0}
      />
      <path
        d="M94 36 64 94"
        stroke={C.markFront}
        strokeOpacity={0.86}
        strokeWidth={17}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - b}
        opacity={b > 0.01 ? 1 : 0}
      />
      {shine >= 0 && shine <= 1 && (
        <g clipPath={`url(#${id}-clip)`}>
          <rect
            x={-80 + shine * 260}
            y={-40}
            width={60}
            height={220}
            fill={`url(#${id}-shine)`}
            transform={`rotate(20 64 64)`}
          />
        </g>
      )}
    </svg>
  );
};
