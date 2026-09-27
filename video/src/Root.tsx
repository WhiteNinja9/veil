import { Composition } from 'remotion';
import { Film } from './Film';
import { FPS, HEIGHT, TIMELINE, WIDTH } from './timeline';

/** Scene ranges, exposed so scripts/render.mjs can pick review stills. */
const scenes = TIMELINE.scenes.map(({ id, from, length }) => ({ id, from, length }));

export const Root: React.FC = () => (
  <Composition
    id="VeilShowcase"
    component={Film}
    durationInFrames={TIMELINE.total}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={{ scenes }}
  />
);
