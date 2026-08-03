import {Composition} from 'remotion';
import {LogoFormation} from './compositions/LogoFormation';
import {VIDEO} from './timing';

export const RemotionRoot = () => {
  return (
    <Composition
      id="LogoFormation"
      component={LogoFormation}
      durationInFrames={VIDEO.durationInFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
};
