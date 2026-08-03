import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pngjs from 'pngjs';

const {PNG} = pngjs;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const layerPath = path.join(
  projectRoot,
  'public/logo-layers/ribbon-main.png',
);
const actualPath = path.resolve(
  projectRoot,
  process.argv[2] ?? 'out/ribbon-mesh-final.png',
);
const background = [244, 246, 248, 255];

const [layerBytes, actualBytes] = await Promise.all([
  readFile(layerPath),
  readFile(actualPath),
]);
const layer = PNG.sync.read(layerBytes);
const actual = PNG.sync.read(actualBytes);

if (layer.width !== actual.width || layer.height !== actual.height) {
  throw new Error(
    `Image size mismatch: expected ${layer.width}×${layer.height}, received ${actual.width}×${actual.height}.`,
  );
}

let absoluteError = 0;
let maximumChannelError = 0;
let changedPixels = 0;
const pixelCount = layer.width * layer.height;

for (let pixel = 0; pixel < pixelCount; pixel += 1) {
  const offset = pixel * 4;
  const alpha = layer.data[offset + 3] / 255;
  const expected = [
    Math.round(
      layer.data[offset] * alpha + background[0] * (1 - alpha),
    ),
    Math.round(
      layer.data[offset + 1] * alpha + background[1] * (1 - alpha),
    ),
    Math.round(
      layer.data[offset + 2] * alpha + background[2] * (1 - alpha),
    ),
    255,
  ];
  let pixelMaximum = 0;

  for (let channel = 0; channel < 4; channel += 1) {
    const difference = Math.abs(
      expected[channel] - actual.data[offset + channel],
    );
    absoluteError += difference;
    pixelMaximum = Math.max(pixelMaximum, difference);
    maximumChannelError = Math.max(maximumChannelError, difference);
  }

  if (pixelMaximum > 12) {
    changedPixels += 1;
  }
}

const meanAbsoluteError = absoluteError / (pixelCount * 4 * 255);
const changedPixelRatio = changedPixels / pixelCount;
const result = {
  actual: path.relative(projectRoot, actualPath),
  meanAbsoluteError,
  changedPixelRatio,
  maximumChannelError,
  thresholds: {
    meanAbsoluteError: 0.02,
    changedPixelRatio: 0.05,
  },
};

console.log(JSON.stringify(result, null, 2));

if (
  meanAbsoluteError > result.thresholds.meanAbsoluteError ||
  changedPixelRatio > result.thresholds.changedPixelRatio
) {
  process.exitCode = 1;
}
