// Loads the data built by scripts/build-docs.mjs and scripts/build-metadata.mjs.
import metadataJson from '../data/metadata.json' with { type: 'json' };
import docsJson from '../data/docs.json' with { type: 'json' };

export interface HelperLibrary {
  package: string;
  global: string;
  note: string;
  optional?: boolean;
  onlyFor?: string[];
}

export interface OptionInfo {
  default: unknown;
  plugin: string | null;
  /** The type in the package's index.d.ts, when it is declared there. */
  declaredType?: string;
  /** The type on the docs options page, when the option is documented. */
  docsType?: string;
  documented?: boolean;
  description?: string;
}

export interface PluginInfo {
  file: string;
  css: string | null;
  /** True when froala_editor.pkgd.min.css already has this plugin's styles. */
  cssInEditorCss: boolean;
  thirdParty: boolean;
  /** True when plugins.pkgd.min.js (all plugins) includes this plugin. */
  inAllPluginsBundle: boolean;
  options: string[];
  buttons: string[];
  helperLibraries: HelperLibrary[];
}

/** An event or method from the docs, e.g. { name: 'html.get', args: '[keep_markers]', returns: 'String' }. */
export interface CallableInfo {
  name: string;
  args: string;
  returns?: string;
  description: string;
}

export interface Metadata {
  froalaVersion: string;
  generatedAt: string;
  docsBuiltAt: string | null;
  /** Names on the editor instance, such as html, selection and table, so code can tell `this.html` is the editor. */
  editorMembers: string[];
  options: Record<string, OptionInfo>;
  plugins: Record<string, PluginInfo>;
  buttons: Record<string, { plugin: string | null }>;
  events: CallableInfo[];
  methods: CallableInfo[];
}

export interface DocPage {
  url: string;
  title: string;
  section: string;
  headings: string[];
  markdown: string;
  /** The page's code uses Froala 2 event handlers, function (e, editor). */
  legacyCode?: boolean;
}

export const metadata = metadataJson as unknown as Metadata;
const docsData = docsJson as unknown as { builtAt: string; pages: DocPage[] };
export const docs = docsData.pages;
export const FROALA_VERSION = metadata.froalaVersion;

/** Where the answers come from. Tools return this so an answer can be checked against its source. */
export const SOURCE = { froala_version: FROALA_VERSION, docs_snapshot: docsData.builtAt.slice(0, 10) };

export const OPTIONS_PAGE = 'https://froala.com/wysiwyg-editor/docs/options/';
export const EVENTS_PAGE = 'https://froala.com/wysiwyg-editor/docs/events/';
export const METHODS_PAGE = 'https://froala.com/wysiwyg-editor/docs/methods/';

/** Settings the framework wrappers read from the same settings object, with the wrapper that reads them. */
export const WRAPPER_KEYS: Record<string, string> = {
  immediateReactModelUpdate: 'react-froala-wysiwyg',
  reactIgnoreAttrs: 'react-froala-wysiwyg',
  immediateVueModelUpdate: 'vue-froala-wysiwyg',
  vueIgnoreAttrs: 'vue-froala-wysiwyg',
  immediateAngularModelUpdate: 'angular-froala-wysiwyg',
  angularIgnoreAttrs: 'angular-froala-wysiwyg'
};

/** Settings Froala accepts that are not in FroalaEditor.DEFAULTS. */
export const EXTRA_CONFIG_KEYS = new Set(['key', 'events', ...Object.keys(WRAPPER_KEYS)]);

const kebab = (name: string) => name.replace(/_/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** The docs page for a plugin, if the docs have one. */
export function pluginDocsUrl(plugin: string): string | undefined {
  const slug = kebab(plugin);
  const pages = docs.filter((p) => p.url.includes('/docs/plugins/'));
  const exact = pages.find((p) => p.url.endsWith(`/plugins/${slug}-plugin/`) || p.url.endsWith(`/plugins/${slug}/`));
  return (exact ?? pages.find((p) => p.url.includes(`/plugins/${slug}`)))?.url;
}
