/**
 * Veil's controls, recreated from src/ui/styles/components.css (dark theme)
 * with continuous inputs, so every state change can be animated per frame.
 */
import type { CSSProperties, ReactNode } from 'react';
import { mix } from '../lib/anim';
import { C, FONT } from '../theme';
import { Mark } from './Brand';
import { Icon, type IconName } from './Icon';

function blend(a: string, b: string, t: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return `rgb(${Math.round(mix(ar!, br!, t))}, ${Math.round(mix(ag!, bg!, t))}, ${Math.round(mix(ab!, bb!, t))})`;
}
export { blend };

/** `.switch--lg`: `on` is 0 (off) … 1 (on). */
export const Switch: React.FC<{ on: number; scale?: number; locked?: boolean }> = ({
  on,
  scale = 1,
  locked,
}) => (
  <div
    style={{
      position: 'relative',
      width: 50 * scale,
      height: 30 * scale,
      borderRadius: 999,
      background: blend(C.toggleOff, C.accent, on),
      boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.35)',
      flex: 'none',
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: 2 * scale,
        left: 2 * scale,
        width: 26 * scale,
        height: 26 * scale,
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.12)',
        transform: `translateX(${on * 20 * scale}px)`,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {locked && <Icon name="lock" size={14 * scale} color={C.onAccent} stroke={2.2} />}
    </div>
  </div>
);

/** `.segmented`: `position` is the (fractional) index of the selected option. */
export const Segmented: React.FC<{
  options: string[];
  position: number;
  width: number;
  scale?: number;
  opacity?: number;
}> = ({ options, position, width, scale = 1, opacity = 1 }) => {
  const pad = 3 * scale;
  const gap = 2 * scale;
  const optionWidth = (width - pad * 2 - gap * (options.length - 1)) / options.length;
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        gap,
        padding: pad,
        width,
        borderRadius: 12 * scale,
        background: C.surface2,
        boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.35)',
        fontFamily: FONT,
        opacity,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: pad,
          bottom: pad,
          left: pad + position * (optionWidth + gap),
          width: optionWidth,
          borderRadius: 9 * scale,
          background: C.surface3,
          boxShadow: '0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      />
      {options.map((label, i) => {
        const selected = Math.max(0, 1 - Math.abs(position - i));
        return (
          <div
            key={label}
            style={{
              position: 'relative',
              width: optionWidth,
              height: 30 * scale,
              display: 'grid',
              placeItems: 'center',
              fontSize: 13 * scale,
              fontWeight: 540 + selected * 80,
              color: blend(C.text2, C.text, selected),
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
};

type Tone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: C.surface3, fg: C.text2 },
  accent: { bg: C.accentSoft, fg: C.accentText },
  positive: { bg: C.positiveSoft, fg: C.positive },
  caution: { bg: C.cautionSoft, fg: C.caution },
  critical: { bg: C.criticalSoft, fg: C.critical },
};

export const Pill: React.FC<{
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
  scale?: number;
  style?: CSSProperties;
}> = ({ tone = 'neutral', icon, children, scale = 1, style }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5 * scale,
      height: 22 * scale,
      padding: `0 ${9 * scale}px`,
      borderRadius: 999,
      background: TONES[tone].bg,
      color: TONES[tone].fg,
      fontFamily: FONT,
      fontSize: 12 * scale,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    {icon && <Icon name={icon} size={13 * scale} stroke={2} />}
    {children}
  </span>
);

export const Card: React.FC<{ children: ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      background: C.surface,
      boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
      fontFamily: FONT,
      color: C.text,
      ...style,
    }}
  >
    {children}
  </div>
);

/** In-page reveal chip (src/content/render/chip-styles.ts). */
export const ProtectedChip: React.FC<{ scale?: number; press?: number; label?: string; action?: string }> = ({
  scale = 1,
  press = 0,
  label = 'Protected',
  action = 'Show',
}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8 * scale,
      padding: `${5 * scale}px ${5 * scale}px ${5 * scale}px ${10 * scale}px`,
      borderRadius: 999,
      background: 'rgba(22, 23, 27, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.28), 0 1px 2px rgba(0,0,0,0.2)',
      color: '#f5f6f8',
      fontFamily: FONT,
      fontSize: 12.5 * scale,
      fontWeight: 500,
      whiteSpace: 'nowrap',
    }}
  >
    <Mark size={16 * scale} color="#b9bcff" />
    <span style={{ fontWeight: 600 }}>{label}</span>
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 26 * scale,
        padding: `0 ${11 * scale}px`,
        borderRadius: 999,
        background: `rgba(255,255,255,${0.14 + press * 0.14})`,
        fontWeight: 600,
        transform: `scale(${1 - press * 0.04})`,
      }}
    >
      {action}
    </span>
  </div>
);

/** A pointer, for moments where the viewer should see a click. */
export const Cursor: React.FC<{ x: number; y: number; press?: number; opacity?: number }> = ({
  x,
  y,
  press = 0,
  opacity = 1,
}) => (
  <svg
    width={30}
    height={30}
    viewBox="0 0 24 24"
    style={{
      position: 'absolute',
      left: x,
      top: y,
      opacity,
      transform: `scale(${1 - press * 0.12})`,
      transformOrigin: '4px 3px',
      filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.45))',
      overflow: 'visible',
    }}
  >
    <path
      d="M4 2.5v17.2l4.7-4.4 3 6.6 3.1-1.4-3-6.4h6.4L4 2.5z"
      fill="#fff"
      stroke="#15161c"
      strokeWidth={1.3}
      strokeLinejoin="round"
    />
  </svg>
);

/** Row with a label, optional description and a trailing control. */
export const Row: React.FC<{
  icon?: IconName;
  label: string;
  desc?: string;
  children?: ReactNode;
  highlight?: number;
  style?: CSSProperties;
}> = ({ icon, label, desc, children, highlight = 0, style }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '14px 20px',
      borderTop: `1px solid ${C.border}`,
      background: `rgba(131, 135, 244, ${highlight * 0.08})`,
      ...style,
    }}
  >
    {icon && (
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          background: C.surface2,
          color: C.text2,
          flex: 'none',
        }}
      >
        <Icon name={icon} size={18} />
      </div>
    )}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 560, color: C.text }}>{label}</div>
      {desc && <div style={{ fontSize: 13, color: C.text2, marginTop: 2 }}>{desc}</div>}
    </div>
    {children}
  </div>
);
