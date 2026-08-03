import geometry from '../../assets/logo-layers/ribbon-geometry.json';
import {createMesh} from './createMesh';

export const RIBBON_PROOF = {
  fps: 30,
  width: geometry.canvas.width,
  height: geometry.canvas.height,
  durationInFrames: 90,
  lockFrame: 84,
  background: '#F4F6F8',
} as const;

export const RIBBON_LAYER_PATH = 'logo-layers/ribbon-main.png';

export const createRibbonMesh = () =>
  createMesh({
    ...geometry.bounds,
    columns: 28,
    rows: 18,
  });
