// Checks that metadata.json, docs.json and knowledge.json are complete and match the installed froala-editor.
// It runs in CI, before every publish and deploy, and on the staged files in npm run build:data.
// It exits with an error instead of shipping thin data.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_PAGES } from './build-docs.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const froalaDir = path.dirname(require.resolve('froala-editor/package.json'));
const installed = JSON.parse(readFileSync(path.join(froalaDir, 'package.json'), 'utf8')).version;
const folder = path.resolve(root, process.env.DATA_DIR ?? 'data');
const metadata = JSON.parse(readFileSync(path.join(folder, 'metadata.json'), 'utf8'));
const docs = JSON.parse(readFileSync(path.join(folder, 'docs.json'), 'utf8'));
const knowledge = JSON.parse(readFileSync(path.join(root, 'data/knowledge.json'), 'utf8'));

// The smallest accepted counts. Raise them when a release adds more, and lower them only for a good reason.
const MINIMUM = { options: 300, plugins: 50, buttons: 190, events: 140, methods: 280, pages: 330, examples: 85, whitepapers: 6, extensions: 10 };

const problems = [];
const expect = (ok, message) => ok || problems.push(message);
const count = (name, value) => expect(value >= MINIMUM[name], `${name}: ${value}, expected at least ${MINIMUM[name]}`);

expect(metadata.froalaVersion === installed, `metadata.json is for Froala ${metadata.froalaVersion}, but ${installed} is installed. Run npm run build:data.`);
count('options', Object.keys(metadata.options).length);
count('plugins', Object.keys(metadata.plugins).length);
count('buttons', Object.keys(metadata.buttons).length);
count('events', metadata.events?.length ?? 0);
count('methods', metadata.methods?.length ?? 0);
count('pages', docs.pages.filter((p) => p.markdown.trim().length > 50).length);
count('examples', knowledge.examples.length);
count('whitepapers', knowledge.whitepapers.length);
count('extensions', knowledge.extensions.length);
for (const sample of knowledge.examples) expect(sample.code.javascript.length > 0, `sample ${sample.id} has no code`);
for (const url of REQUIRED_PAGES)
  expect(
    docs.pages.some((p) => p.url === url && p.markdown.trim().length > 50),
    `docs.json is missing ${url}`
  );
for (const [name, plugin] of Object.entries(metadata.plugins)) {
  expect(existsSync(path.join(froalaDir, plugin.file.replace('froala-editor/', ''))), `plugin ${name}: ${plugin.file} does not exist`);
}
expect(metadata.docsBuiltAt === docs.builtAt, 'metadata.json was built from an older docs.json. Run npm run build:data.');
expect(!docs.pages.some((p) => /\]\(data:/.test(p.markdown)), 'docs.json has inline data images. Run npm run build:data.');

const days = Math.round((Date.now() - Date.parse(docs.builtAt)) / 86_400_000);
if (problems.length) {
  console.error(`Data check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Data OK: Froala ${installed}, docs from ${docs.builtAt.slice(0, 10)} (${days} days old), ${docs.pages.length} pages.`);
