// Builds data/metadata.json from the installed froala-editor package and data/docs.json.
// From the package: it loads the editor core in jsdom, then each plugin file one at a time, and records
// which options (FroalaEditor.DEFAULTS), plugins and toolbar commands each file adds, which plugins
// plugins.pkgd.min.js contains, and the option types declared in index.d.ts.
// From the docs (run npm run build:docs first): option descriptions and types, events and methods.
// The script stops with an error if a plugin file fails to load, so incomplete data is never written.
import { readFileSync, readdirSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const froalaDir = path.dirname(require.resolve('froala-editor/package.json'));
const froalaVersion = JSON.parse(readFileSync(path.join(froalaDir, 'package.json'), 'utf8')).version;

// Plugins that need a library the developer installs and exposes on window.
const HELPER_LIBRARIES = {
  importFromWord: [{ package: 'mammoth', global: 'mammoth', note: 'Expose it as window.mammoth before the editor starts.' }],
  exportToWord: [
    { package: 'html-docx-js', global: 'htmlDocx', note: 'Expose it as window.htmlDocx.' },
    { package: 'file-saver', global: 'saveAs', note: 'Expose saveAs as window.saveAs.' }
  ],
  codeView: [{ package: 'codemirror', global: 'CodeMirror', note: 'Optional. Without it, code view uses a plain textarea.', optional: true }],
  print: [{ package: 'html2pdf.js', global: 'html2pdf', note: 'Needed only for the getPDF (export to PDF) button.', onlyFor: ['getPDF'] }],
  filestack: [{ package: 'filestack-js', global: 'filestack', note: 'Expose it as window.filestack and set filestackOptions.filestackAPI.' }],
  imageTUI: [{ package: 'tui-image-editor', global: 'tui', note: 'Load TOAST UI Image Editor and its CSS before the plugin.' }]
};

/** A copy of a default value that can be stored as JSON. Functions and DOM nodes become labels. */
function serialisable(value, seen = new Set()) {
  if (typeof value === 'function') return '[function]';
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.nodeType === 'number') return '[DOM node]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const out = Array.isArray(value) ? value.map((v) => serialisable(v, seen)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialisable(v, seen)]));
  seen.delete(value);
  return out;
}

function newWindow() {
  return new JSDOM('<!doctype html><html><head></head><body><div id="editor"></div></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://localhost/'
  }).window;
}
const read = (rel) => readFileSync(path.join(froalaDir, rel), 'utf8');

// ---------- Options, plugins and buttons, file by file ----------

const window = newWindow();
window.eval(read('js/froala_editor.min.js'));
const FE = window.FroalaEditor;
if (!FE || !FE.DEFAULTS) throw new Error('FroalaEditor did not load in jsdom');

const options = {};
const plugins = {};
const buttons = {};
const record = (optionNames, owner) => {
  for (const name of optionNames) {
    if (!options[name]) options[name] = { default: serialisable(FE.DEFAULTS[name]), plugin: owner };
  }
};

record(Object.keys(FE.DEFAULTS), null);
for (const name of Object.keys(FE.COMMANDS)) buttons[name] = { plugin: FE.COMMANDS[name].plugin || null };
const editorModules = Object.keys(FE.MODULES).sort();

const pluginFiles = [];
for (const folder of ['js/plugins', 'js/third_party']) {
  const dir = path.join(froalaDir, folder);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.min.js')).sort()) pluginFiles.push(`${folder}/${file}`);
}
// files_manager also defines image, video and file options; load it last so those options belong to their own plugins.
pluginFiles.sort((a, b) => Number(a.endsWith('files_manager.min.js')) - Number(b.endsWith('files_manager.min.js')));

const editorCss = read('css/froala_editor.pkgd.min.css');
/** The share of a stylesheet's rules that also appear in another stylesheet. */
function shareOfRulesIn(css, other) {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter((r) => r.length > 10);
  return rules.length ? rules.filter((r) => other.includes(r)).length / rules.length : 1;
}
for (const rel of pluginFiles) {
  const beforeOptions = new Set(Object.keys(FE.DEFAULTS));
  const beforePlugins = new Set(Object.keys(FE.PLUGINS));
  const beforeCommands = new Set(Object.keys(FE.COMMANDS));
  try {
    window.eval(read(rel));
  } catch (error) {
    throw new Error(`${rel} failed to load, so metadata.json was not written: ${error.message}`);
  }
  const newPlugins = Object.keys(FE.PLUGINS).filter((p) => !beforePlugins.has(p));
  const newOptions = Object.keys(FE.DEFAULTS).filter((o) => !beforeOptions.has(o));
  const newCommands = Object.keys(FE.COMMANDS).filter((c) => !beforeCommands.has(c));
  if (newPlugins.length === 0) continue; // a library such as showdown or yjs, not a plugin
  const main = newPlugins[0];
  const cssFile = rel.replace(/^js\//, 'css/').replace(/\.min\.js$/, '.min.css');
  const css = existsSync(path.join(froalaDir, cssFile)) ? read(cssFile) : null;
  for (const name of newPlugins) {
    plugins[name] = {
      file: `froala-editor/${rel}`,
      css: css ? `froala-editor/${cssFile}` : null,
      // True when froala_editor.pkgd.min.css already has this plugin's styles (third-party plugins have their own CSS).
      cssInEditorCss: css ? shareOfRulesIn(css, editorCss) >= 0.5 : true,
      thirdParty: rel.startsWith('js/third_party'),
      inAllPluginsBundle: false,
      options: [],
      buttons: [],
      helperLibraries: HELPER_LIBRARIES[name] || []
    };
  }
  record(newOptions, main);
  plugins[main].options.push(...newOptions);
  for (const command of newCommands) {
    const owner = FE.COMMANDS[command].plugin || main;
    buttons[command] = { plugin: owner };
    (plugins[owner] || plugins[main]).buttons.push(command);
  }
}

// Buttons registered by the core but owned by a plugin (their command names the plugin).
for (const [name, info] of Object.entries(buttons)) {
  if (info.plugin && plugins[info.plugin] && !plugins[info.plugin].buttons.includes(name)) plugins[info.plugin].buttons.push(name);
}
for (const p of Object.values(plugins)) p.buttons.sort();
const editorMembers = [...new Set([...editorModules, ...Object.keys(plugins), 'el', '$el', 'opts', 'id', '$box', '$tb', '$wp', 'doc', 'win'])].sort();

// Which plugins the all-plugins bundle registers. Third-party and some newer plugins are not in it.
const bundleWindow = newWindow();
bundleWindow.eval(read('js/froala_editor.min.js'));
bundleWindow.eval(read('js/plugins.pkgd.min.js'));
for (const name of Object.keys(bundleWindow.FroalaEditor.PLUGINS)) if (plugins[name]) plugins[name].inAllPluginsBundle = true;
bundleWindow.close();

// ---------- Types declared in index.d.ts ----------

const declarations = existsSync(path.join(froalaDir, 'index.d.ts')) ? read('index.d.ts') : '';
const optionsInterface = declarations.match(/interface FroalaOptions\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
for (const m of optionsInterface.matchAll(/^\s*(\w+)\??\s*:\s*([^;]+);/gm)) {
  if (options[m[1]]) options[m[1]].declaredType = m[2].trim();
}

// ---------- Descriptions, types, events and methods from the docs ----------

const docsFile = path.join(root, 'data/docs.json');
const docsPages = existsSync(docsFile) ? JSON.parse(readFileSync(docsFile, 'utf8')).pages : [];
const docsPage = (suffix) => docsPages.find((p) => p.url.endsWith(suffix));

/** Splits a reference page into its ### sections: { heading, body }. */
function sections(page) {
  if (!page) return [];
  return [...page.markdown.matchAll(/^### (.+)\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/gm)].map((m) => ({ heading: m[1].trim(), body: m[2] }));
}
const unescape = (text) => text.replace(/\\([_[\]*])/g, '$1');
/** The first plain paragraph of a section, after the Type, Default, Plugin and Returns fields. */
function firstParagraph(body) {
  const paragraphs = body.replace(/```[\s\S]*?```/g, '\n\n[code]\n\n').split(/\n\s*\n/).map((p) => p.trim());
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (/^(Type|Default|Plugin|Returns):$/.test(p)) i++; // the field's value is the next paragraph
    else if (p && !/^(Type|Default|Plugin|Returns):/.test(p) && !/^[-#[*]/.test(p)) return unescape(p).replace(/\s+/g, ' ');
  }
  return '';
}
const fieldAfter = (body, label) => body.match(new RegExp(`${label}:\\s*\\n?\\s*([^\\n]+)`))?.[1].trim();

let documented = 0;
for (const { heading, body } of sections(docsPage('/docs/options/'))) {
  const option = options[heading];
  if (!option) continue;
  documented++;
  option.documented = true;
  option.docsType = fieldAfter(body, 'Type');
  option.description = firstParagraph(body);
}

const callable = (page) =>
  sections(page)
    .map(({ heading, body }) => {
      const m = unescape(heading).match(/^([\w.]+)\s*\((.*)\)\s*$/);
      if (!m) return null;
      const returns = fieldAfter(body, 'Returns');
      return { name: m[1], args: m[2].trim(), ...(returns ? { returns } : {}), description: firstParagraph(body) };
    })
    .filter(Boolean);
const events = callable(docsPage('/docs/events/'));
const methods = callable(docsPage('/docs/methods/'));

// ---------- Write ----------

const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
const metadata = {
  froalaVersion,
  generatedAt: new Date().toISOString(),
  docsBuiltAt: existsSync(docsFile) ? JSON.parse(readFileSync(docsFile, 'utf8')).builtAt : null,
  editorMembers,
  options: sortKeys(options),
  plugins: sortKeys(plugins),
  buttons: sortKeys(buttons),
  events: events.sort((a, b) => a.name.localeCompare(b.name)),
  methods: methods.sort((a, b) => a.name.localeCompare(b.name))
};

// Write to a temporary file first, so a failed run never leaves a half-written file behind.
mkdirSync(path.join(root, 'data'), { recursive: true });
const target = process.env.METADATA_OUT ?? path.join(root, 'data/metadata.json');
writeFileSync(`${target}.tmp`, JSON.stringify(metadata, null, 1));
renameSync(`${target}.tmp`, target);
console.log(
  `froala-editor ${froalaVersion}: ${Object.keys(options).length} options (${documented} documented), ${Object.keys(plugins).length} plugins, ` +
    `${Object.keys(buttons).length} buttons, ${events.length} events, ${methods.length} methods`
);
window.close();
