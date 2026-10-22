import { cp, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const destination = new URL('dist/', root);

await mkdir(destination, { recursive: true });

for (const directory of ['assets', 'sample']) {
  await cp(new URL(`${directory}/`, root), new URL(`${directory}/`, destination), {
    recursive: true,
    filter: (source) => basename(source) !== '.DS_Store',
  });
}

await copyFile(new URL('CNAME', root), new URL('CNAME', destination));
// GitHub Pages must serve Vite's underscore-prefixed bundle directory.
await writeFile(new URL('.nojekyll', destination), '');

console.log(`Copied original assets, sample, and CNAME to ${fileURLToPath(destination)}`);
