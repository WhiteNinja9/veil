/**
 * "Choose to blur faces and people. Everyone, only women, or only men."
 * Faces, then people, are found; the blur moves to whoever the choice names.
 */
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/Caption';
import type { Figure } from '../components/media';
import { bodyBox, faceBox, lerpBox, RegionPhoto } from '../components/PeoplePhoto';
import { PEOPLE } from '../components/Popup';
import { Scene } from '../components/Scene';
import { Segmented } from '../components/ui';
import { drift, mix, prog, steps } from '../lib/anim';
import { C, easeInOut, expoOut, FONT, SHADOW_XL } from '../theme';
import { wordAt, type SceneTiming } from '../timeline';

const W = 1040;
const H = 640;
export const FIGURES: Figure[] = [
  { x: 200, y: 610, h: 360, who: 'woman', clothes: '#4b5f8a', scarf: '#8d6ba8', skin: '#e8c4a6' },
  { x: 425, y: 616, h: 392, who: 'man', clothes: '#3f6f52', skin: '#c99a76' },
  { x: 640, y: 612, h: 350, who: 'woman', clothes: '#7f4b5a', scarf: '#d49a6a', skin: '#a8714f' },
  { x: 858, y: 618, h: 382, who: 'man', clothes: '#3a4456', skin: '#f0d2b8' },
];

export const People: React.FC<{ t: SceneTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  const { words } = t;
  const faces = wordAt(words, 'faces');
  const people = wordAt(words, 'people');
  const everyone = wordAt(words, 'everyone');
  const women = wordAt(words, 'women');
  const men = wordAt(words, 'men');

  const enter = prog(frame, 0, 60, expoOut);
  const float = drift(frame, 51, 0.6) * 6;
  const mark = prog(frame, faces - 4, 26, expoOut);
  const toBody = prog(frame, people - 4, 34, easeInOut);
  const choice = steps(frame, [everyone - 2, women - 2, men - 2], [0, 3, 1, 2], 22);
  const control = prog(frame, 20, 50, expoOut);

  const regions = FIGURES.map((f, i) => {
    const isWoman = f.who === 'woman' ? 1 : 0;
    const blur = steps(frame, [everyone, women, men], [0, 1, isWoman, 1 - isWoman], 20, easeInOut);
    return {
      box: lerpBox(faceBox(f), bodyBox(f), toBody),
      blur,
      mark: mark * prog(frame, faces - 4 + i * 4, 20, expoOut),
      selected: blur,
    };
  });

  return (
    <Scene length={t.length}>
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: 130, top: 190, width: 640 }}>
          <Caption words={words} pages={[[0], [1, 2, 3]]} size={76} align="left" dimPast lineHeight={1.12} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 130,
            top: 760,
            opacity: control,
            transform: `translateY(${(1 - control) * 30}px)`,
          }}
        >
          <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 600, color: C.text2, marginBottom: 14 }}>
            Blur people
          </div>
          <Segmented options={PEOPLE} position={choice} width={560} scale={1.7} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 800,
            top: 220,
            borderRadius: 26,
            overflow: 'hidden',
            boxShadow: SHADOW_XL,
            border: '1px solid rgba(255,255,255,0.08)',
            opacity: enter,
            transform: `translateY(${(1 - enter) * 70 + float}px) scale(${mix(0.96, 1, enter)})`,
          }}
        >
          <RegionPhoto w={W} h={H} figures={FIGURES} seed={61} regions={regions} />
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
