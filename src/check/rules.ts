// The checks run by froala_check_code. File checks look at one file at a time. Project checks look at
// everything that was sent together (plugins, CSS and libraries are often loaded in another file than
// the settings), plus package.json for version-specific problems.
// Levels: an error is a confirmed problem, a warning is a likely problem to confirm, a tip is optional.
// To add a check, write a small function below and add it to FILE_CHECKS or PROJECT_CHECKS.
import semver from 'semver';
import { metadata, EXTRA_CONFIG_KEYS, FROALA_VERSION, WRAPPER_KEYS } from '../data.js';
import { froalaAtMost, wrapperImportBug, WRAPPER_FOR, type Project } from '../project.js';
import { closest } from '../util.js';
import {
  type Context,
  type EditorConfig,
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

/** Everything froala_check_code received. */
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
const EDITOR_MEMBERS = new Set(metadata.editorMembers);

// ---------- File checks ----------

const unknownOption: FileCheck = (ctx) => {
  const names = [...Object.keys(metadata.options), ...EXTRA_CONFIG_KEYS];
  return configsOf(ctx).flatMap((config) =>
    properties(config)
      .map((prop) => ({ prop, name: keyName(prop) }))
      .filter(({ name }) => name && !metadata.options[name] && !EXTRA_CONFIG_KEYS.has(name))
      .map(({ prop, name }) => {
        const suggestion = closest(name!, names, OPTION_ALIASES);
        return {
          check: 'unknown-option',
          level: 'warning' as const,
          line: ctx.line(prop),
          message: `${name} isn't a Froala option, so the editor ignores it.`,
          fix: suggestion ? `Use ${suggestion}.` : 'Call froala_lookup with kind "option" and a query to find the right name.'
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
      return undefined; // a variable or an expression: its value isn't known here
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
              : `Call froala_lookup with kind "option" and name "${name}" to see what it accepts.`
        });
      }
    }
    const enabled = properties(config).find((p) => keyName(p) === 'pluginsEnabled');
    for (const item of enabled?.value?.type === 'ArrayExpression' ? enabled.value.elements : []) {
      const plugin = stringValue(item);
      if (!plugin || metadata.plugins[plugin]) continue;
      const suggestion = closest(plugin, Object.keys(metadata.plugins));
      findings.push({
        check: 'unknown-plugin',
        level: 'warning',
        line: ctx.line(item),
        message: `pluginsEnabled lists ${plugin}, which isn't a Froala plugin.`,
        fix: suggestion ? `Use ${suggestion}.` : 'Call froala_lookup with kind "plugin" to list the plugin names.'
      });
    }
  }
  return findings;
};

const unknownEvent: FileCheck = (ctx) =>
  ctx.configs.flatMap((config) =>
    config.events
      .filter(({ name }) => name && !EVENT_NAMES.has(name))
      .map(({ name, line }) => {
        const suggestion = closest(name, EVENT_NAMES);
        return {
          check: 'unknown-event',
          level: 'warning' as const,
          line,
          message: `${name} isn't a Froala event, so this handler never runs.`,
          fix: suggestion ? `Use ${suggestion}.` : 'Call froala_lookup with kind "event" and a query to find the right name.'
        };
      })
  );

const unknownButton: FileCheck = (ctx) =>
  ctx.configs
    .flatMap((c) => c.toolbar)
    .filter(({ name }) => name !== '|' && name !== '-' && !ctx.registeredCommands.has(name) && !metadata.buttons[name])
    .map(({ name, line }) => {
      const suggestion = closest(name, Object.keys(metadata.buttons));
      return {
        check: 'unknown-button',
        level: 'warning' as const,
        line,
        message: `${name} isn't a Froala toolbar button.`,
        fix: suggestion
          ? `Use ${suggestion}. If ${name} is your own button, register it with FroalaEditor.RegisterCommand.`
          : 'If it is your own button, register it with FroalaEditor.RegisterCommand. Otherwise call froala_lookup with kind "button".'
      };
    });

const azureAccessKey: FileCheck = (ctx) =>
  configsOf(ctx).flatMap((config) =>
    properties(config)
      .filter((prop) => /UploadToAzure$/.test(keyName(prop) ?? '') && prop.value?.type === 'ObjectExpression')
      .flatMap((prop) => properties(prop.value).filter((p) => keyName(p) === 'accessKey').map((p) => ({ prop, accessKey: p })))
      .map(({ prop, accessKey }) => ({
        check: 'azure-access-key',
        level: 'error' as const,
        line: ctx.line(accessKey),
        message: `${keyName(prop)}.accessKey puts your Azure storage account key in browser code, where anyone can read it.`,
        fix: `Create a SAS token on your server and pass it as ${keyName(prop)}.SASToken instead.`
      }))
  );

/**
 * Editor parts a function uses through a name, e.g. editor.html.get() gives ["html"]. Only parts used
 * as objects count (this.html.get(), this.el.focus()): editor parts are never called directly, so
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
 * Since Froala 3 the editor is `this` inside event handlers. Two mistakes follow from older examples:
 * a handler that expects the editor as a parameter, and an arrow function that uses `this` for the editor.
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
          fix: `Use a regular function if this.${viaThis[0]} means the editor: ${name}: function () { ... }. Keep the arrow function if this is meant to be your own class or component.`
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
      message: "Standalone components can't use forRoot(). The build fails with NG2012.",
      fix: 'List the modules directly: imports: [FroalaEditorModule, FroalaViewModule].'
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

/** Next.js 15 and newer reject next/dynamic with ssr: false in Server Components. */
const nextDynamicInServerComponent: FileCheck = (ctx) =>
  ctx.framework === 'nextjs' && ctx.noSsrImports.length > 0 && !/^\s*['"]use client['"]/m.test(ctx.code) && /(^|\/)app\//.test(ctx.fileName)
    ? [
        {
          check: 'client-only-loading',
          level: 'error',
          message: 'This file uses next/dynamic with ssr: false but has no "use client", and Next.js doesn\'t allow that in Server Components.',
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
      message: "A Froala CDN link isn't pinned to an exact version, so your editor can change without warning.",
      fix: `Use an exact version, such as froala-editor@${FROALA_VERSION}, in every Froala CDN link.`
    }));

const usesFroala = (ctx: Context) => ctx.createsEditor || ctx.configs.length > 0 || ctx.paths.some((p) => /froala/i.test(p));

const fontAwesome: FileCheck = (ctx) =>
  usesFroala(ctx) && ctx.paths.some((p) => /font-awesome|fontawesome/i.test(p)) && !/iconsTemplate\s*:\s*['"]font_awesome/.test(ctx.code)
    ? [
        {
          check: 'font-awesome',
          level: 'tip',
          message: "Froala draws its own SVG icons, so the editor doesn't need Font Awesome.",
          fix: "If nothing else in your app uses Font Awesome and you don't set iconsTemplate: 'font_awesome', you can remove it."
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
          message: "This shows saved editor HTML as it is, and this file doesn't call a sanitizer. If the HTML can come from users, clean it first.",
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

/** True when the sent files load Froala's scripts, so we can see where plugins are loaded. */
const seesFroalaLoading = (sent: Sent) => sent.files.some(loadsFroalaScripts) || sent.configScripts.length > 0;
const IF_ELSEWHERE = ' If another file loads it, send that file too.';

const allLoadedPlugins = (sent: Sent) => {
  const loaded = new Set(sent.files.flatMap((f) => [...loadedPlugins(f)]));
  for (const path of sent.configScripts) {
    const plugin = pluginOfPath(path);
    if (plugin) loaded.add(plugin);
    if (/plugins\.pkgd/.test(path)) for (const [name, info] of Object.entries(metadata.plugins)) if (info.inAllPluginsBundle) loaded.add(name);
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
        const notInBundle = bundle && !info.inAllPluginsBundle ? ` plugins.pkgd.min.js doesn't include it.` : '';
        findings.push({
          check: 'button-plugin-missing',
          level: disabled || sees ? 'warning' : 'tip',
          file: ctx.fileName,
          line,
          message: disabled
            ? `${needs}, which isn't listed in pluginsEnabled.`
            : `${needs}, and none of the files you sent load it.${notInBundle}${sees ? '' : IF_ELSEWHERE}`,
          fix: disabled ? `Add '${plugin}' to pluginsEnabled.` : `import '${info.file}';${info.css && !info.cssInEditorCss ? ` and import '${info.css}';` : ''}`
        });
      }
    }
  }
  return findings;
};

/** Third-party plugins such as imageTUI have their own stylesheet, which froala_editor.pkgd.min.css doesn't include. */
const pluginCss: ProjectCheck = (sent) => {
  const loadedCss = (file: string) => sent.files.some((f) => loadsPath(f, file)) || sent.configCss.some((p) => p.endsWith(file.replace('froala-editor/', '')));
  return [...allLoadedPlugins(sent)]
    .map((name) => ({ name, info: metadata.plugins[name] }))
    .filter(({ info }) => info.css && !info.cssInEditorCss && !loadedCss(info.css))
    .map(({ name, info }) => ({
      check: 'plugin-css-missing',
      level: 'warning' as const,
      message: `The ${name} plugin has its own stylesheet, which froala_editor.pkgd.min.css doesn't include, and none of the files you sent load it.`,
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
      const loadedByScript = scripts.some((p) => p.toLowerCase().includes(lib.package.replace(/\.js$/, '').toLowerCase()) && /^(https?:)?\/\/|\.js$/.test(p));
      const imported = sent.files.some((f) => f.paths.includes(lib.package));
      if (globals.has(lib.global) || (loadedByScript && !imported)) continue;
      const installed = sent.project?.has(lib.package);
      findings.push({
        check: 'plugin-library-missing',
        level: sent.project || seesFroalaLoading(sent) ? 'warning' : 'tip',
        message: imported
          ? `The ${plugin} plugin reads window.${lib.global}. ${lib.package} is imported, but none of the files you sent assign it to window.${lib.global}.`
          : `The ${plugin} plugin needs ${lib.package} as window.${lib.global}, and none of the files you sent load it${sent.project ? (installed ? '' : ', and package.json doesn\'t list it') : ''}.`,
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
  if (editorFile.framework === 'angular') return [];
  const contentOnly = sent.files.some(loadsContentCss) || sent.configCss.some((p) => /froala_style/.test(p));
  const sure = editorFile.framework === 'nuxt' ? sent.nuxtConfig : seesFroalaLoading(sent);
  return [
    {
      check: 'css-missing',
      level: sure ? 'warning' : 'tip',
      file: editorFile.fileName,
      message: contentOnly
        ? "The files you sent load froala_style.min.css, which only styles saved content. The editor's own stylesheet isn't loaded, so the toolbar isn't styled."
        : `None of the files you sent load Froala's CSS. Without it the toolbar and content aren't styled.${sure ? '' : IF_ELSEWHERE}`,
      fix: "Add import 'froala-editor/css/froala_editor.pkgd.min.css'; and import 'froala-editor/css/froala_style.min.css'; where you import Froala."
    }
  ];
};

const baseName = (path: string) => path.split('/').pop()!.replace(/\.[^.]+$/, '');

const clientOnlyLoading: ProjectCheck = (sent) => {
  const findings: Finding[] = [];
  const loadedWithoutSsr = new Set(sent.files.flatMap((f) => f.noSsrImports.map(baseName)));
  for (const ctx of sent.files) {
    const importsFroala = ctx.staticImports.some((p) => p === 'react-froala-wysiwyg' || /^froala-editor(\/js\/|$)/.test(p));
    if (ctx.framework === 'nextjs' && importsFroala && !loadedWithoutSsr.has(baseName(ctx.fileName))) {
      const isClient = /^\s*['"]use client['"]/m.test(ctx.code);
      findings.push({
        check: 'client-only-loading',
        level: 'warning',
        file: ctx.fileName,
        message: isClient
          ? 'Next.js also renders client components on the server, and Froala needs the browser, so next build fails with "Element is not defined". None of the files you sent load this component with ssr: false.'
          : 'This file imports Froala without "use client", so Next.js loads it on the server and the build fails.',
        fix: isClient
          ? "Load this component with next/dynamic and ssr: false from a \"use client\" file, for example dynamic(() => import('./FroalaEditorClient'), { ssr: false }). If you already do, send that file too."
          : 'Move the editor into a "use client" component and load that component with next/dynamic and ssr: false.'
      });
    }
    if (ctx.framework === 'nuxt') {
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

/** The React and Vue wrapper import that shows a blank page with Froala 5.5.0 and Vite 8 (see project.ts). */
const wrapperImport: ProjectCheck = (sent) => {
  const findings: Finding[] = [];
  for (const ctx of sent.files) {
    if (ctx.framework === 'nextjs' || ctx.framework === 'angular') continue;
    for (const { name, source, line } of ctx.wrapperImports) {
      if (source !== 'react-froala-wysiwyg' && source !== 'vue-froala-wysiwyg') continue;
      // Code that already takes the export from the module, e.g. Import.default ?? Import, is fine.
      if (new RegExp(`\\b${name}\\b[^;\\n]*\\.default\\b`).test(ctx.code)) continue;
      const project = sent.project && { ...sent.project, framework: sent.project.framework ?? ctx.framework };
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
            ? `With Froala ${FROALA_VERSION} and Vite 8, this import returns the whole module instead of the ${source === 'react-froala-wysiwyg' ? 'component' : 'plugin'}, so the editor never appears.`
            : `If this project uses Vite 8 (or Nuxt 4.5 or newer) with "type": "module" and Froala ${FROALA_VERSION} or older, this import shows a blank page.${project ? " package.json doesn't show the exact versions." : ' Send package.json to check.'}`,
        fix: `import ${fixed}Import from '${source}'; then const ${fixed} = ${fixed}Import.default ?? ${fixed}Import; (in TypeScript: (${fixed}Import as unknown as { default?: typeof ${fixed}Import }).default ?? ${fixed}Import). It works with every bundler.`
      });
    }
  }
  return findings;
};

/** The React wrapper types onModelChange as object, so an untyped parameter fails strict TypeScript. */
const modelChangeType: ProjectCheck = (sent) => {
  if (sent.project && froalaAtMost(sent.project, 'react-froala-wysiwyg', '5.5.0') === 'no') return [];
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
  if (!p || !p.has('froala-editor')) return [];
  return Object.values(WRAPPER_FOR)
    .filter((wrapper, i, all): wrapper is string => !!wrapper && all.indexOf(wrapper) === i && wrapper !== 'svelte-froala-wysiwyg' && p.has(wrapper))
    .filter((wrapper) => p.version(wrapper) && p.version('froala-editor') && p.version(wrapper) !== p.version('froala-editor'))
    .map((wrapper) => ({
      check: 'version-mismatch',
      level: 'warning' as const,
      file: 'package.json',
      message: `${wrapper} ${p.version(wrapper)} depends on exactly froala-editor ${p.version(wrapper)}, but package.json asks for froala-editor ${p.version('froala-editor')}. npm then installs two copies, and plugins you import load into the copy the editor doesn't use.`,
      fix: `Use the same version for both, for example npm install --save-exact froala-editor@${p.version(wrapper)} ${wrapper}@${p.version(wrapper)}.`
    }));
};

const licenceKey: ProjectCheck = (sent) => {
  const configs = sent.files.flatMap((f) => configsOf(f));
  if (configs.length === 0 || configs.some((c) => properties(c).some((p) => keyName(p) === 'key'))) return [];
  return [
    {
      check: 'licence-key',
      level: 'tip',
      message: "No licence key yet. That's fine on localhost. On other domains, even a preview deployment, the editor shows an unlicensed banner and blocks most toolbar buttons.",
      fix: 'Before you deploy, add key to the settings, read from an environment variable: a free trial key or your licence key. froala_licensing explains where it goes.'
    }
  ];
};

/** Wrapper settings in the wrong framework, such as immediateVueModelUpdate in a React app. */
const wrapperKeys: ProjectCheck = (sent) =>
  sent.files.flatMap((ctx) => {
    const wrapper = ctx.framework ? WRAPPER_FOR[ctx.framework] : undefined;
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

export const PROJECT_CHECKS: ProjectCheck[] = [
  wrapperImport,
  clientOnlyLoading,
  buttonPlugins,
  pluginCss,
  helperLibraries,
  cssMissing,
  modelChangeType,
  versionMismatch,
  wrapperKeys,
  licenceKey
];

// ---------- Config files ----------

/** angular.json: the styles list must point at real files and include Froala's CSS. */
export function readAngularJson(code: string): { findings: Omit<Finding, 'file'>[]; styles: string[]; scripts: string[] } {
  let json: any;
  try {
    json = JSON.parse(code);
  } catch {
    return {
      findings: [{ check: 'parse-error', level: 'warning', message: "This angular.json isn't valid JSON, so it wasn't checked.", fix: 'Send the whole file.' }],
      styles: [],
      scripts: []
    };
  }
  const findings: Omit<Finding, 'file'>[] = [];
  const allStyles: string[] = [];
  const allScripts: string[] = [];
  const path = (s: unknown) => (typeof s === 'string' ? s : ((s as { input?: string })?.input ?? ''));
  for (const project of Object.values<any>(json.projects ?? {})) {
    const options = project?.architect?.build?.options ?? {};
    const styles: string[] = (options.styles ?? []).map(path);
    allStyles.push(...styles);
    allScripts.push(...(options.scripts ?? []).map(path));
    if (styles.includes('styles.css')) {
      findings.push({
        check: 'angular-styles-path',
        level: 'error',
        line: lineOfText(code, code.indexOf('"styles.css"')),
        message: 'Angular looks for "styles.css" next to angular.json, but new projects keep it in src/, so the build fails.',
        fix: 'Use "src/styles.css".'
      });
    }
    if (!styles.some((p) => /froala-editor\/css\/froala_editor/.test(p))) {
      findings.push({
        check: 'css-missing',
        level: 'warning',
        message: "Froala's editor CSS isn't in the styles list, so the toolbar and content aren't styled.",
        fix: 'Add "node_modules/froala-editor/css/froala_editor.pkgd.min.css" and "node_modules/froala-editor/css/froala_style.min.css" to styles.'
      });
    }
  }
  return { findings, styles: allStyles, scripts: allScripts.filter((p) => /froala/i.test(p)) };
}

/** The css list of nuxt.config, e.g. css: ['froala-editor/css/froala_editor.pkgd.min.css']. */
export function nuxtConfigCss(code: string): string[] {
  const list = code.match(/\bcss\s*:\s*\[([^\]]*)\]/)?.[1] ?? '';
  return [...list.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
}

/** Stylesheets a CSS file imports, e.g. @import 'froala-editor/css/froala_editor.pkgd.min.css'. */
export function cssImportsIn(code: string): string[] {
  return [...code.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/g)].map((m) => m[1]);
}
