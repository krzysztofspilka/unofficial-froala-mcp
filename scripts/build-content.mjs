// Builds data/content.json from the files people edit by hand.
//   kit/froala-enhancements.ts   gives the TypeScript file and a JavaScript copy of it
//   content/integrations/*.md    gives one integration per file
// To add an integration, add a Markdown file to content/integrations and run npm run build:content.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Removes the types from the TypeScript file. Comments stay, so both copies read the same. */
export function toJavaScript(typescript) {
  const stripped = stripTypeScriptTypes(typescript, { mode: 'strip' })
    // A removed annotation leaves spaces where it stood.
    .replace(/[ \t]+$/gm, '')
    .replace(/(\S) {2,}([,);(])/g, '$1$2')
    .replace(/(\S) {2,}(\{|=>|=)/g, '$1 $2');
  // Removed interfaces and type aliases leave blank lines behind.
  return stripped.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

/** Splits a file into its front matter, which is a list of names and values, and its Markdown body. */
export function parseFrontMatter(text, file) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file} must start with front matter between --- lines.`);
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const at = line.indexOf(':');
      if (at < 0) throw new Error(`${file}: "${line}" is not a "name: value" line.`);
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    })
  );
  for (const name of ['title', 'summary', 'targets', 'checked']) {
    if (!fields[name]) throw new Error(`${file} needs a ${name} field.`);
  }
  return { fields, markdown: match[2].trim() };
}

export function buildContent() {
  const typescript = readFileSync(path.join(root, 'kit/froala-enhancements.ts'), 'utf8');
  const folder = path.join(root, 'content/integrations');
  const integrations = readdirSync(folder)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const { fields, markdown } = parseFrontMatter(readFileSync(path.join(folder, file), 'utf8'), file);
      return {
        id: file.replace(/\.md$/, ''),
        title: fields.title,
        summary: fields.summary,
        targets: fields.targets.split(',').map((t) => t.trim()),
        checked: fields.checked,
        markdown
      };
    });
  return { enhancements: { typescript, javascript: toJavaScript(typescript) }, integrations };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const content = buildContent();
  writeFileSync(path.join(root, 'data/content.json'), `${JSON.stringify(content, null, 1)}\n`);
  console.log(`Built data/content.json with ${content.integrations.length} integrations.`);
}
