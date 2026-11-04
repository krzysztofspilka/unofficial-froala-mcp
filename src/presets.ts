// The presets in content/presets.json, turned into toolbars, plugin lists and editor settings.
// To add a preset, add an entry to that file. To add a feature name, add it to one of the two tables below.
import presetsJson from '../content/presets.json' with { type: 'json' };
import { metadata, type HelperLibrary } from './data.js';
import { phoneToolbar, toolbarRows } from './toolbar.js';

/** Features that add toolbar buttons. */
const FEATURE_BUTTONS: Record<string, string[]> = {
  history: ['undo', 'redo'],
  print: ['print'],
  paragraphFormat: ['paragraphFormat'],
  fontFamily: ['fontFamily'],
  fontSize: ['fontSize'],
  basic: ['bold', 'italic', 'underline'],
  bold: ['bold'],
  italic: ['italic'],
  strikeThrough: ['strikeThrough'],
  colors: ['textColor', 'backgroundColor'],
  inlineClass: ['inlineClass'],
  inlineStyle: ['inlineStyle'],
  paragraphStyle: ['paragraphStyle'],
  link: ['insertLink'],
  linkToAnchor: ['insertAnchor'],
  image: ['insertImage'],
  video: ['insertVideo'],
  file: ['insertFile'],
  table: ['insertTable'],
  codeSnippet: ['codeSnippet'],
  pageBreak: ['pageBreak'],
  horizontalLine: ['insertHR'],
  emoticons: ['emoticons'],
  specialCharacters: ['specialCharacters'],
  align: ['align'],
  lineHeight: ['lineHeight'],
  lists: ['formatUL', 'formatOL'],
  bulletList: ['formatUL'],
  indent: ['outdent', 'indent'],
  quote: ['quote'],
  clearFormatting: ['clearFormatting'],
  ai: ['aiAssist', 'aiImproveWriting', 'aiChangeTone', 'aiTranslateTo', 'aiChatAssistant'],
  collaboration: ['collabMode', 'collabPanel', 'versionControl'],
  trackChanges: ['trackChanges'],
  findReplace: ['findReplaceButton'],
  importFromWord: ['import_from_word'],
  exportToWord: ['export_to_word'],
  codeView: ['html'],
  markdown: ['markdown'],
  fullscreen: ['fullscreen'],
  help: ['help']
};

/** Features that work without a toolbar button. Each is a plugin name. */
const FEATURE_PLUGINS = new Set(['url', 'charCounter', 'wordCounter', 'wordPaste', 'quickInsert', 'draggable', 'lineBreaker', 'codeBeautifier', 'entities']);

export interface Preset {
  id: string;
  title: string;
  group: string;
  useWhen: string;
  buttons: string[];
  phoneButtons?: string[];
  /** Every Froala plugin file this preset needs, or an empty list with allPlugins. */
  plugins: string[];
  /** The preset loads plugins.pkgd.min.js. */
  allPlugins: boolean;
  /** Headless presets have no Froala toolbar. */
  noToolbar: boolean;
  options: Record<string, unknown>;
  extensions: string[];
  notes: string[];
}

interface PresetEntry {
  id: string;
  title: string;
  group: string;
  use_when: string;
  features: string[];
  phone_buttons?: string[];
  all_plugins?: boolean;
  no_toolbar?: boolean;
  options?: Record<string, unknown>;
  extensions?: string[];
  notes?: string[];
}

function toPreset(entry: PresetEntry): Preset {
  const buttons = entry.features.flatMap((feature) => FEATURE_BUTTONS[feature] ?? []);
  const unknown = entry.features.filter((feature) => !FEATURE_BUTTONS[feature] && !FEATURE_PLUGINS.has(feature));
  if (unknown.length) throw new Error(`Preset ${entry.id} uses unknown features: ${unknown.join(', ')}`);
  const fromButtons = buttons.map((button) => metadata.buttons[button]?.plugin).filter((plugin): plugin is string => !!plugin);
  const plugins = [...new Set([...fromButtons, ...entry.features.filter((feature) => FEATURE_PLUGINS.has(feature))])].sort();
  return {
    id: entry.id,
    title: entry.title,
    group: entry.group,
    useWhen: entry.use_when,
    buttons,
    phoneButtons: entry.phone_buttons,
    plugins: entry.all_plugins ? [] : plugins,
    allPlugins: !!entry.all_plugins,
    noToolbar: !!entry.no_toolbar,
    options: entry.options ?? {},
    extensions: entry.extensions ?? [],
    notes: entry.notes ?? []
  };
}

export const PRESETS: Preset[] = (presetsJson as PresetEntry[]).map(toPreset);

export const DEFAULT_PRESET = 'simple';

/** The plugins a preset uses, counting everything in the bundle for presets that load it. */
export const pluginsUsedBy = (preset: Preset): string[] => (preset.allPlugins ? Object.keys(metadata.plugins).filter((name) => metadata.plugins[name].inAllPluginsBundle) : preset.plugins);

/** The editor settings of a preset, without the licence key. */
export function presetSettings(preset: Preset): Record<string, unknown> {
  const hasImages = pluginsUsedBy(preset).includes('image');
  return {
    ...(preset.noToolbar ? {} : { toolbarButtons: toolbarRows(preset.buttons), toolbarButtonsXS: phoneToolbar(preset.buttons, preset.phoneButtons) }),
    placeholderText: 'Start writing...',
    heightMin: 300,
    // Scripts in content never run, and images added by URL stay plain links.
    htmlExecuteScripts: false,
    ...(hasImages ? { imageUploadRemoteUrls: false } : {}),
    ...preset.options
  };
}

/** What a preset's plugins need from the app, such as helper libraries. */
export function presetRequirements(preset: Preset): string[] {
  const fromButtons = preset.buttons.map((button) => metadata.buttons[button]?.plugin).filter((plugin): plugin is string => !!plugin);
  const needed = (lib: HelperLibrary) => !lib.optional && (!lib.onlyFor || lib.onlyFor.some((button) => preset.buttons.includes(button)));
  const helpers = [...preset.plugins, ...fromButtons].flatMap((plugin) =>
    metadata.plugins[plugin].helperLibraries.filter(needed).map((lib) => `The ${plugin} plugin needs ${lib.package}. ${lib.note}`)
  );
  return [...new Set(helpers)];
}
