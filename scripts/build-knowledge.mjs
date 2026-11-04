// Builds data/knowledge.json, the samples, whitepapers and extensions that froala_find_presets searches.
// It reads the froala.com site repository, so set FROALA_SITE_DIR to a checkout of it.
//
//   FROALA_SITE_DIR=<path to the site repository> npm run build:knowledge
//
// The file is committed, so people who only use or test this server never need the site repository.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { toPage } from './build-docs.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const site = path.resolve(root, process.env.FROALA_SITE_DIR ?? '');
if (!process.env.FROALA_SITE_DIR || !existsSync(path.join(site, 'src/pages/example/items'))) {
  console.error('The site repository was not found. Set FROALA_SITE_DIR to its folder.');
  process.exit(1);
}
const readJson = (file) => JSON.parse(readFileSync(path.join(site, file), 'utf8'));
const EXAMPLES_URL = 'https://froala.com/wysiwyg-editor/examples/';

const release = JSON.parse(readFileSync(path.join(root, 'content/release.json'), 'utf8'));

/** Replaces "const X = Module.default ?? Module;" with a plain import of X, which the current wrappers support. */
function plainImports(code) {
  let out = code.replace(/^.*\/\/ a CommonJS package.*\n/gm, '');
  for (const [line, name, module] of out.matchAll(/^const (\w+) = (\w+)\.default \?\? \2;\n\n?/gm)) {
    out = out.replace(line, '').replace(`import ${module} from`, `import ${name} from`);
  }
  return out;
}

/** Sample code for the current release, with the trial key, its version and plain imports. */
const plainCode = (code) =>
  plainImports(code ?? '')
    .replace(/^\+ ?/gm, '')
    .replace(/\/\/ key: 'YOUR_(TRIAL|LICENSE)_KEY'.*$/gm, `key: '${release.trialKey}',`)
    .replace(/froala-editor@\d+\.\d+\.\d+/g, `froala-editor@${release.froala}`)
    .trim();

/** The page text of an example, from the site's blocks of paragraphs, headings and lists. */
function blocksToMarkdown(blocks = []) {
  return blocks
    .flatMap((block) => {
      if (typeof block === 'string') return [block];
      const lines = [];
      if (block.h) lines.push(`${'#'.repeat(Math.min((block.l ?? 2) + 1, 4))} ${block.h}`);
      if (block.p) lines.push(block.p);
      if (block.ul) lines.push(block.ul.map((item) => `- ${item}`).join('\n'));
      if (block.ol) lines.push(block.ol.map((item, i) => `${i + 1}. ${item}`).join('\n'));
      if (block.opts) lines.push(block.opts.map(([option, about]) => `- ${option}, ${about}`).join('\n'));
      if (block.table) lines.push(block.table.map((row) => row.join(', ')).join('\n'));
      if (block.code) lines.push(`\`\`\`\n${plainCode(block.code)}\n\`\`\``);
      if (block.blocks) lines.push(blocksToMarkdown(block.blocks));
      return lines;
    })
    .join('\n\n');
}

function buildExamples() {
  const groups = Object.fromEntries(readJson('src/pages/examples/data.json').examples.groups.map((g) => [g.id, g.name]));
  const folder = path.join(site, 'src/pages/example/items');
  const samples = JSON.parse(execFileSync('python3', ['-I', path.join(root, 'scripts/export-samples.py'), site], { maxBuffer: 1 << 26 }).toString());
  return readdirSync(folder)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const item = JSON.parse(readFileSync(path.join(folder, file), 'utf8'));
      return {
        id: item.slug,
        title: item.name,
        group: groups[item.group] ?? item.group,
        summary: item.description,
        text: [blocksToMarkdown(item.intro), blocksToMarkdown(item.try_blocks), blocksToMarkdown(item.after)].filter(Boolean).join('\n\n'),
        url: `${EXAMPLES_URL}${item.slug}/`,
        html: item.html ?? '',
        files: (item.head ?? []).flatMap((entry) => [entry.css, entry.js].filter(Boolean)).map(plainCode),
        code: {
          javascript: plainCode(samples[item.slug].javascript),
          react: plainCode(samples[item.slug].react),
          vue: plainCode(samples[item.slug].vue),
          angular: plainCode(samples[item.slug].angular)
        }
      };
    });
}

async function buildWhitepapers() {
  const papers = readJson('src/pages/whitepapers/data.json').whitepapers.papers;
  const out = [];
  for (const paper of papers) {
    let markdown = '';
    if (!paper.href.endsWith('.pdf')) {
      const response = await fetch(paper.href, { headers: { 'User-Agent': 'froala-mcp-indexer' } });
      if (!response.ok) throw new Error(`${response.status} for ${paper.href}`);
      markdown = toPage(paper.href, await response.text()).markdown;
    }
    out.push({ id: paper.slug, title: paper.title, summary: paper.sum, url: paper.href, markdown });
  }
  return out;
}

// Each extension adds one feature on Froala's public API. "define" is the name its file registers.
const EXTENSIONS = [
  {
    id: 'autoformat',
    file: 'autoformat.js',
    define: 'autoformat',
    title: 'Automatic formatting',
    summary: 'Turns Markdown habits into formatting while people type, such as "# " for a heading and "- " for a list.',
    options: ['autoformat']
  },
  {
    id: 'checklists',
    file: 'checklists.js',
    define: 'todoLists',
    title: 'Checklists',
    summary: 'Adds a todoList button. Click a box, or press Ctrl or Cmd with Enter in an item, to tick it.',
    buttons: ['todoList']
  },
  {
    id: 'footnotes',
    file: 'footnotes.js',
    define: 'footnotes',
    title: 'Footnotes',
    summary: 'Adds an insertFootnote button with numbered references and notes at the end of the document.',
    buttons: ['insertFootnote']
  },
  {
    id: 'template-variables',
    file: 'merge-fields.js',
    define: 'mergeFields',
    title: 'Template variables',
    summary: 'Adds a mergeField button. Variables appear as chips in the text, and typing {{ opens the list.',
    buttons: ['mergeField'],
    options: ['variables', 'variablesManage']
  },
  {
    id: 'table-of-contents',
    file: 'outline-toc.js',
    define: 'outlineAndToc',
    title: 'Table of contents',
    summary: 'Adds an insertToc button that builds a linked list of the headings.',
    buttons: ['insertToc']
  },
  { id: 'show-blocks', file: 'show-blocks.js', define: 'showBlocks', title: 'Show blocks', summary: 'Adds a showBlocks button that outlines each block of the text.', buttons: ['showBlocks'] },
  {
    id: 'slash-commands-and-mentions',
    file: 'slash-mentions.js',
    define: 'slashAndMentions',
    title: 'Slash commands and mentions',
    summary: 'A slash on an empty line opens a block menu, and @ suggests people.',
    options: ['slashCommands', 'mentions', 'mentionPeople']
  },
  {
    id: 'spacing',
    file: 'spacing.js',
    define: 'spacing',
    title: 'Line and paragraph spacing',
    summary: 'Adds a spacing button for line height and the space around paragraphs.',
    buttons: ['spacing'],
    options: ['lineHeights', 'spacingCustom']
  },
  {
    id: 'zoom-and-size-steps',
    file: 'stepper-zoom.js',
    define: 'stepperAndZoom',
    title: 'Zoom and font size steps',
    summary: 'Adds zoom, fontSizeUp and fontSizeDown buttons.',
    buttons: ['zoom', 'fontSizeUp', 'fontSizeDown'],
    options: ['zoom', 'zoomFit']
  },
  {
    id: 'templates',
    file: 'templates.js',
    define: 'templatePicker',
    title: 'Templates',
    summary: 'Adds an insertTemplate button that calls your own template picker.',
    buttons: ['insertTemplate'],
    options: ['templateOpen']
  }
];

/** One extension as a stand-alone ES module, without the site's comments. */
async function buildExtensions() {
  const folder = path.join(site, 'src/presets/shared/extensions');
  const read = (file) => readFileSync(path.join(folder, file), 'utf8');
  const shared = read('kit.js');
  const install = read('install.js');
  const icons = read('icons.js');
  const out = [];
  for (const extension of EXTENSIONS) {
    const source = `${shared}\n${icons}\n${read(extension.file)}\n${install}`;
    const { code } = await transform(source, { loader: 'js', format: 'esm', target: 'es2022', legalComments: 'none' });
    const header = `// ${extension.title}. ${extension.summary}\n// Call installFroalaExtension(FroalaEditor) once, before you create an editor.\n`;
    const footer = 'export const installFroalaExtension = (FroalaEditor) => window.FroalaExtensions.install(FroalaEditor);\n';
    out.push({
      id: extension.id,
      define: extension.define,
      title: extension.title,
      summary: extension.summary,
      buttons: extension.buttons,
      options: extension.options,
      code: `${header}${code}${footer}`
    });
  }
  return out;
}

// Longer fixes that known issues show as code. Each function comes from the site's compat.js with its guards removed.
const SNIPPETS = {
  undoFloor: { needs: '' },
  historyView: { needs: 'watch' },
  printKey: { needs: '' },
  popupTaps: { needs: 'until' },
  pointerFocus: { needs: 'until' }
};

async function buildSnippets() {
  const source = readFileSync(path.join(site, 'src/presets/shared/compat.js'), 'utf8');
  const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const helpers = {
    watch: between('const WATCH = []', '/* The once-per-page fixes').replace(/\/\*[\s\S]*$/, ''),
    until: between('const until = ', '/* paste-inert.')
  };
  const out = {};
  for (const [name, { needs }] of Object.entries(SNIPPETS)) {
    const start = source.indexOf(`const ${name} = `);
    const end = source.indexOf('\n  };\n', start) + 6;
    const flag = source.slice(start - 40, start).match(/let \w+ = false;/)?.[0] ?? '';
    const body = source
      .slice(start, end)
      .replace(/if \(!on\('[a-z-]+'\)\) return[^;]*;\s*/g, '')
      .replace(/!on\('[a-z-]+'\) \|\| /g, '')
      .replace(/ \|\| !on\('[a-z-]+'\)/g, '');
    const { code } = await transform(`${needs ? helpers[needs] : ''}\n${flag}\n${body}\nexport { ${name} };`, { loader: 'js', format: 'esm', target: 'es2022', legalComments: 'none' });
    out[name] = code.trim();
  }
  return out;
}

/** The website's toolbar order. Every preset follows it, so undo and redo always come first. */
function copyToolbarOrder() {
  const { order, phone } = readJson('src/shared/toolbar-order.json');
  const target = path.join(root, 'content/toolbar-order.json');
  writeFileSync(target, `${JSON.stringify({ order, phone }, null, 2)}\n`);
}

const INTERNAL_WORDS = /workaround|RELEASE CHECK|plans\/|coming soon/i;

function assertPublic(label, text) {
  const found = text.match(INTERNAL_WORDS);
  if (found) throw new Error(`${label} contains "${found[0]}". Rewrite that text in the site repository before building.`);
}

const examples = buildExamples();
const whitepapers = await buildWhitepapers();
const extensions = await buildExtensions();
const snippets = await buildSnippets();
for (const item of [...examples, ...whitepapers]) assertPublic(item.id, JSON.stringify(item));
for (const item of extensions) assertPublic(item.id, item.code);
for (const [name, code] of Object.entries(snippets)) assertPublic(name, code);
copyToolbarOrder();

const target = path.join(root, 'data/knowledge.json');
const out = { builtAt: new Date().toISOString(), examples, whitepapers, extensions, snippets };
writeFileSync(`${target}.tmp`, JSON.stringify(out));
renameSync(`${target}.tmp`, target);
console.log(`Saved ${examples.length} examples, ${whitepapers.length} whitepapers and ${extensions.length} extensions (${Math.round(JSON.stringify(out).length / 1024)} KB).`);
