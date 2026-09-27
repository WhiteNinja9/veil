/**
 * The Veil showcase film: scenes laid on the narration's timeline, the
 * voice, and the stage. Voice only, no music.
 */
import { AbsoluteFill, Html5Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Backdrop, Grain } from './components/Backdrop';
import { PixelateDefs } from './components/media';
import { prog } from './lib/anim';
import { easeInOut } from './theme';
import { TIMELINE, type SceneTiming } from './timeline';
import { Gate } from './scenes/Gate';
import { Hook } from './scenes/Hook';
import { Levels } from './scenes/Levels';
import { Lock } from './scenes/Lock';
import { Meet } from './scenes/Meet';
import { Outro } from './scenes/Outro';
import { People } from './scenes/People';
import { Private } from './scenes/Private';
import { Scan } from './scenes/Scan';
import { Sites } from './scenes/Sites';
import { Styles } from './scenes/Styles';
import { VideoScene } from './scenes/VideoScene';

const SCENES: Record<string, React.FC<{ t: SceneTiming }>> = {
  hook: Hook,
  meet: Meet,
  gate: Gate,
  scan: Scan,
  private: Private,
  levels: Levels,
  people: People,
  video: VideoScene,
  styles: Styles,
  sites: Sites,
  lock: Lock,
  outro: Outro,
};

export const Film: React.FC<{ scenes: { id: string; from: number; length: number }[] }> = () => {
  const frame = useCurrentFrame();
  const fadeIn = prog(frame, 0, 36, easeInOut);
  const fadeOut = prog(frame, TIMELINE.total - 40, 40, easeInOut);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <AbsoluteFill style={{ opacity: fadeIn * (1 - fadeOut) }}>
        <Backdrop />
        <PixelateDefs />
        {TIMELINE.scenes.map((scene) => {
          const Component = SCENES[scene.id];
          if (!Component) throw new Error(`No scene component for "${scene.id}"`);
          return (
            <Sequence key={scene.id} from={scene.from} durationInFrames={scene.length} name={scene.id}>
              <Component t={scene} />
            </Sequence>
          );
        })}
        <Grain />
      </AbsoluteFill>
      {TIMELINE.scenes.map((scene) => (
        <Sequence
          key={`voice-${scene.id}`}
          from={scene.audio.at}
          durationInFrames={scene.audio.trimAfter - scene.audio.trimBefore}
          name={`voice: ${scene.id}`}
          layout="none"
        >
          <Html5Audio
            src={staticFile(scene.audio.src)}
            trimBefore={scene.audio.trimBefore}
            trimAfter={scene.audio.trimAfter}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
