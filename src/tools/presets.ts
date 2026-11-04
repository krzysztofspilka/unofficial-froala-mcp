// One search over the presets, samples, whitepapers and extensions.
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import MiniSearch from 'minisearch';
import { knowledge, SOURCE, TRIAL_KEY, type ExampleInfo, type ExtensionInfo, type WhitepaperInfo } from '../data.js';
import { PRESETS, presetRequirements, presetSettings, type Preset } from '../presets.js';
import { EDITOR_CSS, editorConfig, pluginFiles } from '../setup/shared.js';
import { TARGETS, type Target } from '../project.js';
import { MAX_RESPONSE_CHARS, READ_ONLY, closestMany, moreLine, pageFacts, pageInputs, paginate, responseFormat, toolError, toolResult, type ResponseFormat } from '../util.js';
import { PART_SIZE, splitParts } from '../docs/search.js';

const KINDS = ['preset', 'example', 'whitepaper', 'extension'] as const;
type Kind = (typeof KINDS)[number];

export const presetsInput = z.strictObject({
  query: z.string().min(2).max(200).optional().describe('What the editor is for, in plain words. Example: "comments with mentions", "email", "LMS lesson"'),
  id: z.string().min(1).max(120).optional().describe('An id from a result, to read it in full. Example: "simple", "example:markdown-export", "whitepaper:images", "extension:checklists"'),
  kind: z.enum(KINDS).optional().describe('Only return this kind of result.'),
  target: z.enum(TARGETS).optional().describe('For a sample, the code to return. Default "javascript".'),
  part: z.number().int().min(1).optional().describe('For a long whitepaper or extension, which part to return (default 1).'),
  ...pageInputs(50, 10),
  response_format: responseFormat
});

interface Entry {
  id: string;
  kind: Kind;
  title: string;
  group: string;
  summary: string;
  text: string;
}

const presetEntry = (p: Preset): Entry => ({ id: p.id, kind: 'preset', title: p.title, group: p.group, summary: p.useWhen, text: `${p.buttons.join(' ')} ${p.notes.join(' ')}` });
const exampleEntry = (e: ExampleInfo): Entry => ({ id: `example:${e.id}`, kind: 'example', title: e.title, group: e.group, summary: e.summary, text: e.text });
const whitepaperEntry = (w: WhitepaperInfo): Entry => ({ id: `whitepaper:${w.id}`, kind: 'whitepaper', title: w.title, group: 'Whitepapers', summary: w.summary, text: w.markdown });
const extensionEntry = (e: ExtensionInfo): Entry => ({
  id: `extension:${e.id}`,
  kind: 'extension',
  title: e.title,
  group: 'Extensions',
  summary: e.summary,
  text: [...(e.buttons ?? []), ...(e.options ?? [])].join(' ')
});

const entries: Entry[] = [...PRESETS.map(presetEntry), ...knowledge.extensions.map(extensionEntry), ...knowledge.examples.map(exampleEntry), ...knowledge.whitepapers.map(whitepaperEntry)];
const byId = new Map(entries.map((e) => [e.id, e]));

let index: MiniSearch<Entry> | undefined;

/** Built on first use, then kept for the life of the process. */
function getIndex(): MiniSearch<Entry> {
  if (!index) {
    index = new MiniSearch<Entry>({
      fields: ['title', 'summary', 'group', 'text'],
      storeFields: ['id'],
      searchOptions: {
        boost: { title: 4, summary: 3, group: 2 },
        // Presets are what people usually want, so they come first when the match is close.
        boostDocument: (id) => (byId.get(id as string)?.kind === 'preset' ? 1.5 : 1),
        prefix: true,
        fuzzy: 0.15,
        combineWith: 'OR'
      }
    });
    index.addAll(entries);
  }
  return index;
}

const listLine = (e: Entry) => `- ${e.id}: ${e.title}. ${e.summary}`;
const listData = ({ id, kind, title, group, summary }: Entry) => ({ id, kind, title, group, summary });

function list({ query, kind, limit, offset, format }: { query?: string; kind?: Kind; limit: number; offset: number; format: ResponseFormat }) {
  const matches = query
    ? getIndex()
        .search(query)
        .map((hit) => byId.get(hit.id as string)!)
    : entries.filter((e) => e.kind === 'preset');
  const filtered = kind && (query || kind !== 'preset') ? (query ? matches : entries).filter((e) => e.kind === kind) : matches;
  const page = paginate(filtered, limit, offset);
  const heading = query ? `Results for "${query}".` : `Froala ${kind ?? 'preset'}s.`;
  const text = filtered.length
    ? [heading, '', ...page.items.map(listLine), '', moreLine(page), 'Call froala_find_presets with id to read one. Pass a preset id to froala_get_setup to build it.'].filter(Boolean).join('\n')
    : `Nothing matches "${query}". Try other words, or call froala_find_presets with no input to list the presets.`;
  return toolResult(text, { ...SOURCE, query: query ?? null, ...pageFacts(page), results: page.items.map(listData) }, format);
}

function showPreset(preset: Preset, format: ResponseFormat) {
  const settings = { key: TRIAL_KEY, ...presetSettings(preset) };
  const imports = pluginFiles(preset).map((file) => `import '${file}';`);
  const notes = [...preset.notes, ...presetRequirements(preset)];
  const extensions = preset.extensions.map((id) => knowledge.extensions.find((e) => e.id === id)).filter((e): e is ExtensionInfo => !!e);
  const lines = [
    `# ${preset.title}`,
    preset.useWhen,
    '',
    `To build it, call froala_get_setup with preset "${preset.id}".`,
    '',
    'Plugin imports',
    '```js',
    imports.length ? imports.join('\n') : '// This preset needs no plugin files.',
    '```',
    '',
    'Settings. The trial key stays until you set your own key.',
    '```js',
    `const froalaConfig = ${editorConfig(preset)};`,
    '```',
    '',
    `CSS files are ${EDITOR_CSS.join(' and ')}.`,
    ...(notes.length ? ['', ...notes.map((n) => `- ${n}`)] : []),
    ...(extensions.length
      ? ['', 'Extensions that go well with this preset. Call froala_find_presets with one of these ids for its code.', ...extensions.map((e) => `- extension:${e.id}: ${e.title}. ${e.summary}`)]
      : [])
  ];
  return toolResult(
    lines.join('\n'),
    {
      ...SOURCE,
      id: preset.id,
      kind: 'preset',
      title: preset.title,
      group: preset.group,
      use_when: preset.useWhen,
      settings,
      plugin_imports: imports,
      css: EDITOR_CSS,
      notes,
      extensions: extensions.map((e) => `extension:${e.id}`)
    },
    format
  );
}

function showExample(example: ExampleInfo, target: Target, format: ResponseFormat) {
  const wanted = target === 'react' || target === 'nextjs' ? 'react' : target === 'vue' || target === 'nuxt' ? 'vue' : target === 'angular' ? 'angular' : 'javascript';
  // Some samples exist in plain JavaScript only.
  const key = example.code[wanted] ? wanted : 'javascript';
  const code = example.code[key];
  const lines = [
    `# ${example.title}`,
    example.summary,
    '',
    example.url,
    '',
    '```',
    code,
    '```',
    ...(example.files.length ? ['', `This sample also loads ${example.files.join(', ')}.`] : []),
    '',
    // The sample's page text is the part that can be left out, because the URL above has it.
    code.length + example.text.length < MAX_RESPONSE_CHARS - 2000 ? example.text : 'The page at the URL above explains this sample.'
  ];
  return toolResult(
    lines.join('\n').trim(),
    { ...SOURCE, id: `example:${example.id}`, kind: 'example', title: example.title, group: example.group, summary: example.summary, url: example.url, files: example.files, code, code_for: key },
    format
  );
}

function showLong(header: string[], body: string, part: number | undefined, id: string, data: Record<string, unknown>, format: ResponseFormat) {
  const parts = body ? splitParts(body) : [''];
  const wanted = part ?? 1;
  if (wanted > parts.length) return toolError(`${id} has ${parts.length} part(s), so there is no part ${wanted}. Ask for a part from 1 to ${parts.length}.`);
  const footer = wanted < parts.length ? [`[Call froala_find_presets with part ${wanted + 1} for the next part.]`] : [];
  return toolResult([...header, '', parts[wanted - 1], '', ...footer].join('\n').trim(), { ...SOURCE, id, ...data, markdown: parts[wanted - 1], part: wanted, parts_total: parts.length }, format);
}

/** Extension code stays in one fenced block per part, so people can copy each part in order. */
function showExtension(extension: ExtensionInfo, part: number | undefined, format: ResponseFormat) {
  const id = `extension:${extension.id}`;
  const lines = extension.code.split('\n');
  const parts: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length > PART_SIZE) {
      parts.push(current);
      current = '';
    }
    current += `${line}\n`;
  }
  if (current) parts.push(current);
  const wanted = part ?? 1;
  if (wanted > parts.length) return toolError(`${id} has ${parts.length} part(s), so there is no part ${wanted}. Ask for a part from 1 to ${parts.length}.`);
  const notes = [
    `Save this as froala-extension-${extension.id}.js next to froala-enhancements, import installFroalaExtension from it, and call installFroalaExtension(FroalaEditor) before you create an editor.`,
    ...(extension.buttons ? [`Add ${extension.buttons.join(', ')} to the toolbar.`] : []),
    ...(extension.options ? [`It reads the settings ${extension.options.join(', ')}.`] : []),
    'In a TypeScript project, declare the file as a module in a .d.ts file.'
  ];
  const footer = wanted < parts.length ? [`[This file continues. Call froala_find_presets with part ${wanted + 1}.]`] : [];
  return toolResult(
    [`# ${extension.title}`, extension.summary, '', ...notes.map((n) => `- ${n}`), '', `Part ${wanted} of ${parts.length}.`, '```js', parts[wanted - 1].trimEnd(), '```', ...footer].join('\n'),
    {
      ...SOURCE,
      id,
      kind: 'extension',
      title: extension.title,
      buttons: extension.buttons ?? [],
      options: extension.options ?? [],
      notes,
      code: parts[wanted - 1],
      part: wanted,
      parts_total: parts.length
    },
    format
  );
}

function show(id: string, target: Target, part: number | undefined, format: ResponseFormat) {
  const [prefix, name] = id.includes(':') ? [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)] : ['preset', id];
  const preset = prefix === 'preset' ? PRESETS.find((p) => p.id === name) : undefined;
  if (preset) return showPreset(preset, format);
  const example = prefix === 'example' ? knowledge.examples.find((e) => e.id === name) : undefined;
  if (example) return showExample(example, target, format);
  const paper = prefix === 'whitepaper' ? knowledge.whitepapers.find((w) => w.id === name) : undefined;
  if (paper) {
    const header = [`# ${paper.title}`, paper.summary, '', paper.url];
    return showLong(header, paper.markdown, part, id, { kind: 'whitepaper', title: paper.title, url: paper.url, summary: paper.summary }, format);
  }
  const extension = prefix === 'extension' ? knowledge.extensions.find((e) => e.id === name) : undefined;
  if (extension) return showExtension(extension, part, format);
  const suggestions = closestMany(
    id,
    entries.map((e) => e.id)
  );
  return toolError(`There is nothing called "${id}".${suggestions.length ? ` Did you mean ${suggestions.join(', ')}?` : ''} Call froala_find_presets with a query to search.`);
}

export function findPresets({ query, id, kind, target = 'javascript', part, limit = 10, offset = 0, response_format: format = 'markdown' }: z.input<typeof presetsInput>) {
  if (id) return show(id, target, part, format);
  return list({ query, kind, limit, offset, format });
}

export const presetsTool = {
  names: ['froala_find_presets'],
  instruction: 'When the user describes what the editor is for, such as comments, chat, email or a course lesson, call froala_find_presets. Pass the preset id to froala_get_setup to build it.',
  register(server: McpServer) {
    server.registerTool(
      'froala_find_presets',
      {
        title: 'Froala Presets',
        description:
          `Use this when you know what the editor is for, or you need a working sample. It searches ${PRESETS.length} ready-made editor presets, ${knowledge.examples.length} samples with React, Vue, Angular and JavaScript code, ${knowledge.whitepapers.length} whitepapers and ${knowledge.extensions.length} extensions such as checklists, mentions and template variables. ` +
          'Every preset uses the toolbar order of the Froala website. With no input it lists the presets. Call it with id to read one, then pass a preset id to froala_get_setup. Use froala_query_docs for API names. ' +
          'Examples: { query: "comments with emoji" }, { id: "comment-box" }, { id: "example:markdown-export", target: "react" } and { kind: "extension" }.',
        inputSchema: presetsInput,
        annotations: READ_ONLY
      },
      async (args) => findPresets(args)
    );
  }
};
