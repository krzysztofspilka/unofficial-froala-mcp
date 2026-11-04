// Refreshes docs.json and metadata.json. Both are built in a staging folder and checked together,
// and only then replace the files in data/, so a failed or thin build leaves the last good pair in place.
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const staging = path.join(root, 'data/.staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const run = (script) => execFileSync(process.execPath, [path.join(root, 'scripts', script)], { stdio: 'inherit', env: { ...process.env, DATA_DIR: staging } });
run('build-docs.mjs');
run('build-metadata.mjs');
run('check-data.mjs');

for (const file of ['docs.json', 'metadata.json']) renameSync(path.join(staging, file), path.join(root, 'data', file));
rmSync(staging, { recursive: true, force: true });
console.log('Replaced data/docs.json and data/metadata.json.');
