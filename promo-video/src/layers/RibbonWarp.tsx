import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {drawMesh} from '../mesh/drawMesh';
import {
  createRibbonMesh,
  RIBBON_LAYER_PATH,
  RIBBON_PROOF,
} from '../mesh/ribbonMeshConfig';
import {warpMesh} from '../mesh/warpMath';

export const RibbonWarp = () => {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceMesh = useMemo(() => createRibbonMesh(), []);
  const [texture, setTexture] = useState<HTMLImageElement | null>(null);
  const [renderHandle] = useState(() => delayRender('Loading ribbon pixel layer'));

  useEffect(() => {
    let active = true;
    const image = new Image();

    image.onload = () => {
      if (!active) {
        return;
      }

      setTexture(image);
      continueRender(renderHandle);
    };
    image.onerror = () => {
      cancelRender(
        new Error(
          `Unable to load ${RIBBON_LAYER_PATH}. Run npm run assets:logo before rendering.`,
        ),
      );
    };
    image.src = staticFile(RIBBON_LAYER_PATH);

    return () => {
      active = false;
    };
  }, [renderHandle]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !texture) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      cancelRender(new Error('The browser did not provide a 2D canvas context.'));
      return;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    if (frame >= RIBBON_PROOF.lockFrame) {
      context.drawImage(texture, 0, 0);
      return;
    }

    const warpedMesh = warpMesh(sourceMesh, frame, RIBBON_PROOF);
    drawMesh(context, texture, warpedMesh);
  }, [frame, sourceMesh, texture]);

  return (
    <canvas
      ref={canvasRef}
      width={RIBBON_PROOF.width}
      height={RIBBON_PROOF.height}
      aria-label="课刻原始纸带像素网格形变验证"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
      }}
    />
  );
};
