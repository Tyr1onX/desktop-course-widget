import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

const packageVersion = readJson("package.json").version;
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const tauriVersion = tauriConfig.version;
const cargoToml = readText("src-tauri/Cargo.toml");
const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);

if (!cargoMatch) {
  console.error("Unable to read the package version from src-tauri/Cargo.toml.");
  process.exit(1);
}

const versions = {
  "package.json": packageVersion,
  "src-tauri/tauri.conf.json": tauriVersion,
  "src-tauri/Cargo.toml": cargoMatch[1],
};

const uniqueVersions = new Set(Object.values(versions));

if (uniqueVersions.size !== 1) {
  console.error("Application versions are inconsistent:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`- ${file}: ${version}`);
  }
  process.exit(1);
}

const ocrResources = tauriConfig.bundle?.resources;
const expectedOcrSource = "resources/ocr-component/";
const expectedOcrTarget = "ocr-component/";
if (
  !ocrResources ||
  Array.isArray(ocrResources) ||
  ocrResources[expectedOcrSource] !== expectedOcrTarget
) {
  console.error(
    `OCR resources must map ${expectedOcrSource} to $RESOURCE/${expectedOcrTarget}`,
  );
  process.exit(1);
}

console.log(`Application version is consistent: ${packageVersion}`);
console.log(
  `OCR resource mapping is consistent: ${expectedOcrSource} -> ${expectedOcrTarget}`,
);