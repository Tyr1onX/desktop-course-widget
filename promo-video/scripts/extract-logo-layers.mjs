import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pngjs from 'pngjs';

const {PNG} = pngjs;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const sourcePath = path.join(projectRoot, 'assets/logo-source/icon-original.png');
const geometryPath = path.join(projectRoot, 'assets/logo-layers/ribbon-geometry.json');
const outputDirectories = [
  path.join(projectRoot, 'assets/logo-layers'),
  path.join(projectRoot, 'public/logo-layers'),
];

const cubicPoint = (start, controlOne, controlTwo, end, t) => {
  const inverse = 1 - t;

  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * controlOne.x +
      3 * inverse * t ** 2 * controlTwo.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * controlOne.y +
      3 * inverse * t ** 2 * controlTwo.y +
      t ** 3 * end.y,
  };
};

const flattenPath = (geometry) => {
  const points = [{...geometry.start}];
  let start = geometry.start;

  for (const segment of geometry.segments) {
    for (let step = 1; step <= geometry.segmentsPerCurve; step += 1) {
      points.push(
        cubicPoint(
          start,
          segment.controlOne,
          segment.controlTwo,
          segment.end,
          step / geometry.segmentsPerCurve,
        ),
      );
    }

    start = segment.end;
  }

  return points;
};

const pointInPolygon = (point, polygon) => {
  let inside = false;

  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current, current += 1
  ) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
};

const distanceToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared,
    ),
  );

  return Math.hypot(
    point.x - (start.x + t * dx),
    point.y - (start.y + t * dy),
  );
};

const distanceToPolygon = (point, polygon) => {
  let minimum = Number.POSITIVE_INFINITY;

  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    minimum = Math.min(
      minimum,
      distanceToSegment(point, polygon[index], polygon[next]),
    );
  }

  return minimum;
};

const coverageAt = (x, y, polygon, padding) => {
  const samples = [0.25, 0.75];
  let covered = 0;

  for (const offsetY of samples) {
    for (const offsetX of samples) {
      const point = {x: x + offsetX, y: y + offsetY};
      const inside = pointInPolygon(point, polygon);
      const nearEdge =
        !inside && distanceToPolygon(point, polygon) <= padding;

      if (inside || nearEdge) {
        covered += 1;
      }
    }
  }

  return covered / (samples.length * samples.length);
};

const copyRgb = (source, target, offset) => {
  target.data[offset] = source.data[offset];
  target.data[offset + 1] = source.data[offset + 1];
  target.data[offset + 2] = source.data[offset + 2];
};

const sourceBytes = await readFile(sourcePath);
const geometryBytes = await readFile(geometryPath);
const geometry = JSON.parse(geometryBytes.toString('utf8'));
const source = PNG.sync.read(sourceBytes);

if (
  source.width !== geometry.canvas.width ||
  source.height !== geometry.canvas.height
) {
  throw new Error(
    `Expected a ${geometry.canvas.width}×${geometry.canvas.height} source icon, received ${source.width}×${source.height}.`,
  );
}

const polygon = flattenPath(geometry);
const ribbon = new PNG({width: source.width, height: source.height});
const residual = new PNG({width: source.width, height: source.height});
const minX = Math.max(
  0,
  Math.floor(geometry.bounds.x - geometry.maskPadding - 1),
);
const minY = Math.max(
  0,
  Math.floor(geometry.bounds.y - geometry.maskPadding - 1),
);
const maxX = Math.min(
  source.width - 1,
  Math.ceil(
    geometry.bounds.x +
      geometry.bounds.width +
      geometry.maskPadding +
      1,
  ),
);
const maxY = Math.min(
  source.height - 1,
  Math.ceil(
    geometry.bounds.y +
      geometry.bounds.height +
      geometry.maskPadding +
      1,
  ),
);

for (let y = 0; y < source.height; y += 1) {
  for (let x = 0; x < source.width; x += 1) {
    const offset = (y * source.width + x) * 4;
    const inMaskBounds =
      x >= minX && x <= maxX && y >= minY && y <= maxY;
    const coverage = inMaskBounds
      ? coverageAt(x, y, polygon, geometry.maskPadding)
      : 0;

    copyRgb(source, ribbon, offset);
    copyRgb(source, residual, offset);
    ribbon.data[offset + 3] = Math.round(
      source.data[offset + 3] * coverage,
    );
    residual.data[offset + 3] = Math.round(
      source.data[offset + 3] * (1 - coverage),
    );
  }
}

const manifest = {
  source: 'assets/logo-source/icon-original.png',
  sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  geometrySha256: createHash('sha256').update(geometryBytes).digest('hex'),
  layers: ['ribbon-main.png', 'residual-detail.png'],
};

for (const directory of outputDirectories) {
  await mkdir(directory, {recursive: true});
  await writeFile(
    path.join(directory, 'ribbon-main.png'),
    PNG.sync.write(ribbon),
  );
  await writeFile(
    path.join(directory, 'residual-detail.png'),
    PNG.sync.write(residual),
  );
  await writeFile(
    path.join(directory, 'layer-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

console.log(
  `Generated ribbon-main.png and residual-detail.png from ${path.relative(projectRoot, sourcePath)}.`,
);
