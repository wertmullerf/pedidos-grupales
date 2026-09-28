import { Composition, staticFile } from 'remotion';
import { Demo, type DemoProps } from './Demo';
import { H, W } from './layout';
import { FPS, totalFrames, type Timeline } from './timeline';

export function Root() {
  return (
    <Composition
      id="Demo"
      component={Demo}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={FPS * 20}
      defaultProps={{ timeline: null } satisfies DemoProps}
      // La duración sale de la grabación (scripts/record-demo.ts → public/recording/timeline.json).
      calculateMetadata={async () => {
        const timeline = (await (
          await fetch(staticFile('recording/timeline.json'))
        ).json()) as Timeline;
        return { durationInFrames: totalFrames(timeline), props: { timeline } };
      }}
    />
  );
}
