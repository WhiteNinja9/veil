/**
 * The toolbar popup (src/popup/Popup.tsx), dark theme, with animatable
 * level and people selectors.
 */
import type { CSSProperties } from 'react';
import { C, FONT } from '../theme';
import { Mark } from './Brand';
import { Icon } from './Icon';
import { Pill, Segmented, Switch } from './ui';

export const LEVELS = ['Minimal', 'Balanced', 'Strict', 'Maximum'];
export const LEVEL_DESC = [
  'Only clearly explicit content. The fewest interruptions.',
  'Explicit and clearly suggestive content. Right for most people.',
  'Also borderline content. Anything Veil can’t check stays hidden.',
  'Hides anything questionable. Expect more safe images to be hidden too.',
];
export const PEOPLE = ['Off', 'Women', 'Men', 'Everyone'];

export const Popup: React.FC<{
  level: number;
  people: number;
  hidden?: number;
  checked?: number;
  style?: CSSProperties;
  focus?: 'level' | 'people';
  focusAmount?: number;
}> = ({ level, people, hidden = 3, checked = 48, style, focus, focusAmount = 0 }) => {
  const descIndex = Math.round(level);
  const descFade = 1 - Math.min(1, Math.abs(level - descIndex) * 2.2);
  const dimFor = (section: 'level' | 'people' | 'other') =>
    focus && section !== focus ? 1 - focusAmount * 0.55 : 1;
  return (
    <div
      style={{
        width: 360,
        padding: 14,
        borderRadius: 18,
        background: C.bg,
        border: '1px solid rgba(255,255,255,0.1)',
        fontFamily: FONT,
        color: C.text,
        boxShadow: '0 50px 120px -30px rgba(0,0,0,0.9), 0 0 0 1px rgba(0,0,0,0.4)',
        ...style,
      }}
    >
      <div style={{ opacity: dimFor('other') }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 12px' }}>
          <Mark size={20} />
          <span style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>Veil</span>
          <div style={{ flex: 1 }} />
          <Icon name="settings" size={18} color={C.text2} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 14,
            background: C.positiveSoft,
            marginBottom: 10,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 620 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: C.positive,
                  boxShadow: `0 0 0 3px rgba(63,203,145,0.2)`,
                }}
              />
              Protection is on
            </div>
            <div style={{ fontSize: 12.5, color: C.text2, marginTop: 3 }}>
              {LEVELS[descIndex]} · on this device
            </div>
          </div>
          <Switch on={1} />
        </div>
        <div
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            background: C.surface,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: C.surface3,
                display: 'grid',
                placeItems: 'center',
                fontSize: 13,
                fontWeight: 650,
                color: C.text2,
              }}
            >
              D
            </div>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>dailyfeed.example</div>
            <Pill>Default level</Pill>
          </div>
          <div style={{ fontSize: 11.5, color: C.text3, margin: '12px 0 6px', fontWeight: 560 }}>
            On this page
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              [checked, 'Checked'],
              [hidden, 'Hidden'],
              [2, 'Videos'],
            ].map(([value, label]) => (
              <div
                key={label}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 10, background: C.surface2 }}
              >
                <div style={{ fontSize: 20, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
                  {value}
                </div>
                <div style={{ fontSize: 11.5, color: C.text2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ padding: '0 2px', opacity: dimFor('level') }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text2, marginBottom: 7 }}>Protection level</div>
        <Segmented options={LEVELS} position={level} width={328} />
        <div
          style={{
            position: 'relative',
            height: 38,
            marginTop: 8,
            fontSize: 12.5,
            color: C.text2,
            lineHeight: 1.4,
          }}
        >
          <div style={{ opacity: descFade }}>{LEVEL_DESC[descIndex]}</div>
        </div>
      </div>
      <div style={{ padding: '0 2px 4px', opacity: dimFor('people') }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text2, margin: '8px 0 7px' }}>Blur people</div>
        <Segmented options={PEOPLE} position={people} width={328} />
      </div>
    </div>
  );
};
