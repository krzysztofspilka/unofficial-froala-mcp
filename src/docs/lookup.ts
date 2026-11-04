// Looks up Froala options, plugins, toolbar buttons, events and methods by name.
import { metadata, EVENTS_PAGE, EXTRA_CONFIG_KEYS, METHODS_PAGE, OPTIONS_PAGE, SOURCE, TRIAL_KEY, WRAPPER_KEYS, pluginDocsUrl, type CallableInfo } from '../data.js';
import { closestMany, moreLine, pageFacts, paginate, toolResult, type ResponseFormat } from '../util.js';

export const KINDS = ['option', 'plugin', 'button', 'event', 'method'] as const;
export type Kind = (typeof KINDS)[number];

/** Defaults longer than this are shortened in the answer. */
const MAX_DEFAULT_CHARS = 1_500;
const events = new Map(metadata.events.map((e) => [e.name, e]));
const methods = new Map(metadata.methods.map((m) => [m.name, m]));

function namesOf(kind: Kind): string[] {
  if (kind === 'option') return [...Object.keys(metadata.options), ...EXTRA_CONFIG_KEYS];
  if (kind === 'plugin') return Object.keys(metadata.plugins);
  if (kind === 'button') return Object.keys(metadata.buttons);
  return [...(kind === 'event' ? events : methods).keys()];
}

function findName(kind: Kind, name: string): string | undefined {
  const names = namesOf(kind);
  return names.find((n) => n === name) ?? names.find((n) => n.toLowerCase() === name.toLowerCase());
}

function describeOption(name: string) {
  if (name === 'key') {
    return {
      text: `Option key\nYour Froala licence key. Every feature works with any key. Without a commercial key the editor shows a notice, and the public trial key is ${TRIAL_KEY}. Call froala_query_docs in licensing mode for details.`,
      data: { kind: 'option', name, type: 'String', docs_url: 'https://froala.com/wysiwyg-editor/docs/activation/' }
    };
  }
  if (name === 'events') {
    return {
      text: 'Option events\nAn object of event handlers, such as { contentChanged: function () { ... } }. Inside a handler, this is the editor. Use lookup mode with kind "event" for the event names.',
      data: { kind: 'option', name, type: 'Object', docs_url: EVENTS_PAGE }
    };
  }
  if (WRAPPER_KEYS[name]) {
    return {
      text: `Option ${name}\nRead by ${WRAPPER_KEYS[name]} from the same settings object. It is not part of the editor core.`,
      data: { kind: 'option', name, wrapper: WRAPPER_KEYS[name], docs_url: null }
    };
  }
  const info = metadata.options[name];
  if (!info) {
    return {
      text: `Option ${name}\nThe editor reads this option, and it has no default value. Use search mode to read about it.`,
      data: { kind: 'option', name, docs_url: OPTIONS_PAGE }
    };
  }
  const plugin = info.plugin ? metadata.plugins[info.plugin] : undefined;
  const fullDefault = JSON.stringify(info.default);
  const shortened = fullDefault.length > MAX_DEFAULT_CHARS;
  const type = info.docsType ?? info.declaredType ?? null;
  const docsUrl = info.documented ? `${OPTIONS_PAGE}#${name}` : null;
  const data = {
    kind: 'option',
    name,
    type,
    description: info.description ?? null,
    default: shortened ? null : info.default,
    default_shortened: shortened,
    plugin: info.plugin,
    import: plugin ? plugin.file : null,
    documented: !!info.documented,
    docs_url: docsUrl
  };
  const lines = [
    `Option ${name}`,
    info.description ?? '',
    `Type: ${type ?? 'not documented'}`,
    `Default: ${shortened ? `${fullDefault.slice(0, MAX_DEFAULT_CHARS)}... (shortened; the full default is ${fullDefault.length} characters${docsUrl ? ', see the docs' : ''})` : fullDefault}`,
    info.plugin ? `Plugin: ${info.plugin} (import '${plugin?.file}')` : 'Plugin: none, part of the editor core',
    docsUrl ? `Docs: ${docsUrl}` : 'Docs: this option is not on the options page, so check how it behaves before relying on it.'
  ].filter(Boolean);
  return { text: lines.join('\n'), data };
}

function describePlugin(name: string) {
  const info = metadata.plugins[name];
  const docsUrl = pluginDocsUrl(name) ?? null;
  const data = { kind: 'plugin', name, ...info, docs_url: docsUrl };
  const css = !info.css
    ? 'CSS: none'
    : info.cssInEditorCss
      ? `CSS: included in froala_editor.pkgd.min.css, or import '${info.css}' on its own`
      : `CSS: import '${info.css}'. froala_editor.pkgd.min.css does not include it.`;
  const lines = [
    `Plugin ${name}${info.thirdParty ? ' (third-party integration)' : ''}`,
    `Import: import '${info.file}';`,
    info.inAllPluginsBundle ? 'Also included in plugins.pkgd.min.js, which loads every bundled plugin.' : 'Not included in plugins.pkgd.min.js, so import it on its own.',
    css,
    `Toolbar buttons: ${info.buttons.length ? info.buttons.join(', ') : 'none'}`,
    `Options: ${info.options.length ? info.options.join(', ') : 'none'}`
  ];
  for (const lib of info.helperLibraries) lines.push(`Needs: ${lib.package}${lib.optional ? ' (optional)' : ''}. ${lib.note}`);
  if (docsUrl) lines.push(`Docs: ${docsUrl}`);
  return { text: lines.join('\n'), data };
}

function describeButton(name: string) {
  const plugin = metadata.buttons[name].plugin;
  const info = plugin ? metadata.plugins[plugin] : undefined;
  const data = { kind: 'button', name, plugin, import: info?.file ?? null, in_all_plugins_bundle: info?.inAllPluginsBundle ?? null };
  const text = !plugin
    ? `Button ${name}: part of the editor core, so no plugin import is needed.`
    : `Button ${name}: needs the ${plugin} plugin. import '${info?.file}';${info?.inAllPluginsBundle ? ' (plugins.pkgd.min.js includes it too.)' : ''}`;
  return { text, data };
}

function describeCallable(kind: 'event' | 'method', item: CallableInfo) {
  const docsUrl = `${kind === 'event' ? EVENTS_PAGE : METHODS_PAGE}#${item.name}`;
  const usage = kind === 'event' ? `events: { '${item.name}': function (${item.args}) { /* this is the editor */ } }` : `editor.${item.name}(${item.args.replace(/[[\]]/g, '')})`;
  const lines = [`${kind === 'event' ? 'Event' : 'Method'} ${item.name} (${item.args})`, item.description, item.returns ? `Returns: ${item.returns}` : '', `Use: ${usage}`, `Docs: ${docsUrl}`].filter(
    Boolean
  );
  return { text: lines.join('\n'), data: { kind, ...item, docs_url: docsUrl } };
}

function describe(kind: Kind, name: string) {
  if (kind === 'option') return describeOption(name);
  if (kind === 'plugin') return describePlugin(name);
  if (kind === 'button') return describeButton(name);
  return describeCallable(kind, (kind === 'event' ? events : methods).get(name)!);
}

function one(kind: Kind, name: string) {
  const found = findName(kind, name);
  if (found) return { found: true as const, ...describe(kind, found) };
  const suggestions = closestMany(name, namesOf(kind));
  const text = `No Froala ${kind} is called "${name}".` + (suggestions.length ? ` Did you mean ${suggestions.join(', ')}?` : '');
  return { found: false as const, text, data: { kind, name, suggestions } };
}

export interface LookupArgs {
  kind: Kind;
  names?: string[];
  query?: string;
  limit: number;
  offset: number;
  format: ResponseFormat;
}

export function lookup({ kind, names, query, limit, offset, format }: LookupArgs) {
  if (names) {
    const results = names.map((n) => one(kind, n));
    const answer = toolResult(results.map((r) => r.text).join('\n\n'), { ...SOURCE, found: results.every((r) => r.found), results: results.map((r) => ({ found: r.found, ...r.data })) }, format);
    return results.some((r) => r.found) ? answer : { ...answer, isError: true };
  }
  const all = namesOf(kind);
  const matches = query ? all.filter((n) => n.toLowerCase().includes(query.toLowerCase())) : all;
  const page = paginate(matches, limit, offset);
  const label = `${matches.length} ${kind}${matches.length === 1 ? '' : 's'}` + (query ? ` matching "${query}"` : '');
  const text = matches.length ? [`${label}:`, page.items.join(', '), moreLine(page)].filter(Boolean).join('\n') : `No ${kind}s match "${query}".`;
  return toolResult(text, { ...SOURCE, kind, query: query ?? null, ...pageFacts(page), names: page.items }, format);
}
