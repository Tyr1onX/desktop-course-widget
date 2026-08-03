import type {Point} from './createMesh';

type Triangle = readonly [Point, Point, Point];

const expandedTriangle = (triangle: Triangle, overlap: number): Triangle => {
  const center = {
    x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
    y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3,
  };

  return triangle.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;

    return {
      x: point.x + (dx / length) * overlap,
      y: point.y + (dy / length) * overlap,
    };
  }) as unknown as Triangle;
};

export const drawTriangle = (
  context: CanvasRenderingContext2D,
  texture: CanvasImageSource,
  source: Triangle,
  destination: Triangle,
) => {
  const [sourceA, sourceB, sourceC] = source;
  const [destinationA, destinationB, destinationC] = destination;
  const determinant =
    sourceA.x * (sourceB.y - sourceC.y) +
    sourceB.x * (sourceC.y - sourceA.y) +
    sourceC.x * (sourceA.y - sourceB.y);

  if (Math.abs(determinant) < 0.000001) {
    return;
  }

  const a =
    (destinationA.x * (sourceB.y - sourceC.y) +
      destinationB.x * (sourceC.y - sourceA.y) +
      destinationC.x * (sourceA.y - sourceB.y)) /
    determinant;
  const c =
    (destinationA.x * (sourceC.x - sourceB.x) +
      destinationB.x * (sourceA.x - sourceC.x) +
      destinationC.x * (sourceB.x - sourceA.x)) /
    determinant;
  const e =
    (destinationA.x * (sourceB.x * sourceC.y - sourceC.x * sourceB.y) +
      destinationB.x * (sourceC.x * sourceA.y - sourceA.x * sourceC.y) +
      destinationC.x * (sourceA.x * sourceB.y - sourceB.x * sourceA.y)) /
    determinant;
  const b =
    (destinationA.y * (sourceB.y - sourceC.y) +
      destinationB.y * (sourceC.y - sourceA.y) +
      destinationC.y * (sourceA.y - sourceB.y)) /
    determinant;
  const d =
    (destinationA.y * (sourceC.x - sourceB.x) +
      destinationB.y * (sourceA.x - sourceC.x) +
      destinationC.y * (sourceB.x - sourceA.x)) /
    determinant;
  const f =
    (destinationA.y * (sourceB.x * sourceC.y - sourceC.x * sourceB.y) +
      destinationB.y * (sourceC.x * sourceA.y - sourceA.x * sourceC.y) +
      destinationC.y * (sourceA.x * sourceB.y - sourceB.x * sourceA.y)) /
    determinant;

  const clipTriangle = expandedTriangle(destination, 0.65);

  context.save();
  context.beginPath();
  context.moveTo(clipTriangle[0].x, clipTriangle[0].y);
  context.lineTo(clipTriangle[1].x, clipTriangle[1].y);
  context.lineTo(clipTriangle[2].x, clipTriangle[2].y);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(texture, 0, 0);
  context.restore();
};
