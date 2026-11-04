// The checks run by froala_audit_code. File checks look at one file at a time. Project checks look at
// everything that was sent together, because plugins, CSS and libraries are often loaded in another file
// than the settings, and at package.json for version-specific problems.
// An error is a confirmed problem, a warning is a likely problem to confirm, and a tip is optional.
// To add a check, write a small function below and add it to FILE_CHECKS or PROJECT_CHECKS.
import semver from 'semver';
import { knowledge, metadata, ENHANCEMENTS_PLUGIN, EXTRA_CONFIG_KEYS, FROALA_VERSION, TRIAL_KEY, WRAPPER_KEYS } from '../data.js';
import { froalaAtMost, wrapperImportBug, WRAPPER_FOR, type Project } from '../project.js';
import { closest } from '../util.js';
import {
  type Context,
  type Node,
  keyName,
  properties,
  stringValue,
  walk,
  loadsAllPlugins,
  loadsFroalaScripts,
  loadsEditorCss,
  loadsContentCss,
  loadedPlugins,
  loadsPath,
  pluginOfPath
} from './context.js';

export type Level = 'error' | 'warning' | 'tip';

export interface Finding {
  check: string;
  level: Level;
  file?: string;
  line?: number;
  message: string;
  fix: string;
}

/** Everything froala_audit_code received. */
export interface Sent {
  files: Context[];
  /** From package.json, when it was sent. */
  project?: Project;
  /** CSS and scripts listed in angular.json, nuxt.config or CSS files, when sent. */
  configCss: string[];
  configScripts: string[];
  angularJson: boolean;
  nuxtConfig: boolean;
}

type FileCheck = (ctx: Context) => Omit<Finding, 'file'>[];
type ProjectCheck = (sent: Sent) => Finding[];

// Setting names people bring from other editors, mapped to Froala's name.
const OPTION_ALIASES: Record<string, string> = {
  placeholder: 'placeholderText',
  licenseKey: 'key',
  licenceKey: 'key',
  license: 'key',
  licence: 'key',
  toolbar: 'toolbarButtons',
  plugins: 'pluginsEnabled',
  minHeight: 'heightMin',
  maxHeight: 'heightMax'
};

const lineOfText = (code: string, index: number) => code.slice(0, index).split('\n').length;
const configsOf = (ctx: Context) => ctx.configs.map((c) => c.node);
const EVENT_NAMES = new Set(metadata.events.map((e) => e.name));
// The buttons and settings of the extensions from froala_find_presets count as known names.
const EXTENSION_BUTTONS = new Set(knowledge.extensions.flatMap((e) => e.buttons ?? []));
const EXTENSION_OPTIONS = new Set(knowledge.extensions.flatMap((e) => e.options ?? []));
const EDITOR_MEMBERS = new Set(metadata.editorMembers);

// ---------- File checks ----------

/** Suggestions compare a name with every option, so a file with thousands of unknown names gets them for the first few only. */
const MAX_SUGGESTIONS = 100;

const unknownOption: FileCheck = (ctx) => {
  const names = [...Object.keys(metadata.options), ...EXTRA_CONFIG_KEYS];
  let suggested = 0;
  return configsOf(ctx).flatMap((config) =>
    properties(config)
      .map((prop) => ({ prop, name: keyName(prop) }))
      .filter(({ name }) => name && !metadata.options[name] && !EXTRA_CONFIG_KEYS.has(name) && !EXTENSION_OPTIONS.has(name))
      .map(({ prop, name }) => {
        suggested += 1;
        const suggestion = suggested <= MAX_SUGGESTIONS ? closest(name!, names, OPTION_ALIASES) : undefined;
        return {
          check: 'unknown-option',
          level: 'warning' as const,
          line: ctx.line(prop),
          message: `${name} is not a Froala option, so the editor ignores it.`,
          fix: suggestion ? `Use ${suggestion}.` : 'Call froala_query_docs in lookup mode with kind "option" and a query to find the right name.'
        };
      })
  );
};

/** The kinds of value an option accepts, from the docs type ("Object/Array") or the package's declared type ("string[]"). */
function acceptedKinds(name: string): Set<string> | undefined {
  const info = metadata.options[name];
  const type = (info?.docsType ?? info?.declaredType ?? '').toLowerCase();
  if (!type || /any|mixed/.test(type)) return undefined;
  const kinds = new Set<string>();
  // The option's own default is always an accepted kind of value.
  const fallback = info?.default;
  if (Array.isArray(fallback)) kinds.add('array');
  else if (fallback !== null && fallback !== undefined) kinds.add(typeof fallback);
  if (/bool/.test(type)) kinds.add('boolean');
  if (/string(?!\[\])|text|url|selector/.test(type)) kinds.add('string');
  if (/number|int|float/.test(type)) kinds.add('number');
  if (/array|\[\]/.test(type)) kinds.add('array');
  if (/object|\{/.test(type)) kinds.add('object');
  if (/function|=>/.test(type)) kinds.add('function');
  return kinds.size ? kinds : undefined;
}

function literalKind(node: Node): string | undefined {
  switch (node.type) {
    case 'BooleanLiteral':
      return 'boolean';
    case 'StringLiteral':
      return 'string';
    case 'TemplateLiteral':
      return 'string';
    case 'NumericLiteral':
      return 'number';
    case 'ArrayExpression':
      return 'array';
    case 'ObjectExpression':
      return 'object';
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return 'function';
    default:
      return undefined; // a variable or an expression, so its value is not known here
  }
}

const optionValues: FileCheck = (ctx) => {
  const findings: Omit<Finding, 'file'>[] = [];
  for (const config of configsOf(ctx)) {
    for (const prop of properties(config)) {
      const name = keyName(prop);
      if (!name || prop.type !== 'ObjectProperty' || name === 'events') continue;
      const kinds = acceptedKinds(name);
      const kind = literalKind(prop.value);
      // null and the "default" literal are accepted for most options, so only clear mismatches are reported.
      if (kinds && kind && !kinds.has(kind) && !(kind === 'string' && kinds.has('number') && /^\d+$/.test(stringValue(prop.value) ?? ''))) {
        const shown = kind === 'string' ? `the text '${stringValue(prop.value) ?? ''}'` : `a ${kind}`;
        findings.push({
          check: 'option-value',
          level: 'warning',
          line: ctx.line(prop),
          message: `${name} expects ${metadata.options[name].docsType ?? metadata.options[name].declaredType}, but gets ${shown}.`,
          fix:
            kind === 'string' && kinds.has('boolean') && /^(true|false)$/.test(stringValue(prop.value) ?? '')
              ? `Write ${stringValue(prop.value)} without quotes.`
              : `Call froala_query_docs in lookup mode with kind "option" and name "${name}" to see what it accepts.`
        });
      }
    }
    const enabled = properties(config).find((p) => keyName(p) === 'pluginsEnabled');
    for (const item of enabled?.value?.type === 'ArrayExpression' ? enabled.value.elements : []) {
      const plugin = stringValue(item);
      if (!plugin || plugin === ENHANCEMENTS_PLUGIN || metadata.plugins[plugin]) continue;
      const suggestion = closest(plugin, Object.keys(metadata.plugins));
      findings.push({
        check: 'unknown-plugin',
        level: 'warning',
        line: ctx.line(item),
        message: `pluginsEnabled lists ${plugin}, which is not a Froala plugin.`,
        fix: suggestion ? `Use ${suggestion}.` : 'Call froala_query_docs in lookup mode with kind "plugin" to list the plugin names.'
      });
    }
  }
  return findings;
};

const unknownEvent: FileCheck = (ctx) =>
  ctx.configs.flatMap((config) =>
    config.events
      .filter(({ name }) => name && !EVENT_NAMES.has(name) && !/^popups\.(show|hide)\./.test(name))
      .map(({ name, line }) => {
        const suggestion = closest(name, EVENT_NAMES);
        return {
          check: 'unknown-event',
          level: 'warning' as const,
          line,
          message: `${name} is not a Froala event, so this handler never runs.`,
          fix: suggestion ? `Use ${suggestion}.` : 'Call froala_query_docs in lookup mode with kind "event" and a query to find the right name.'
        };
      })
  );

const unknownButton: FileCheck = (ctx) =>
  ctx.configs
    .flatMap((c) => c.toolbar)
    .filter(({ name }) => name !== '|' && name !== '-' && !ctx.registeredCommands.has(name) && !metadata.buttons[name] && !EXTENSION_BUTTONS.has(name))
    .map(({ name, line }) => {
      const suggestion = closest(name, Object.keys(metadata.buttons));
      return {
        check: 'unknown-button',
        level: 'warning' as const,
        line,
        message: `${name} is not a Froala toolbar button.`,
        fix: suggestion
          ? `Use ${suggestion}. If ${name} is your own button, register it with FroalaEditor.RegisterCommand.`
          : 'If it is your own button, register it with FroalaEditor.RegisterCommand. Otherwise call froala_query_docs in lookup mode with kind "button".'
      };
    });

const azureAccessKey: FileCheck = (ctx) =>
  configsOf(ctx).flatMap((config) =>
    properties(config)
      .filter((prop) => /UploadToAzure$/.test(keyName(prop) ?? '') && prop.value?.type === 'ObjectExpression')
      .flatMap((prop) =>
        properties(prop.value)
          .filter((p) => keyName(p) === 'accessKey')
          .map((p) => ({ prop, accessKey: p }))
      )
      .map(({ prop, accessKey }) => ({
        check: 'azure-access-key',
        level: 'error' as const,
        line: ctx.line(accessKey),
        message: `${keyName(prop)}.accessKey puts your Azure storage account key in browser code, where anyone can read it.`,
        fix: `Create a SAS token on your server and pass it as ${keyName(prop)}.SASToken instead.`
      }))
  );

/**
 * Editor parts a function uses through a name. For example, editor.html.get() gives ["html"]. Only parts used
 * as objects count, such as this.html.get() and this.el.focus(). Editor parts are never called directly, so
 * this.save() means the surrounding code's own save, not the editor's save plugin.
 */
function membersUsed(body: Node, objectIs: (object: Node) => boolean): string[] {
  const used: string[] = [];
  walk(body, (n) => {
    const inner = n.type === 'MemberExpression' ? n.object : undefined;
    if (inner?.type === 'MemberExpression' && !inner.computed && objectIs(inner.object) && inner.property.type === 'Identifier') used.push(inner.property.name);
  });
  return used;
}

/**
 * Since Froala 3 the editor is `this` inside event handlers. Two mistakes follow from older examples.
 * One is a handler that expects the editor as a parameter, and the other is an arrow function that uses `this` for the editor.
 * Both are reported only when the code uses editor members such as html or selection, because an arrow
 * function may use `this` on purpose (for example this.save() in a class).
 */
const eventHandlers: FileCheck = (ctx) => {
  const findings: Omit<Finding, 'file'>[] = [];
  for (const { name, line, node } of ctx.configs.flatMap((c) => c.events)) {
    const fn: Node | undefined = node.type === 'ObjectMethod' ? node : node.value;
    if (!fn || !(fn.type === 'ObjectMethod' || /Function/.test(fn.type))) continue;
    const editorParam = fn.params.find((p: Node) => p.type === 'Identifier' && p.name === 'editor');
    const viaParam = editorParam ? membersUsed(fn.body, (o) => o.type === 'Identifier' && o.name === 'editor').filter((m) => EDITOR_MEMBERS.has(m)) : [];
    if (viaParam.length) {
      findings.push({
        check: 'event-handler-this',
        level: 'warning',
        line,
        message: `The ${name} handler uses editor.${viaParam[0]} from a parameter. Since Froala 3 the editor is \`this\`, and the parameters are the event's own values, so editor.${viaParam[0]} fails.`,
        fix: `Use a regular function and this, for example ${name}: function () { this.${viaParam[0]} ... }`
      });
    } else if (fn.type === 'ArrowFunctionExpression') {
      const viaThis = membersUsed(fn.body, (o) => o.type === 'ThisExpression').filter((m) => EDITOR_MEMBERS.has(m));
      if (viaThis.length) {
        findings.push({
          check: 'event-handler-this',
          level: 'warning',
          line,
          message: `The ${name} handler is an arrow function that uses this.${viaThis[0]}. In an arrow function \`this\` is the surrounding code, not the editor.`,
          fix: `Use a regular function if this.${viaThis[0]} means the editor, as in ${name}: function () { ... }. Keep the arrow function if this is meant to be your own class or component.`
        });
      }
    }
  }
  return findings;
};

const angularStandaloneForRoot: FileCheck = (ctx) => {
  const match = ctx.code.match(/(FroalaEditorModule|FroalaViewModule)\.forRoot\(\)/);
  if (!match || !/@Component\s*\(/.test(ctx.code) || /@NgModule\s*\(/.test(ctx.code)) return [];
  return [
    {
      check: 'angular-forroot',
      level: 'error',
      line: lineOfText(ctx.code, match.index ?? 0),
      message: 'Standalone components cannot use forRoot(). The build fails with NG2012.',
      fix: 'List the modules directly, as in imports: [FroalaEditorModule, FroalaViewModule].'
    }
  ];
};

const vueVModel: FileCheck = (ctx) => {
  const match = ctx.code.match(/<froala\b[^>]*\sv-model(?=[\s=])/);
  return match
    ? [
        {
          check: 'vue-v-model',
          level: 'warning',
          line: lineOfText(ctx.code, match.index ?? 0),
          message: 'The Froala Vue component reports changes through value, so plain v-model never updates your data.',
          fix: 'Use v-model:value="..." on <froala>.'
        }
      ]
    : [];
};

/** Next.js 15 and newer refuse next/dynamic with server rendering off in Server Components. */
const nextDynamicInServerComponent: FileCheck = (ctx) =>
  ctx.target === 'nextjs' && ctx.noSsrImports.length > 0 && !/^\s*['"]use client['"]/m.test(ctx.code) && /(^|\/)app\//.test(ctx.fileName)
    ? [
        {
          check: 'client-only-loading',
          level: 'error',
          message: 'This file uses next/dynamic with ssr: false but has no "use client", and Next.js does not allow that in Server Components.',
          fix: 'Add "use client" at the top of this file, or move the dynamic import into a client component.'
        }
      ]
    : [];

const cdnVersion: FileCheck = (ctx) =>
  ctx.paths
    .map((p) => p.replace(/[?#].*$/, ''))
    .filter((p) => /(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/froala-editor(\/|@)/.test(p) && !/froala-editor@\d+\.\d+\.\d+\//.test(p))
    .slice(0, 1)
    .map(() => ({
      check: 'cdn-version',
      level: 'tip' as const,
      message: 'A Froala CDN link is not pinned to an exact version, so your editor can change without warning.',
      fix: `Use an exact version, such as froala-editor@${FROALA_VERSION}, in every Froala CDN link.`
    }));

const usesFroala = (ctx: Context) => ctx.createsEditor || ctx.configs.length > 0 || ctx.paths.some((p) => /froala/i.test(p));

const fontAwesome: FileCheck = (ctx) =>
  usesFroala(ctx) && ctx.paths.some((p) => /font-awesome|fontawesome/i.test(p)) && !/iconsTemplate\s*:\s*['"]font_awesome/.test(ctx.code)
    ? [
        {
          check: 'font-awesome',
          level: 'tip',
          message: 'Froala draws its own SVG icons, so the editor does not need Font Awesome.',
          fix: "If nothing else in your app uses Font Awesome and you do not set iconsTemplate: 'font_awesome', you can remove it."
        }
      ]
    : [];

const SECURITY_FIXES = [
  { name: 'mammoth', pattern: /mammoth[/@](\d+\.\d+\.\d+)/, fixedIn: '1.11.0', advisory: 'GHSA-rmjr-87wv-gf87', use: 'mammoth 1.11.0 or newer' },
  { name: 'CodeMirror', pattern: /codemirror[/@](5\.\d+\.\d+)/i, fixedIn: '5.58.2', advisory: 'GHSA-4gw3-8f77-f72c', use: 'CodeMirror 5.65.21 (the latest 5.x)' }
];

const outdatedLibraries: FileCheck = (ctx) =>
  SECURITY_FIXES.flatMap((lib) => {
    const version = ctx.paths.map((p) => p.match(lib.pattern)?.[1]).find(Boolean);
    return version && semver.valid(version) && semver.lt(version, lib.fixedIn)
      ? [
          {
            check: 'outdated-library',
            level: 'warning' as const,
            message: `${lib.name} ${version} has a known security issue (${lib.advisory}), fixed in ${lib.fixedIn}.`,
            fix: `Use ${lib.use}.`
          }
        ]
      : [];
  });

const sanitizeDisplay: FileCheck = (ctx) =>
  /FroalaEditorView|froalaView|<froala-view/.test(ctx.code) && ![...ctx.calls].some((c) => /(^|\.)sanitize$/i.test(c))
    ? [
        {
          check: 'sanitize-html',
          level: 'tip',
          message: 'This shows saved editor HTML as it is, and this file does not call a sanitizer. If the HTML can come from users, clean it first.',
          fix: 'Sanitize the HTML on your server, or call DOMPurify.sanitize() before showing it.'
        }
      ]
    : [];

export const FILE_CHECKS: FileCheck[] = [
  unknownOption,
  optionValues,
  unknownEvent,
  unknownButton,
  azureAccessKey,
  eventHandlers,
  angularStandaloneForRoot,
  vueVModel,
  nextDynamicInServerComponent,
  outdatedLibraries,
  cdnVersion,
  fontAwesome,
  sanitizeDisplay
];

// ---------- Project checks ----------

/** True when the sent files load Froala's scripts, which shows where plugins are loaded. */
const seesFroalaLoading = (sent: Sent) => sent.files.some(loadsFroalaScripts) || sent.configScripts.length > 0;
const IF_ELSEWHERE = ' If another file loads it, send that file too.';

const allLoadedPlugins = (sent: Sent) => {
  const loaded = new Set(sent.files.flatMap((f) => [...loadedPlugins(f)]));
  for (const path of sent.configScripts) {
    const plugin = pluginOfPath(path);
    if (plugin) loaded.add(plugin);
    if (/(plugins|froala_editor)\.pkgd/.test(path)) for (const [name, info] of Object.entries(metadata.plugins)) if (info.inAllPluginsBundle) loaded.add(name);
  }
  return loaded;
};

const buttonPlugins: ProjectCheck = (sent) => {
  const loaded = allLoadedPlugins(sent);
  const bundle = sent.files.some(loadsAllPlugins);
  const sees = seesFroalaLoading(sent);
  const findings: Finding[] = [];
  for (const ctx of sent.files) {
    for (const config of ctx.configs) {
      const missing = new Map<string, { buttons: string[]; line?: number; disabled: boolean }>();
      for (const { name, line } of config.toolbar) {
        const plugin = metadata.buttons[name]?.plugin;
        if (!plugin || ctx.registeredCommands.has(name)) continue;
        const disabled = !!config.pluginsEnabled && !config.pluginsEnabled.includes(plugin);
        if (!disabled && loaded.has(plugin)) continue;
        const entry = missing.get(plugin) ?? { buttons: [], line, disabled };
        entry.buttons.push(name);
        missing.set(plugin, entry);
      }
      for (const [plugin, { buttons, line, disabled }] of missing) {
        const info = metadata.plugins[plugin];
        const needs = `${buttons.join(', ')} need${buttons.length === 1 ? 's' : ''} the ${plugin} plugin`;
        const notInBundle = bundle && !info.inAllPluginsBundle ? ` plugins.pkgd.min.js does not include it.` : '';
        findings.push({
          check: 'button-plugin-missing',
          level: disabled || sees ? 'warning' : 'tip',
          file: ctx.fileName,
          line,
          message: disabled ? `${needs}, which is not listed in pluginsEnabled.` : `${needs}, and none of the files you sent load it.${notInBundle}${sees ? '' : IF_ELSEWHERE}`,
          fix: disabled ? `Add '${plugin}' to pluginsEnabled.` : `import '${info.file}';${info.css && !info.cssInEditorCss ? ` and import '${info.css}';` : ''}`
        });
      }
    }
  }
  return findings;
};

/** Third-party plugins such as imageTUI have their own stylesheet, which froala_editor.pkgd.min.css does not include. */
const pluginCss: ProjectCheck = (sent) => {
  const loadedCss = (file: string) => sent.files.some((f) => loadsPath(f, file)) || sent.configCss.some((p) => p.endsWith(file.replace('froala-editor/', '')));
  return [...allLoadedPlugins(sent)]
    .map((name) => ({ name, info: metadata.plugins[name] }))
    .filter(({ info }) => info.css && !info.cssInEditorCss && !loadedCss(info.css))
    .map(({ name, info }) => ({
      check: 'plugin-css-missing',
      level: 'warning' as const,
      message: `The ${name} plugin has its own stylesheet, which froala_editor.pkgd.min.css does not include, and none of the files you sent load it.`,
      fix: `import '${info.css}';`
    }));
};

const helperLibraries: ProjectCheck = (sent) => {
  const toolbarNames = new Set(sent.files.flatMap((f) => f.configs.flatMap((c) => c.toolbar.map((b) => b.name))));
  const used = new Set([...allLoadedPlugins(sent)].filter((p) => !metadata.plugins[p].inAllPluginsBundle || !sent.files.some(loadsAllPlugins)));
  for (const b of toolbarNames) {
    const plugin = metadata.buttons[b]?.plugin;
    if (plugin) used.add(plugin);
  }
  const globals = new Set(sent.files.flatMap((f) => [...f.windowGlobals]));
  const scripts = [...sent.files.flatMap((f) => f.paths), ...sent.configScripts];
  const findings: Finding[] = [];
  for (const plugin of used) {
    for (const lib of metadata.plugins[plugin]?.helperLibraries ?? []) {
      if (lib.optional || (lib.onlyFor && !lib.onlyFor.some((b) => toolbarNames.has(b)))) continue;
      const names = [lib.package.replace(/\.js$/, '').replace(/js$/, ''), lib.global, lib.package.replace(/-/g, '')].map((name) => name.toLowerCase());
      const loadedByScript = scripts.some((p) => names.some((name) => p.toLowerCase().includes(name)) && /^(https?:)?\/\/|\.js$/.test(p));
      const imported = sent.files.some((f) => f.paths.includes(lib.package));
      if (globals.has(lib.global) || (loadedByScript && !imported)) continue;
      const installed = sent.project?.has(lib.package);
      findings.push({
        check: 'plugin-library-missing',
        level: sent.project || seesFroalaLoading(sent) ? 'warning' : 'tip',
        message: imported
          ? `The ${plugin} plugin reads window.${lib.global}. ${lib.package} is imported, but none of the files you sent assign it to window.${lib.global}.`
          : `The ${plugin} plugin needs ${lib.package} as window.${lib.global}, and none of the files you sent load it${sent.project ? (installed ? '' : ', and package.json does not list it') : ''}.`,
        fix: `${installed || imported ? '' : `Run npm install ${lib.package}. `}${lib.note}`
      });
    }
  }
  return findings;
};

const cssMissing: ProjectCheck = (sent) => {
  const editorFile = sent.files.find((f) => f.createsEditor);
  if (!editorFile) return [];
  const editorCss = sent.files.some(loadsEditorCss) || sent.configCss.some((p) => /froala_editor(\.pkgd)?(\.min)?\.css$/.test(p));
  if (editorCss) return [];
  // Angular lists CSS in angular.json; readAngularJson covers it when that file is sent.
  if (editorFile.target === 'angular') return [];
  const contentOnly = sent.files.some(loadsContentCss) || sent.configCss.some((p) => /froala_style/.test(p));
  const sure = editorFile.target === 'nuxt' ? sent.nuxtConfig : seesFroalaLoading(sent);
  return [
    {
      check: 'css-missing',
      level: sure ? 'warning' : 'tip',
      file: editorFile.fileName,
      message: contentOnly
        ? "The files you sent load froala_style.min.css, which only styles saved content. The editor's own stylesheet is not loaded, so the toolbar is not styled."
        : `None of the files you sent load Froala's CSS. Without it the toolbar and content are not styled.${sure ? '' : IF_ELSEWHERE}`,
      fix: "Add import 'froala-editor/css/froala_editor.pkgd.min.css'; and import 'froala-editor/css/froala_style.min.css'; where you import Froala."
    }
  ];
};

/** A file's path without its extension, so ./Editor and Editor.tsx name the same module. */
export const moduleId = (path: string) =>
  path
    .replace(/^\.\//, '')
    .replace(/\.(m?[jt]sx?|vue|svelte)$/, '')
    .replace(/\/index$/, '');

/** The module a relative import points at, seen from the importing file. Aliases and packages give undefined. */
export function resolveImport(fromFile: string, source: string): string | undefined {
  if (!source.startsWith('.')) return undefined;
  const parts = fromFile.replace(/^\.\//, '').split('/').slice(0, -1);
  for (const part of source.split('/')) {
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else if (part !== '.' && part !== '') parts.push(part);
  }
  return moduleId(parts.join('/'));
}

/**
 * The modules that only run in the browser. These are the ones loaded with server rendering off, and the ones that
 * only such modules import. Imports that cannot be followed, such as aliases, never protect a module.
 */
function browserOnlyModules(sent: Sent): Set<string> {
  const safe = new Set(sent.files.flatMap((f) => f.noSsrImports.map((source) => resolveImport(f.fileName, source))).filter((id): id is string => !!id));
  const importersOf = (id: string) => sent.files.filter((f) => f.staticImports.some((source) => resolveImport(f.fileName, source) === id));
  for (let added = true; added;) {
    added = false;
    for (const ctx of sent.files) {
      const id = moduleId(ctx.fileName);
      const importers = importersOf(id);
      if (!safe.has(id) && importers.length > 0 && importers.every((f) => safe.has(moduleId(f.fileName)))) {
        safe.add(id);
        added = true;
      }
    }
  }
  // A module that something outside this set imports also runs on the server, loader or not.
  for (let removed = true; removed;) {
    removed = false;
    for (const id of safe) {
      if (importersOf(id).some((f) => !safe.has(moduleId(f.fileName)))) {
        safe.delete(id);
        removed = true;
      }
    }
  }
  return safe;
}

const clientOnlyLoading: ProjectCheck = (sent) => {
  const findings: Finding[] = [];
  const browserOnly = browserOnlyModules(sent);
  for (const ctx of sent.files) {
    const importsFroala = ctx.staticImports.some((p) => p === 'react-froala-wysiwyg' || /^froala-editor(\/js\/|$)/.test(p));
    if (ctx.target === 'nextjs' && importsFroala && !browserOnly.has(moduleId(ctx.fileName))) {
      const isClient = /^\s*['"]use client['"]/m.test(ctx.code);
      findings.push({
        check: 'client-only-loading',
        level: 'warning',
        file: ctx.fileName,
        message: isClient
          ? 'Next.js also renders client components on the server, and Froala needs the browser, so next build fails with "Element is not defined". None of the files you sent load this component with ssr: false.'
          : 'This file imports Froala without "use client", so Next.js loads it on the server and the build fails.',
        fix: isClient
          ? 'Load this component with next/dynamic and ssr: false from a "use client" file, for example dynamic(() => import(\'./FroalaEditorClient\'), { ssr: false }). If you already do, send that file too.'
          : 'Move the editor into a "use client" component and load that component with next/dynamic and ssr: false.'
      });
    }
    if (ctx.target === 'nuxt') {
      if (ctx.paths.includes('vue-froala-wysiwyg') && !/\.client\.[jt]s$/.test(ctx.fileName)) {
        findings.push({
          check: 'client-only-loading',
          level: 'warning',
          file: ctx.fileName,
          message: 'Nuxt also renders on the server, and Froala needs the browser.',
          fix: 'Register the wrapper in a client-only plugin, for example app/plugins/froala.client.ts.'
        });
      }
      if (/<froala[\s>/]/.test(ctx.code) && !/<ClientOnly/i.test(ctx.code) && !/\.client\.vue$/.test(ctx.fileName)) {
        findings.push({ check: 'client-only-loading', level: 'tip', file: ctx.fileName, message: 'The <froala> component is also rendered on the server.', fix: 'Wrap it in <ClientOnly>.' });
      }
    }
  }
  return findings;
};

/** The React and Vue wrapper import that shows a blank page with Froala 5.5.0 or older and Vite 8 (see project.ts). */
const wrapperImport: ProjectCheck = (sent) => {
  const findings: Finding[] = [];
  for (const ctx of sent.files) {
    if (ctx.target === 'nextjs' || ctx.target === 'angular') continue;
    for (const { name, source, line } of ctx.wrapperImports) {
      if (source !== 'react-froala-wysiwyg' && source !== 'vue-froala-wysiwyg') continue;
      // Code that already takes the export from the module, such as Import.default ?? Import, is fine.
      if (new RegExp(`\\b${name}\\b[^;\\n]*\\.default\\b`).test(ctx.code)) continue;
      const project = sent.project && { ...sent.project, target: sent.project.target ?? ctx.target };
      const answer = project ? wrapperImportBug(project, source) : 'unknown';
      if (answer === 'no') continue;
      const fixed = source === 'react-froala-wysiwyg' ? 'FroalaEditorComponent' : 'VueFroala';
      findings.push({
        check: 'wrapper-import',
        level: answer === 'yes' ? 'error' : project ? 'warning' : 'tip',
        file: ctx.fileName,
        line,
        message:
          answer === 'yes'
            ? `With Froala 5.5.0 or older and Vite 8, this import returns the whole module instead of the ${source === 'react-froala-wysiwyg' ? 'component' : 'plugin'}, so the editor never appears.`
            : `If this project uses Vite 8 (or Nuxt 4.5 or newer) with "type": "module" and Froala 5.5.0 or older, this import shows a blank page.${project ? ' package.json does not show the exact versions.' : ' Send package.json to check.'}`,
        fix: `Upgrade Froala and its wrapper to ${FROALA_VERSION} or newer, which fixes this. On an older version, use import ${fixed}Import from '${source}'; then const ${fixed} = ${fixed}Import.default ?? ${fixed}Import; (in TypeScript, (${fixed}Import as unknown as { default?: typeof ${fixed}Import }).default ?? ${fixed}Import).`
      });
    }
  }
  return findings;
};

/** The React wrapper types onModelChange as object, so an untyped parameter fails strict TypeScript. */
const modelChangeType: ProjectCheck = (sent) => {
  if (sent.project && froalaAtMost(sent.project, 'react-froala-wysiwyg', FROALA_VERSION) === 'no') return [];
  return sent.files
    .filter((ctx) => /\.tsx$/.test(ctx.fileName))
    .flatMap((ctx) => [...ctx.code.matchAll(/onModelChange=\{\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)].map((m) => ({ ctx, m })))
    .map(({ ctx, m }) => ({
      check: 'model-change-type',
      level: 'warning' as const,
      file: ctx.fileName,
      line: lineOfText(ctx.code, m.index ?? 0),
      message: `The ${m[1]} parameter of onModelChange has no type. The wrapper types onModelChange as object, so strict TypeScript fails with TS7006.`,
      fix: `Write onModelChange={(${m[1]}: string) => ...}.`
    }));
};

/** The React, Vue and Angular wrappers depend on one exact froala-editor version. A different one means two copies. */
const versionMismatch: ProjectCheck = (sent) => {
  const p = sent.project;
  const core = p?.range('froala-editor');
  if (!p || !core || !semver.validRange(core)) return [];
  return Object.values(WRAPPER_FOR)
    .filter((wrapper, i, all): wrapper is string => !!wrapper && all.indexOf(wrapper) === i && wrapper !== 'svelte-froala-wysiwyg' && p.has(wrapper))
    .filter((wrapper) => semver.validRange(p.range(wrapper) ?? '') && !semver.intersects(p.range(wrapper)!, core))
    .map((wrapper) => ({
      check: 'version-mismatch',
      level: 'warning' as const,
      file: 'package.json',
      message: `package.json asks for ${wrapper} ${p.range(wrapper)} and froala-editor ${core}, which cannot be the same version. The wrapper depends on one exact froala-editor version, so npm installs two copies, and plugins you import load into the copy the editor does not use.`,
      fix: `Use the same version for both, for example npm install --save-exact froala-editor@${p.version(wrapper)} ${wrapper}@${p.version(wrapper)}.`
    }));
};

/** True when the code may set a key in a way this check cannot read, such as a spread or an assignment. */
const mayHaveKey = (sent: Sent) =>
  sent.files.some((f) => /\.key\s*=(?!=)|\b(licenseKey|licenceKey)\b/.test(f.code) || f.configs.some((c) => c.node.properties.some((p: Node) => p.type === 'SpreadElement' || keyName(p) === 'key')));

/** A project with no key gets the trial key. A key the project sets is never questioned, because it can be a commercial key. */
const licenceKey: ProjectCheck = (sent) => {
  if (sent.files.every((f) => f.configs.length === 0)) return [];
  if (sent.project && froalaAtMost(sent.project, 'froala-editor', '5.5.0') === 'yes') return [];
  if (sent.files.some((f) => f.code.includes(TRIAL_KEY))) {
    return [
      {
        check: 'trial-key',
        level: 'tip',
        message: "Froala's public trial key is in this code. If the project sets no key of its own, the editor shows a trial notice. It is not for production.",
        fix: 'If your key setting already holds your licence key, change nothing. Otherwise set it before you ship. Call froala_query_docs in licensing mode for where it goes.'
      }
    ];
  }
  if (mayHaveKey(sent)) return [];
  return [
    {
      check: 'licence-key',
      level: 'tip',
      message: 'No licence key was found in the files sent. Without one, the editor shows a notice that the key is missing, and every feature still works.',
      fix: `If the project sets a key elsewhere, keep it. Otherwise add key: '${TRIAL_KEY}' to evaluate, or your licence key to ship.`
    }
  ];
};

/** Settings of the wrong wrapper, such as immediateVueModelUpdate in a React app. */
const wrapperKeys: ProjectCheck = (sent) =>
  sent.files.flatMap((ctx) => {
    const wrapper = ctx.target ? WRAPPER_FOR[ctx.target] : undefined;
    if (!wrapper) return [];
    return configsOf(ctx).flatMap((config) =>
      properties(config)
        .filter((p) => WRAPPER_KEYS[keyName(p) ?? ''] && WRAPPER_KEYS[keyName(p)!] !== wrapper)
        .map((p) => ({
          check: 'unknown-option',
          level: 'warning' as const,
          file: ctx.fileName,
          line: ctx.line(p),
          message: `${keyName(p)} is read only by ${WRAPPER_KEYS[keyName(p)!]}, and this file uses ${wrapper}.`,
          fix: 'Remove it, or use the matching setting of your wrapper.'
        }))
    );
  });

export const PROJECT_CHECKS: ProjectCheck[] = [wrapperImport, clientOnlyLoading, buttonPlugins, pluginCss, helperLibraries, cssMissing, modelChangeType, versionMismatch, wrapperKeys, licenceKey];

// ---------- Config files ----------

const NOT_ANGULAR_JSON: Omit<Finding, 'file'> = { check: 'parse-error', level: 'warning', message: 'This is not a valid angular.json, so it was not checked.', fix: 'Send the whole file.' };

/** Reads angular.json. The styles list must point at real files and include Froala's CSS. */
export function readAngularJson(code: string): { findings: Omit<Finding, 'file'>[]; styles: string[]; scripts: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(code);
  } catch {
    return { findings: [NOT_ANGULAR_JSON], styles: [], scripts: [] };
  }
  const projects = (json as { projects?: unknown } | null)?.projects;
  if (!projects || typeof projects !== 'object') return { findings: [NOT_ANGULAR_JSON], styles: [], scripts: [] };
  const findings: Omit<Finding, 'file'>[] = [];
  const allStyles: string[] = [];
  const allScripts: string[] = [];
  const paths = (list: unknown) => (Array.isArray(list) ? list.map((item) => (typeof item === 'string' ? item : String((item as { input?: unknown } | null)?.input ?? ''))) : []);
  type AngularProject = { projectType?: string; architect?: AngularTargets; targets?: AngularTargets };
  type AngularTargets = { build?: { options?: { styles?: unknown; scripts?: unknown } } };
  let applications = 0;
  for (const project of Object.values(projects) as (AngularProject | null)[]) {
    if (project?.projectType === 'library') continue;
    applications += 1;
    const options = (project?.architect ?? project?.targets)?.build?.options ?? {};
    const styles = paths(options.styles);
    allStyles.push(...styles);
    allScripts.push(...paths(options.scripts));
    if (styles.includes('styles.css')) {
      findings.push({
        check: 'angular-styles-path',
        level: 'error',
        line: lineOfText(code, code.indexOf('"styles.css"')),
        message: 'Angular looks for "styles.css" next to angular.json, but new projects keep it in src/, so the build fails.',
        fix: 'Use "src/styles.css".'
      });
    }
  }
  if (applications > 0 && !allStyles.some((p) => /froala-editor\/css\/froala_editor/.test(p))) {
    findings.push({
      check: 'css-missing',
      level: 'warning',
      message: "Froala's editor CSS is not in the styles list, so the toolbar and content are not styled.",
      fix: 'Add "node_modules/froala-editor/css/froala_editor.pkgd.min.css" and "node_modules/froala-editor/css/froala_style.min.css" to styles.'
    });
  }
  return { findings, styles: allStyles, scripts: allScripts.filter((p) => /froala/i.test(p)) };
}

/** The css list of nuxt.config. */
export function nuxtConfigCss(code: string): string[] {
  const list = code.match(/\bcss\s*:\s*\[([^\]]*)\]/)?.[1] ?? '';
  return [...list.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
}

/** Stylesheets a CSS file imports with @import. */
export function cssImportsIn(code: string): string[] {
  return [...code.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/g)].map((m) => m[1]);
}
