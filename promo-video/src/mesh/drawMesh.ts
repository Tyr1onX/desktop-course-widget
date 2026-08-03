import type {Mesh, Point} from './createMesh';
import {drawTriangle} from './drawTriangle';

export const drawMesh = (
  context: CanvasRenderingContext2D,
  texture: CanvasImageSource,
  mesh: Mesh,
) => {
  for (const [first, second, third] of mesh.triangles) {
    const source = [
      mesh.vertices[first].source,
      mesh.vertices[second].source,
      mesh.vertices[third].source,
    ] as const satisfies readonly [Point, Point, Point];
    const destination = [
      mesh.vertices[first].position,
      mesh.vertices[second].position,
      mesh.vertices[third].position,
    ] as const satisfies readonly [Point, Point, Point];

    drawTriangle(context, texture, source, destination);
  }
};
