import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pngjs from 'pngjs';

const {PNG} = pngjs;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const referencePath = path.join(
  projectRoot,
  'public/logo-source/icon-original.png',
);
const actualPath = path.resolve(
  projectRoot,
  process.argv[2] ?? 'out/ribbon-mesh-final.png',
);

const [referenceBytes, actualBytes] = await Promise.all([
  readFile(referencePath),
  readFile(actualPath),
]);
const reference = PNG.sync.read(referenceBytes);
const actual = PNG.sync.read(actualBytes);

if (reference.width !== actual.width || reference.height !== actual.height) {
  throw new Error(
    `Image size mismatch: expected ${reference.width}×${reference.height}, received ${actual.width}×${actual.height}.`,
  );
}

let absoluteError = 0;
let maximumChannelError = 0;
let changedPixels = 0;
const pixelCount = reference.width * reference.height;

for (let pixel = 0; pixel < pixelCount; pixel += 1) {
  const offset = pixel * 4;
  let pixelMaximum = 0;

  for (let channel = 0; channel < 4; channel += 1) {
    const difference = Math.abs(
      reference.data[offset + channel] - actual.data[offset + channel],
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
  reference: path.relative(projectRoot, referencePath),
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
