/**
 * Scene shell: every cut in the film is a "veil" transition. The outgoing
 * scene softens behind a blur while the next one lifts out of it.
 */
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { mix, prog } from '../lib/anim';
import { easeInOut, expoOut } from '../theme';
import { OVERLAP } from '../timeline';

export const Scene: React.FC<{
  length: number;
  children: ReactNode;
  enter?: boolean;
  exit?: boolean;
  style?: CSSProperties;
}> = ({ length, children, enter = true, exit = true, style }) => {
  const frame = useCurrentFrame();
  const inP = enter ? prog(frame, 0, 40, expoOut) : 1;
  const outP = exit ? prog(frame, length - OVERLAP - 4, OVERLAP + 4, easeInOut) : 0;
  const blur = (1 - inP) * 22 + outP * 22;
  const scale = mix(1.04, 1, inP) * mix(1, 0.97, outP);
  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(inP, 1 - outP),
        transform: `scale(${scale})`,
        filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
