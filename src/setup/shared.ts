// What every setup shares, which is the install command, the file names, the notes and the rendering of values as code.
import semver from 'semver';
import { content, FROALA_VERSION, metadata, TRIAL_KEY } from '../data.js';
import { newerThanData, type Project, type Target } from '../project.js';
import { presetSettings, type Preset } from '../presets.js';

export interface SetupFile {
  path: string;
  content: string;
}

export interface Setup {
  target: Target;
  froala_version: string;
  preset: string;
  install: string;
  files: SetupFile[];
  notes: string[];
  docs_url: string;
}

export interface TemplateOptions {
  typescript: boolean;
  preset: Preset;
  project: Project;
}

export const ALL_PLUGINS_FILE = 'froala-editor/js/plugins.pkgd.min.js';
export const EDITOR_CSS = ['froala-editor/css/froala_editor.pkgd.min.css', 'froala-editor/css/froala_style.min.css'];
export const START = '<p>Start writing here.</p>';

/** The plugin files a preset imports. */
export const pluginFiles = (preset: Preset) => (preset.allPlugins ? [ALL_PLUGINS_FILE] : preset.plugins.map((plugin) => metadata.plugins[plugin].file).sort());

/** Stylesheets of third-party plugins, which froala_editor.pkgd.min.css does not include. */
const pluginCss = (preset: Preset) =>
  preset.plugins
    .map((plugin) => metadata.plugins[plugin])
    .filter((info) => info.css && !info.cssInEditorCss)
    .map((info) => info.css as string);

const importLine = (file: string) => `import '${file}';`;
export const cssImports = (preset: Preset) => [...EDITOR_CSS, ...pluginCss(preset)].map(importLine).join('\n');
export const pluginImports = (preset: Preset) => pluginFiles(preset).map(importLine).join('\n');

/** Renders a value as a JavaScript literal, with unquoted keys and single-quoted strings. */
export function toJs(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    const items = value.map((item) => toJs(item, indent + 1));
    const oneLine = `[${items.join(', ')}]`;
    return oneLine.length <= 90 ? oneLine : `[\n${items.map((item) => inner + item).join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    if ('__code' in value) return String((value as { __code: string }).__code);
    const entries = Object.entries(value).map(([key, item]) => `${inner}${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${toJs(item, indent + 1)}`);
    return `{\n${entries.join(',\n')}\n${pad}}`;
  }
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(value);
}

/** The settings of a preset as code. The trial key is the fallback, so the key is never missing, and a key the project sets always wins. */
export const editorConfig = (preset: Preset, keyVariable?: string, indent = 0) =>
  toJs({ key: { __code: keyVariable ? `${keyVariable} || '${TRIAL_KEY}'` : `'${TRIAL_KEY}'` }, ...presetSettings(preset) }, indent);

/** The enhancements file, in the project's language. */
export const enhancementsFile = (dir: string, typescript: boolean): SetupFile => ({
  path: `${dir}froala-enhancements.${typescript ? 'ts' : 'js'}`,
  content: typescript ? content.enhancements.typescript : content.enhancements.javascript
});

/**
 * Tailwind's preflight removes list bullets, heading sizes and margins, and Froala's CSS does not set them
 * again. This file brings back the browser's own styles inside the editor and in saved content (.fr-view).
 */
export const TAILWIND_CSS = `/* Brings back list bullets, heading sizes and margins inside the editor, which Tailwind's preflight removes. */
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
export function tailwindFix(project: Project, dir: string): { files: SetupFile[]; importLine: string } {
  if (!project.has('tailwindcss')) return { files: [], importLine: '' };
  return { files: [{ path: `${dir}froala-content.css`, content: TAILWIND_CSS }], importLine: "import './froala-content.css';\n" };
}

/** npm install for Froala and its wrapper. A project that already asks for a newer Froala keeps that version, and only adds what is missing. */
export function installCommand(project: Project, wrapper?: string): string {
  const packages = ['froala-editor', ...(wrapper ? [wrapper] : [])];
  const newest = newestListed(project);
  if (!newest) return `npm install --save-exact ${packages.map((name) => `${name}@${FROALA_VERSION}`).join(' ')}`;
  const toInstall = packages.filter((name) => project.version(name) !== newest);
  return toInstall.length ? `npm install --save-exact ${toInstall.map((name) => `${name}@${newest}`).join(' ')}` : 'npm install';
}

/** The newest Froala version the project lists, when it is newer than the release this server covers. */
function newestListed(project: Project): string | undefined {
  const listed = newerThanData(project).map((entry) => entry.split(' ')[1]);
  return listed.sort(semver.rcompare)[0];
}

export const PIN_NOTE = (wrapper: string) =>
  `${wrapper} depends on exactly one froala-editor version, so both packages must have the same version. Upgrade them together. Different versions install two copies of the editor, and plugins you import load into the wrong one.`;

export const KEY_NOTE = (where: string) =>
  `The preset uses Froala's public trial key, so every feature works at once and the editor shows a trial notice. It is not for production. Put your licence key in ${where}, and the preset uses it in place of the trial key. If this project already sets a commercial key, keep that key, even if it has expired.`;

export const ENHANCEMENTS_NOTE =
  'froala-enhancements adds safe pasting, keyboard access to the toolbar, screen reader names and clear upload messages to every editor. It is one file with one small function per enhancement. Keep it in your project and copy a new version when you upgrade Froala.';

/** Notes every editor setup shares. */
export const COMMON_NOTES = [
  'Uploads need a server. Until imageUploadURL points at an endpoint that stores the file and returns { link }, uploaded images exist only in the browser and disappear on reload. Images added by URL work without a server.',
  'Your app\'s global CSS also applies inside the editor. If headings, paragraphs or lists look unstyled there, call froala_get_integration with name "tailwind" for the styles to restore.'
];

export const base = (target: Target, install: string, docsUrl: string, preset: Preset): Omit<Setup, 'files' | 'notes'> => ({
  target,
  froala_version: FROALA_VERSION,
  preset: preset.id,
  install,
  docs_url: docsUrl
});
