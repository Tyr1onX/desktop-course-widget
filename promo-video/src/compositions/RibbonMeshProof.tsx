import {AbsoluteFill} from 'remotion';
import {RibbonWarp} from '../layers/RibbonWarp';
import {RIBBON_PROOF} from '../mesh/ribbonMeshConfig';

export const RibbonMeshProof = () => (
  <AbsoluteFill
    style={{
      alignItems: 'center',
      backgroundColor: RIBBON_PROOF.background,
      justifyContent: 'center',
    }}
  >
    <RibbonWarp />
  </AbsoluteFill>
);
