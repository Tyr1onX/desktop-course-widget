export type Point = {
  x: number;
  y: number;
};

export type MeshVertex = {
  source: Point;
  position: Point;
  u: number;
  v: number;
};

export type MeshTriangle = readonly [number, number, number];

export type Mesh = {
  vertices: MeshVertex[];
  triangles: MeshTriangle[];
};

type CreateMeshOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
};

export const createMesh = ({
  x,
  y,
  width,
  height,
  columns,
  rows,
}: CreateMeshOptions): Mesh => {
  if (columns < 1 || rows < 1) {
    throw new Error('Mesh columns and rows must both be at least 1.');
  }

  const vertices: MeshVertex[] = [];
  const triangles: MeshTriangle[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;

    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const source = {
        x: x + width * u,
        y: y + height * v,
      };

      vertices.push({
        source,
        position: {...source},
        u,
        v,
      });
    }
  }

  const stride = columns + 1;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;

      const alternateDiagonal = (row + column) % 2 === 1;

      if (alternateDiagonal) {
        triangles.push([topLeft, topRight, bottomLeft]);
        triangles.push([topRight, bottomRight, bottomLeft]);
      } else {
        triangles.push([topLeft, topRight, bottomRight]);
        triangles.push([topLeft, bottomRight, bottomLeft]);
      }
    }
  }

  return {vertices, triangles};
};
