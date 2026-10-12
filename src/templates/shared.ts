import { metadata, FROALA_VERSION } from '../data.js';
import type { Framework, Project } from '../project.js';

export type PluginSet = 'essentials' | 'all';

export interface SetupFile {
  path: string;
  content: string;
}

export interface Setup {
  framework: Framework;
  froala_version: string;
  install: string;
  files: SetupFile[];
  notes: string[];
  docs_url: string;
}

export interface TemplateOptions {
  typescript: boolean;
  plugins: PluginSet;
  project: Project;
}

/**
 * The toolbar used by the "essentials" setup. Each group shows its first buttons (buttonsVisible)
 * and keeps the rest behind a "more" button. Each button's plugin is loaded by essentialPluginFiles().
 */
export const ESSENTIALS_TOOLBAR = {
  moreText: { buttons: ['bold', 'italic', 'underline', 'strikeThrough', 'fontSize', 'textColor', 'backgroundColor', 'clearFormatting'], buttonsVisible: 3 },
  moreParagraph: { buttons: ['paragraphFormat', 'formatUL', 'formatOL', 'alignLeft', 'alignCenter', 'alignRight', 'outdent', 'indent'], buttonsVisible: 3 },
  moreRich: { buttons: ['insertLink', 'insertImage', 'insertTable'], buttonsVisible: 3 },
  moreMisc: { buttons: ['undo', 'redo'], align: 'right', buttonsVisible: 2 }
};

/** Plugin files needed by the essentials toolbar, read from the metadata so they always match. */
export function essentialPluginFiles(): string[] {
  const plugins = new Set<string>();
  for (const group of Object.values(ESSENTIALS_TOOLBAR)) {
    for (const button of group.buttons) {
      const plugin = metadata.buttons[button]?.plugin;
      if (plugin) plugins.add(plugin);
    }
  }
  return [...plugins].map((p) => metadata.plugins[p].file).sort();
}

export const ALL_PLUGINS_FILE = 'froala-editor/js/plugins.pkgd.min.js';
export const EDITOR_CSS = ['froala-editor/css/froala_editor.pkgd.min.css', 'froala-editor/css/froala_style.min.css'];

export const pluginFiles = (plugins: PluginSet) => (plugins === 'all' ? [ALL_PLUGINS_FILE] : essentialPluginFiles());

/** Import lines for the plugins of the chosen set. */
export const pluginImports = (plugins: PluginSet) => pluginFiles(plugins).map((f) => `import '${f}';`).join('\n');

export const cssImports = () => EDITOR_CSS.map((f) => `import '${f}';`).join('\n');

/**
 * The default import of a wrapper. With Froala 5.5.0 and Vite 8 a default import returns the whole
 * CommonJS module, so the code takes the export from it. That line keeps working once the wrapper is fixed.
 */
export function wrapperImport(name: string, pkg: string, options: { typescript: boolean; importBug: boolean; typed: boolean }) {
  if (!options.importBug) return { importLine: `import ${name} from '${pkg}';`, fixLines: '' };
  const imported = `${name}Import`;
  const value =
    options.typescript && options.typed
      ? `(${imported} as unknown as { default?: typeof ${imported} }).default ?? ${imported}`
      : `${imported}.default ?? ${imported}`;
  return {
    importLine: `import ${imported} from '${pkg}';`,
    fixLines: `\n// Froala ${FROALA_VERSION} with Vite 8: a default import returns the whole module, so take the export from it.\nconst ${name} = ${value};\n`
  };
}

/** Renders a value as a JavaScript literal: unquoted keys, single-quoted strings. */
export function toJs(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    const items = value.map((v) => toJs(v, indent + 1));
    const oneLine = `[${items.join(', ')}]`;
    return oneLine.length <= 90 ? oneLine : `[\n${items.map((i) => inner + i).join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    if ('__code' in value) return String((value as { __code: string }).__code);
    const entries = Object.entries(value).map(([k, v]) => `${inner}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${toJs(v, indent + 1)}`);
    return `{\n${entries.join(',\n')}\n${pad}}`;
  }
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(value);
}

/** The editor settings, with the licence key read from the given expression. */
export function editorConfig(keyExpression: string, plugins: PluginSet, indent = 0): string {
  const config: Record<string, unknown> = {
    key: { __code: keyExpression },
    placeholderText: 'Start writing...',
    heightMin: 300,
    // Images added by URL stay plain links. By default Froala reads them through its hosted proxy.
    imageUploadRemoteUrls: false
  };
  if (plugins === 'essentials') config.toolbarButtons = ESSENTIALS_TOOLBAR;
  return toJs(config, indent);
}

export const pluginNote = (plugins: PluginSet) =>
  plugins === 'all'
    ? 'This setup loads every Froala plugin (plugins.pkgd.min.js) and uses the default toolbar. It adds roughly 1.5 MB to your bundle; use plugins: "essentials" for a smaller one.'
    : 'This setup loads only the plugins its toolbar needs: align, colors, font size, image, link, lists, paragraph format and table. To add a button later, call froala_lookup with kind "button" to see which plugin it needs.';

export const KEY_NOTE = (where: string) =>
  `No key is needed on localhost. Before you deploy anywhere else, even a preview, put a key in ${where}: a free trial key from https://froala.com/get-trial-key/ or your licence key. Without one, other domains show an unlicensed banner and block most toolbar buttons.`;

/** Notes every editor setup shares. */
export const COMMON_NOTES = [
  "Uploads need a server. Until imageUploadURL points at an endpoint that stores the file and returns { link }, uploaded images exist only in the browser and disappear on reload. Images added by URL work without a server.",
  "Your app's global CSS also applies inside the editor. If headings, paragraphs or lists look unstyled there (a CSS reset does this), restore them for .fr-view as froala-content.css does in the Tailwind setup."
];

/**
 * Tailwind's preflight removes list bullets, heading sizes and margins, and Froala's CSS doesn't set them
 * again. This file brings back the browser's own styles inside the editor and in saved content (.fr-view).
 */
export const TAILWIND_CSS = `/* Tailwind's preflight removes list bullets, heading sizes and margins. This brings them back inside the editor. */
.fr-view :where(h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote, pre, hr, a) {
  margin: revert;
  padding: revert;
  font-size: revert;
  font-weight: revert;
  list-style: revert;
  text-decoration: revert;
}
`;

/** The file and import line for TAILWIND_CSS, when the project uses Tailwind. */
export function tailwindFix(project: Project, dir: string): { file?: SetupFile; importLine: string } {
  if (!project.has('tailwindcss')) return { importLine: '' };
  return { file: { path: `${dir}froala-content.css`, content: TAILWIND_CSS }, importLine: "import './froala-content.css';\n" };
}

/** npm install for Froala and its wrapper, both at the version this server covers. */
export function installCommand(wrapper?: string): string {
  const packages = [`froala-editor@${FROALA_VERSION}`, ...(wrapper ? [`${wrapper}@${FROALA_VERSION}`] : [])];
  return `npm install --save-exact ${packages.join(' ')}`;
}

export const PIN_NOTE = (wrapper: string) =>
  `${wrapper} depends on exactly froala-editor ${FROALA_VERSION}, so the install command pins both. Upgrade them together; different versions install two copies of the editor, and plugins you import load into the wrong one.`;

export function base(framework: Framework, install: string, docsUrl: string): Omit<Setup, 'files' | 'notes'> {
  return { framework, froala_version: FROALA_VERSION, install, docs_url: docsUrl };
}
