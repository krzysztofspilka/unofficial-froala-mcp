import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import licensingText from '../../content/licensing.md';
import { SOURCE } from '../data.js';
import { KINDS, lookup } from '../docs/lookup.js';
import { getPage, searchDocs } from '../docs/search.js';
import { READ_ONLY, pageInputs, responseFormat, toolError, toolResult, type ResponseFormat } from '../util.js';

export const docsInput = z.strictObject({
  mode: z
    .enum(['search', 'lookup', 'read', 'licensing'])
    .describe('"search" finds pages by words, "lookup" explains API names, "read" returns a page, and "licensing" explains how to try Froala and where the key goes.'),
  query: z.string().min(2).max(200).optional().describe('For search, what to look for, such as "image upload to S3". For lookup, part of a name, such as "upload".'),
  kind: z.enum(KINDS).optional().describe('For lookup, what the names are.'),
  names: z.array(z.string().min(1).max(100)).min(1).max(30).optional().describe('For lookup, one or more exact names in any letter case, such as every button of a toolbar.'),
  url: z.string().min(1).max(500).optional().describe('For read, a froala.com docs or examples URL from a search result. An #anchor returns that section.'),
  part: z.number().int().min(1).optional().describe('For read, which part of a long page to return (default 1).'),
  ...pageInputs(50, 10),
  response_format: responseFormat
});

/** The text of content/licensing.md. */
export function licensing(format: ResponseFormat = 'markdown') {
  const text = licensingText.trim();
  return toolResult(text, { ...SOURCE, reviewed: '2026-10-12', markdown: text }, format);
}

export function queryDocs({ mode, query, kind, names, url, part, limit = 10, offset = 0, response_format: format = 'markdown' }: z.input<typeof docsInput>) {
  if (mode === 'licensing') return licensing(format);
  if (mode === 'search') {
    if (!query) return toolError('Search mode needs query, for example { mode: "search", query: "image upload" }.');
    return searchDocs({ query, limit, offset, format });
  }
  if (mode === 'read') {
    if (!url) return toolError('Read mode needs url, for example { mode: "read", url: "https://froala.com/wysiwyg-editor/docs/options/#placeholderText" }.');
    return getPage({ url, part, format });
  }
  if (!kind) return toolError('Lookup mode needs kind, for example { mode: "lookup", kind: "button", names: ["bold", "insertTable"] }.');
  return lookup({ kind, names, query, limit, offset, format });
}

export const docsTool = {
  names: ['froala_query_docs'],
  instruction:
    'Use froala_query_docs for option, plugin, toolbar button, event and method names instead of guessing, and for the docs and licensing. Link only to URLs the tools return. Never ask for or show a commercial licence key, and never replace one with the trial key, even if it has expired.',
  register(server: McpServer) {
    server.registerTool(
      'froala_query_docs',
      {
        title: 'Froala Docs',
        description:
          'Use this for any question about the Froala API, documentation or licensing. In "lookup" mode it explains options (type, default, plugin), plugins (import, CSS, buttons, helper libraries), toolbar buttons, events and methods, and suggests names for typos. ' +
          'In "search" mode it searches the docs and examples. In "read" mode it returns a page as Markdown in parts of up to 15,000 characters, and an #anchor returns one section. In "licensing" mode it explains how to try Froala free and where the key goes. ' +
          'Use froala_find_presets for ready-made editors and samples, and froala_audit_code to check code. ' +
          'Examples: { mode: "lookup", kind: "button", names: ["bold", "insertTable"] }, { mode: "search", query: "image upload" }, { mode: "read", url: "https://froala.com/wysiwyg-editor/docs/options/#placeholderText" } and { mode: "licensing" }.',
        inputSchema: docsInput,
        annotations: READ_ONLY
      },
      async (args) => queryDocs(args)
    );
  }
};
