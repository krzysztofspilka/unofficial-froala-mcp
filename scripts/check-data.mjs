// Checks that data/metadata.json and data/docs.json are complete and match the installed froala-editor.
// Runs before every publish (npm run check:data). It exits with an error instead of shipping thin data.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_PAGES } from './build-docs.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const froalaDir = path.dirname(require.resolve('froala-editor/package.json'));
const installed = JSON.parse(readFileSync(path.join(froalaDir, 'package.json'), 'utf8')).version;
const metadata = JSON.parse(readFileSync(path.join(root, 'data/metadata.json'), 'utf8'));
const docs = JSON.parse(readFileSync(path.join(root, 'data/docs.json'), 'utf8'));

// The smallest counts we accept. Raise them when a release adds more; never lower them without a reason.
const MINIMUM = { options: 300, plugins: 50, buttons: 190, events: 140, methods: 280, pages: 330 };

const problems = [];
const expect = (ok, message) => ok || problems.push(message);
const count = (name, value) => expect(value >= MINIMUM[name], `${name}: ${value}, expected at least ${MINIMUM[name]}`);

expect(metadata.froalaVersion === installed, `metadata.json is for Froala ${metadata.froalaVersion}, but ${installed} is installed. Run npm run build:data.`);
count('options', Object.keys(metadata.options).length);
count('plugins', Object.keys(metadata.plugins).length);
count('buttons', Object.keys(metadata.buttons).length);
count('events', metadata.events?.length ?? 0);
count('methods', metadata.methods?.length ?? 0);
count('pages', docs.pages.length);
for (const url of REQUIRED_PAGES) expect(docs.pages.some((p) => p.url === url), `docs.json is missing ${url}`);
for (const [name, plugin] of Object.entries(metadata.plugins)) {
  expect(existsSync(path.join(froalaDir, plugin.file.replace('froala-editor/', ''))), `plugin ${name}: ${plugin.file} doesn't exist`);
}
expect(metadata.docsBuiltAt === docs.builtAt, 'metadata.json was built from an older docs.json. Run npm run build:metadata.');
expect(!docs.pages.some((p) => /\]\(data:/.test(p.markdown)), 'docs.json has inline data images. Run npm run build:docs.');

const days = Math.round((Date.now() - Date.parse(docs.builtAt)) / 86_400_000);
if (problems.length) {
  console.error(`Data check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Data OK: Froala ${installed}, docs from ${docs.builtAt.slice(0, 10)} (${days} days old), ${docs.pages.length} pages.`);
