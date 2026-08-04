import {Composition} from 'remotion';
import {LogoAssemblyProof} from './compositions/LogoAssemblyProof';
import {LogoFormation} from './compositions/LogoFormation';
import {RibbonMeshProof} from './compositions/RibbonMeshProof';
import {RIBBON_PROOF} from './mesh/ribbonMeshConfig';
import {VIDEO} from './timing';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="LogoFormation"
        component={LogoFormation}
        durationInFrames={VIDEO.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="RibbonMeshProof"
        component={RibbonMeshProof}
        durationInFrames={RIBBON_PROOF.durationInFrames}
        fps={RIBBON_PROOF.fps}
        width={RIBBON_PROOF.width}
        height={RIBBON_PROOF.height}
      />
      <Composition
        id="LogoAssemblyProof"
        component={LogoAssemblyProof}
        durationInFrames={RIBBON_PROOF.durationInFrames}
        fps={RIBBON_PROOF.fps}
        width={RIBBON_PROOF.width}
        height={RIBBON_PROOF.height}
      />
    </>
  );
};
