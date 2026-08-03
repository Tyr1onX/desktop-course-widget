import {access, copyFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const promoDirectory = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(promoDirectory, '..');
const sourceIcon = resolve(repositoryRoot, 'src-tauri', 'icons', 'icon.png');
const publicDirectory = resolve(promoDirectory, 'public');
const targetIcon = resolve(publicDirectory, 'course-icon.png');

try {
  await access(sourceIcon);
} catch {
  throw new Error(`Official app icon was not found: ${sourceIcon}`);
}

await mkdir(publicDirectory, {recursive: true});
await copyFile(sourceIcon, targetIcon);
console.log(`Synced official icon to ${targetIcon}`);
