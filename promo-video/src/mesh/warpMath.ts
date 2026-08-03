import type {Mesh, MeshVertex, Point} from './createMesh';

export type RibbonWarpTiming = {
  fps: number;
  durationInFrames: number;
  lockFrame: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const smoothstep = (value: number) => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};

const progress = (frame: number, start: number, end: number) =>
  smoothstep((frame - start) / Math.max(1, end - start));

const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

const mixPoint = (from: Point, to: Point, amount: number): Point => ({
  x: mix(from.x, to.x, amount),
  y: mix(from.y, to.y, amount),
});

const collapsedPoint = ({u, v}: MeshVertex): Point => {
  const longitudinal = u - 0.5;
  const transverse = v - 0.5;

  return {
    x: 256 + longitudinal * 76 + transverse * 7,
    y: 276 + Math.sin(u * Math.PI * 2) * 7 + transverse * 8,
  };
};

const flowingPoint = (
  {u, v}: MeshVertex,
  frame: number,
  fps: number,
): Point => {
  const transverse = v - 0.5;
  const phase = frame / fps;
  const arch = Math.sin((u - 0.08) * Math.PI * 1.22);
  const thickness = 42 + Math.sin(u * Math.PI) * 74;
  const taper = Math.sin(u * Math.PI);

  return {
    x:
      52 +
      u * 414 +
      transverse * 30 * Math.cos(u * Math.PI * 1.1) +
      Math.sin((u * 2.8 + phase * 0.72) * Math.PI) * 7 * taper,
    y:
      278 +
      arch * 48 +
      transverse * thickness +
      Math.sin((u * 2.15 - phase * 0.92) * Math.PI) * 11 * taper,
  };
};

export const warpMesh = (
  mesh: Mesh,
  frame: number,
  timing: RibbonWarpTiming,
): Mesh => {
  if (frame >= timing.lockFrame) {
    return {
      triangles: mesh.triangles,
      vertices: mesh.vertices.map((vertex) => ({
        ...vertex,
        position: {...vertex.source},
      })),
    };
  }

  const emerge = progress(frame, 2, 43);
  const settle = progress(frame, 39, timing.lockFrame);
  const breathing = Math.sin((frame / timing.fps) * Math.PI * 2.2) * (1 - settle);

  return {
    triangles: mesh.triangles,
    vertices: mesh.vertices.map((vertex) => {
      const collapsed = collapsedPoint(vertex);
      const flowing = flowingPoint(vertex, frame, timing.fps);
      const formed = mixPoint(collapsed, flowing, emerge);
      const position = mixPoint(formed, vertex.source, settle);
      const centerWeight = Math.sin(vertex.u * Math.PI) * Math.sin(vertex.v * Math.PI);

      return {
        ...vertex,
        position: {
          x: position.x + breathing * centerWeight * 2.5,
          y: position.y - breathing * centerWeight * 4,
        },
      };
    }),
  };
};
