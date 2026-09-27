/**
 * "You decide how strict it is. Minimal. Balanced. Strict. Or Maximum."
 * The popup's level control follows the voice, word by word.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/Caption';
import { Popup } from '../components/Popup';
import { Scene } from '../components/Scene';
import { drift, mix, prog, steps } from '../lib/anim';
import { easeInOut, expoOut } from '../theme';
import { lineAt, wordAt, type SceneTiming } from '../timeline';

export const Levels: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const at = [
    wordAt(words, 'minimal'),
    wordAt(words, 'balanced'),
    wordAt(words, 'strict', 1),
    wordAt(words, 'maximum'),
  ];
  // Starts on Balanced (the default), then follows each word.
  const level = steps(frame, at, [1, 0, 1, 2, 3], 24);
  const hidden = Math.round(steps(frame, at, [3, 1, 3, 6, 11], 18));
  const enter = prog(frame, 0, 60, expoOut);
  const focus = prog(frame, lineAt(words, 1) - 30, 50, easeInOut);
  const scale = mix(1.62, 1.9, focus);
  const float = drift(frame, 41, 0.6) * 6;

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 150,
            top: 0,
            bottom: 0,
            width: 760,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Caption
            words={words}
            pages={[[0], [1, 2, 3, 4]]}
            size={88}
            align="left"
            dimPast
            lineHeight={1.12}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 1030,
            top: 540,
            transform: `translate(0, ${-50 + mix(0, -14, focus)}%) translateY(${(1 - enter) * 80 + float}px) scale(${scale})`,
            transformOrigin: '0% 50%',
            opacity: enter,
          }}
        >
          <Popup level={level} people={0} hidden={hidden} focus="level" focusAmount={focus} />
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
