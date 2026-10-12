// Reads one file of code and collects the facts that the checks in rules.ts look at.
// An object counts as Froala settings only when the code hands it to Froala: new FroalaEditor(selector, settings),
// the config of a wrapper component, [froalaEditor]="settings" in Angular, or a file that is only a settings object.
// Settings that come from somewhere this file can't see are listed in notChecked instead of being guessed.
import { parse, parseExpression, type ParserPlugin } from '@babel/parser';
import { metadata } from '../data.js';
import type { Framework } from '../project.js';

// Babel syntax tree nodes. They are walked generically, so they are typed loosely.
export type Node = { type: string; loc?: { start: { line: number } }; start?: number | null; end?: number | null; [key: string]: any };

/** One set of Froala settings and how it reaches the editor. */
export interface EditorConfig {
  node: Node;
  /** For example "new FroalaEditor()" or "<FroalaEditorComponent config>". */
  usedBy: string;
  toolbar: { name: string; line?: number }[];
  events: { name: string; line?: number; node: Node }[];
  pluginsEnabled?: string[];
}

export interface Context {
  code: string;
  fileName: string;
  framework?: Framework;
  /** False when no part of the code could be read as JavaScript or TypeScript. */
  parsed: boolean;
  /** Every module path the file loads: imports, require(), dynamic import(), <script src> and <link href>. */
  paths: string[];
  /** Paths imported at the top of the file with `import ... from` (not type-only). */
  staticImports: string[];
  configs: EditorConfig[];
  /** Parts that couldn't be checked, such as settings defined in another file. */
  notChecked: string[];
  registeredCommands: Set<string>;
  /** Files this file loads with next/dynamic and ssr: false, e.g. "./FroalaEditorClient". */
  noSsrImports: string[];
  /** Default imports of a framework wrapper, e.g. import FroalaEditorComponent from 'react-froala-wysiwyg'. */
  wrapperImports: { name: string; source: string; line?: number }[];
  /** Names assigned on window, e.g. window.mammoth = mammoth gives "mammoth". */
  windowGlobals: Set<string>;
  /** Functions the code calls, e.g. "DOMPurify.sanitize". */
  calls: Set<string>;
  /** True when the file creates or renders a Froala editor. */
  createsEditor: boolean;
  line: (node: Node) => number | undefined;
}

const TOOLBAR_KEY = /^toolbarButtons(XS|SM|MD)?$/;
export const WRAPPERS = ['react-froala-wysiwyg', 'vue-froala-wysiwyg', 'angular-froala-wysiwyg', 'svelte-froala-wysiwyg'];
const JS_SCRIPT_TYPES = /^(module|text\/javascript|application\/javascript|text\/babel|text\/typescript)$/i;

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string';

/** Calls visit() for every node, with its parent. */
export function walk(node: Node, visit: (node: Node, parent?: Node) => void, parent?: Node) {
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
    if (Array.isArray(value)) value.filter(isNode).forEach((child) => walk(child, visit, node));
    else if (isNode(value)) walk(value, visit, node);
  }
}

/** The name of an object property, e.g. "toolbarButtons", or undefined for computed keys. */
export function keyName(prop: Node): string | undefined {
  if ((prop.type !== 'ObjectProperty' && prop.type !== 'ObjectMethod') || prop.computed) return undefined;
  return prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : undefined;
}

export const properties = (obj: Node): Node[] => obj.properties.filter((p: Node) => p.type === 'ObjectProperty' || p.type === 'ObjectMethod');

export function stringValue(node?: Node): string | undefined {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

/** "a.b" for a.b, "x" for x. */
function nameOf(node?: Node): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'MemberExpression' || node.type === 'JSXMemberExpression') {
    const object = node.object.type === 'ThisExpression' ? 'this' : nameOf(node.object);
    const property = node.computed ? undefined : nameOf(node.property);
    return object && property ? `${object}.${property}` : undefined;
  }
  return undefined;
}

/** Toolbar buttons from a list, nested lists, or groups like { moreText: { buttons: [...] } }. */
function toolbarButtons(value: Node, line: Context['line']) {
  const out: EditorConfig['toolbar'] = [];
  const fromList = (list: Node) => {
    for (const item of list.elements) {
      if (item?.type === 'StringLiteral') out.push({ name: item.value, line: line(item) });
      else if (item?.type === 'ArrayExpression') fromList(item);
    }
  };
  if (value.type === 'ArrayExpression') fromList(value);
  if (value.type === 'ObjectExpression') {
    for (const group of properties(value)) {
      const buttons = group.value?.type === 'ObjectExpression' ? properties(group.value).find((p) => keyName(p) === 'buttons') : undefined;
      if (buttons?.value.type === 'ArrayExpression') fromList(buttons.value);
    }
  }
  return out;
}

const PARSER_PLUGINS: ParserPlugin[][] = [['jsx', 'typescript', 'decorators'], ['typescript', 'decorators'], ['jsx', 'typescript', 'decorators-legacy'], ['jsx']];

function parseProgram(code: string): Node | undefined {
  for (const plugins of PARSER_PLUGINS) {
    try {
      return parse(code, { sourceType: 'unambiguous', plugins }) as unknown as Node;
    } catch {
      // Try the next set of syntax plugins.
    }
  }
  return undefined;
}

interface Block {
  code: string;
  /** Lines before the block in the file. */
  offset: number;
}

/** Splits Vue, Svelte and HTML files into their JavaScript blocks and the markup around them. */
function splitFile(code: string, fileName: string) {
  const isMarkup = /\.(vue|svelte|html?)$/i.test(fileName) || /^\s*</.test(code);
  if (!isMarkup) return { blocks: [{ code, offset: 0 }] as Block[], markup: '', tagPaths: [] as string[], skipped: [] as string[] };
  const blocks: Block[] = [];
  const tagPaths: string[] = [];
  const skipped: string[] = [];
  const lineAt = (index: number) => code.slice(0, index).split('\n').length;
  for (const m of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/);
    if (src) tagPaths.push(src[1]);
    const type = m[1].match(/\btype\s*=\s*["']([^"']+)["']/)?.[1];
    if (!m[2].trim()) continue;
    // JSON-LD, templates and import maps aren't code.
    if (type && !JS_SCRIPT_TYPES.test(type)) continue;
    const start = (m.index ?? 0) + m[0].indexOf(m[2]);
    blocks.push({ code: m[2], offset: lineAt(start) - 1 });
  }
  for (const m of code.matchAll(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) tagPaths.push(m[1]);
  const markup = code.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (s) => s.replace(/[^\n]/g, ' '));
  return { blocks, markup, tagPaths, skipped };
}

/** Unwraps `x as T`, `x satisfies T`, `x!`, `(x)` and calls such as ref(x), reactive(x) and $state(x). */
function unwrap(node: Node | undefined): Node | undefined {
  let n = node;
  while (n) {
    if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'TypeCastExpression'].includes(n.type)) n = n.expression;
    else if (n.type === 'CallExpression' && /^(ref|reactive|shallowRef|shallowReactive|\$state|structuredClone|markRaw)$/.test(nameOf(n.callee) ?? '')) n = n.arguments[0];
    else return n;
  }
  return n;
}

export function readCode(code: string, fileName = '', framework?: Framework, hints: { angularBindings?: string[] } = {}): Context {
  const offsets = new WeakMap<Node, number>();
  const line = (node: Node) => (node.loc ? node.loc.start.line + (offsets.get(node) ?? 0) : undefined);
  const ctx: Context = {
    code,
    fileName,
    framework,
    parsed: false,
    paths: [],
    staticImports: [],
    configs: [],
    notChecked: [],
    registeredCommands: new Set(),
    noSsrImports: [],
    wrapperImports: [],
    windowGlobals: new Set(),
    calls: new Set(),
    createsEditor: false,
    line
  };
  const { blocks, markup, tagPaths } = splitFile(code, fileName);
  ctx.paths.push(...tagPaths);
  if (blocks.length === 0) ctx.parsed = true;

  // Names this file binds: Froala itself, the wrappers, variables and class properties.
  const editorNames = new Set<string>();
  const wrapperNames = new Set<string>();
  const variables = new Map<string, Node>();
  const classProperties = new Map<string, Node>();
  const candidates: { expr: Node | undefined; usedBy: string; at?: number }[] = [];
  const programs: Node[] = [];

  for (const block of blocks) {
    const trimmed = block.code.trim();
    // A file that is only a settings object, such as { "toolbarButtons": [...] }.
    if (trimmed.startsWith('{') && blocks.length === 1 && !/\.(vue|svelte|html?)$/i.test(fileName)) {
      try {
        const obj = parseExpression(trimmed, { plugins: ['typescript'] }) as unknown as Node;
        if (obj.type === 'ObjectExpression') {
          const offset = block.offset + block.code.slice(0, block.code.indexOf('{')).split('\n').length - 1;
          walk(obj, (node) => offsets.set(node, offset));
          candidates.push({ expr: obj, usedBy: 'settings object' });
          ctx.parsed = true;
          continue;
        }
      } catch {
        // Not a bare object; read it as a normal file below.
      }
    }
    const program = parseProgram(block.code);
    if (!program) {
      ctx.notChecked.push(`The code starting at line ${block.offset + 1} couldn't be read as JavaScript or TypeScript.`);
      continue;
    }
    ctx.parsed = true;
    walk(program, (node) => offsets.set(node, block.offset));
    programs.push(program);
    walk(program, (node) => {
      if (node.type === 'ImportDeclaration' && node.importKind !== 'type') {
        const source: string = node.source.value;
        ctx.paths.push(source);
        ctx.staticImports.push(source);
        for (const spec of node.specifiers) {
          if (source === 'froala-editor' && spec.type !== 'ImportSpecifier') editorNames.add(spec.local.name);
          if (WRAPPERS.includes(source)) {
            wrapperNames.add(spec.local.name);
            if (spec.type === 'ImportDefaultSpecifier') ctx.wrapperImports.push({ name: spec.local.name, source, line: line(node) });
          }
        }
      }
      if (node.type === 'ImportExpression' && stringValue(node.source)) ctx.paths.push(stringValue(node.source)!);
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) variables.set(node.id.name, node.init);
      if ((node.type === 'ClassProperty' || node.type === 'PropertyDefinition') && node.key?.type === 'Identifier' && node.value) {
        classProperties.set(node.key.name, node.value);
      }
    });
  }

  // Variables made from a wrapper import, such as const FroalaEditorComponent = FroalaImport.default ?? FroalaImport.
  for (let round = 0; round < 3; round++) {
    for (const [name, init] of variables) {
      if (wrapperNames.has(name)) continue;
      let mentions = false;
      walk(init, (n) => {
        if (n.type === 'Identifier' && wrapperNames.has(n.name)) mentions = true;
      });
      if (mentions) wrapperNames.add(name);
    }
  }
  // Pages that load Froala from a CDN use the global FroalaEditor.
  if (editorNames.size === 0) editorNames.add('FroalaEditor');

  for (const program of programs) {
    walk(program, (node) => {
      if (node.type === 'CallExpression') {
        const { callee, arguments: args } = node;
        const called = nameOf(callee);
        if (called) ctx.calls.add(called);
        if ((callee.type === 'Identifier' && callee.name === 'require') || callee.type === 'Import') {
          const path = stringValue(args[0]);
          if (path) ctx.paths.push(path);
        }
        // FroalaEditor.RegisterCommand('myButton', ...) makes 'myButton' a valid toolbar button.
        if (callee.type === 'MemberExpression' && editorNames.has(nameOf(callee.object) ?? '') && /^Register(Command|QuickInsertButton)$/.test(nameOf(callee.property) ?? '')) {
          const name = stringValue(args[0]);
          if (name) ctx.registeredCommands.add(name);
        }
        // Next.js: dynamic(() => import('./Editor'), { ssr: false })
        if (called === 'dynamic' && args[1]?.type === 'ObjectExpression') {
          if (properties(args[1]).some((p) => keyName(p) === 'ssr' && p.value.type === 'BooleanLiteral' && p.value.value === false)) {
            walk(args[0], (n) => {
              if (n.type === 'ImportExpression' && stringValue(n.source)) ctx.noSsrImports.push(stringValue(n.source)!);
              if (n.type === 'CallExpression' && n.callee.type === 'Import' && stringValue(n.arguments[0])) ctx.noSsrImports.push(stringValue(n.arguments[0])!);
            });
          }
        }
      }
      if (node.type === 'NewExpression' && editorNames.has(nameOf(node.callee) ?? '')) {
        ctx.createsEditor = true;
        if (node.arguments[1]) candidates.push({ expr: node.arguments[1], usedBy: `new ${nameOf(node.callee)}()` });
      }
      if (node.type === 'JSXOpeningElement' && wrapperNames.has(nameOf(node.name) ?? '')) {
        ctx.createsEditor = true;
        const config = node.attributes.find((a: Node) => a.type === 'JSXAttribute' && a.name?.name === 'config');
        if (config?.value?.type === 'JSXExpressionContainer') candidates.push({ expr: config.value.expression, usedBy: `<${nameOf(node.name)} config>` });
      }
      if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && /^(window|globalThis|self)$/.test(nameOf(node.left.object) ?? '')) {
        const name = nameOf(node.left.property);
        if (name) ctx.windowGlobals.add(name);
      }
    });
  }

  // Settings bound in markup: Vue <froala :config>, Svelte <FroalaEditor {config}>, Angular [froalaEditor].
  const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;
  for (const m of markup.matchAll(/<froala\b[^>]*?\s(?::|v-bind:)config\s*=\s*"([^"]*)"/g)) {
    candidates.push({ expr: expression(m[1]), usedBy: '<froala :config>', at: lineAt(markup, m.index ?? 0) });
  }
  if (/<froala[\s>/]/.test(markup)) ctx.createsEditor = true;
  for (const m of markup.matchAll(/<([A-Z]\w*)\b([^>]*)>/g)) {
    if (!wrapperNames.has(m[1])) continue;
    ctx.createsEditor = true;
    const config = m[2].match(/\{config\}|\bconfig\s*=\s*\{([^}]*)\}/);
    if (config) candidates.push({ expr: expression(config[1] ?? 'config'), usedBy: `<${m[1]} config>`, at: lineAt(markup, m.index ?? 0) });
  }
  const angularTemplates = [...code.matchAll(/\btemplate\s*:\s*`([\s\S]*?)`/g)].map((m) => m[1]);
  const angularBindings = [...(hints.angularBindings ?? [])];
  for (const template of angularTemplates) {
    for (const m of template.matchAll(/\[froalaEditor\]\s*=\s*"([^"]*)"/g)) angularBindings.push(m[1]);
    if (/\[froalaEditor\]|froalaEditor\b/.test(template)) ctx.createsEditor = true;
  }
  if (/\.ts$/.test(fileName) && /@Component\s*\(/.test(code)) {
    for (const binding of new Set(angularBindings)) candidates.push({ expr: expression(binding), usedBy: '[froalaEditor]' });
  }

  // Follow each candidate to the object literal it names.
  const resolve = (expr: Node | undefined, depth = 0): Node | string | undefined => {
    const n = unwrap(expr);
    if (!n || depth > 4) return undefined;
    if (n.type === 'ObjectExpression') return n;
    const name = nameOf(n);
    if (n.type === 'Identifier') return variables.has(n.name) ? resolve(variables.get(n.name), depth + 1) : classProperties.has(n.name) ? resolve(classProperties.get(n.name), depth + 1) : name;
    if (n.type === 'MemberExpression' && name?.startsWith('this.') && classProperties.has(name.slice(5))) return resolve(classProperties.get(name.slice(5)), depth + 1);
    return name ?? 'an expression';
  };
  const seen = new Set<Node>();
  for (const { expr, usedBy, at } of candidates) {
    const found = resolve(expr);
    if (found && typeof found === 'object') {
      if (!seen.has(found)) {
        seen.add(found);
        ctx.configs.push(readConfig(found, usedBy, line));
      }
    } else if (expr) {
      const where = at ?? (expr.loc ? line(expr) : undefined);
      ctx.notChecked.push(
        `The settings for ${usedBy}${where ? ` (line ${where})` : ''} come from ${found ?? 'somewhere else'}, which this file doesn't define. Send the file that does.`
      );
    }
  }
  // A separate settings file, such as export const froalaConfig = { ... }.
  for (const [name, init] of variables) {
    const obj = unwrap(init);
    if (/froala/i.test(name) && obj?.type === 'ObjectExpression' && !seen.has(obj) && properties(obj).some((p) => metadata.options[keyName(p) ?? ''])) {
      seen.add(obj);
      ctx.configs.push(readConfig(obj, `the ${name} variable`, line));
    }
  }
  for (const config of ctx.configs) {
    for (const spread of config.node.properties.filter((p: Node) => p.type === 'SpreadElement')) {
      ctx.notChecked.push(`The settings spread in with ...${nameOf(spread.argument) ?? 'an expression'} (line ${line(spread)}) weren't checked.`);
    }
  }

  ctx.createsEditor ||= ctx.paths.some((p) => WRAPPERS.includes(p)) && ctx.configs.length > 0;
  ctx.framework ??= detectFramework(ctx);
  return ctx;
}

/** Parses an expression from markup, such as "config" or "{ placeholderText: 'Hi' }". */
function expression(source: string): Node | undefined {
  try {
    return parseExpression(source, { plugins: ['typescript'] }) as unknown as Node;
  } catch {
    return undefined;
  }
}

function readConfig(node: Node, usedBy: string, line: Context['line']): EditorConfig {
  const config: EditorConfig = { node, usedBy, toolbar: [], events: [] };
  for (const prop of properties(node)) {
    const name = keyName(prop);
    if (name && TOOLBAR_KEY.test(name)) config.toolbar.push(...toolbarButtons(prop.value, line));
    if (name === 'pluginsEnabled' && prop.value?.type === 'ArrayExpression') {
      config.pluginsEnabled = prop.value.elements.map((e: Node) => stringValue(e)).filter((v: string | undefined): v is string => !!v);
    }
    if (name === 'events' && prop.value?.type === 'ObjectExpression') {
      for (const handler of properties(prop.value)) config.events.push({ name: keyName(handler) ?? '', line: line(handler), node: handler });
    }
  }
  return config;
}

function detectFramework({ code, fileName, paths }: Context): Framework | undefined {
  if (/^\s*['"]use client['"]/m.test(code) || paths.some((p) => p === 'next' || p.startsWith('next/'))) return 'nextjs';
  if (paths.some((p) => p === '#app' || p === '#imports') || /defineNuxtPlugin\s*\(/.test(code)) return 'nuxt';
  if (paths.some((p) => p.startsWith('@angular/'))) return 'angular';
  if (/\.svelte$/i.test(fileName) || paths.includes('svelte-froala-wysiwyg')) return 'svelte';
  if (/\.vue$/i.test(fileName) || paths.includes('vue-froala-wysiwyg')) return 'vue';
  if (/\.[jt]sx$/i.test(fileName) || paths.includes('react-froala-wysiwyg')) return 'react';
  return undefined;
}

/** A path without its query string or hash, so CDN links with ?v=1 are still recognised. */
const clean = (path: string) => path.replace(/[?#].*$/, '');

// Facts about which Froala files are loaded.
export const loadsAllPlugins = (ctx: Context) => ctx.paths.some((p) => /(plugins|froala_editor)\.pkgd(\.min)?\.js$/.test(clean(p)));
export const loadsFroalaScripts = (ctx: Context) => ctx.paths.some((p) => /(^|\/)froala-editor(@[^/]*)?(\/js\/.*)?$|froala_editor(\.pkgd)?(\.min)?\.js$/.test(clean(p)));
/** The editor stylesheet. froala_style.min.css alone only styles content shown outside the editor. */
export const loadsEditorCss = (ctx: Context) => ctx.paths.some((p) => /froala_editor(\.pkgd)?(\.min)?\.css$/.test(clean(p)));
export const loadsContentCss = (ctx: Context) => ctx.paths.some((p) => /froala_style(\.min)?\.css$/.test(clean(p)));

/** The plugin a file like "froala-editor/js/plugins/table.min.js" (or a CDN URL of it) belongs to. */
export function pluginOfPath(path: string): string | undefined {
  const m = clean(path).match(/js\/(plugins|third_party)\/([A-Za-z_]+?)(\.min)?\.js$/);
  if (!m) return undefined;
  return Object.keys(metadata.plugins).find((name) => metadata.plugins[name].file.endsWith(`/${m[1]}/${m[2]}.min.js`));
}

/** Plugins the file loads, counting plugins.pkgd.min.js as every plugin it really contains. */
export function loadedPlugins(ctx: Context): Set<string> {
  const loaded = new Set(ctx.paths.map(pluginOfPath).filter((p): p is string => !!p));
  if (loadsAllPlugins(ctx)) for (const [name, info] of Object.entries(metadata.plugins)) if (info.inAllPluginsBundle) loaded.add(name);
  return loaded;
}

/** A third-party plugin's own stylesheet, which froala_editor.pkgd.min.css doesn't include. */
export const loadsPath = (ctx: Context, file: string) => ctx.paths.some((p) => clean(p).endsWith(file.replace('froala-editor/', '')));
