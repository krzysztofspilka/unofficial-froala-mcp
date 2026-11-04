// Searches and reads this server's copy of the Froala docs. Each option, event and method is its own search entry.
import MiniSearch from 'minisearch';
import { docs, SOURCE, type DocPage } from '../data.js';
import { moreLine, pageFacts, paginate, toolError, toolResult, type ResponseFormat } from '../util.js';

export const PART_SIZE = 15_000;
const REFERENCE_PAGES = /\/docs\/(options|events|methods)\/$/;

/** A search entry, which is a whole page or one section of the options, events and methods references. */
interface Entry {
  id: string;
  url: string;
  title: string;
  section: string;
  headings: string[];
  markdown: string;
  legacyCode?: boolean;
  published?: boolean;
}

/** The ### sections of a reference page, each with its anchor (the option, event or method name). */
function referenceSections(page: DocPage): Entry[] {
  const sections = new Map<string, Entry>();
  for (const m of page.markdown.matchAll(/^### (.+)\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/gm)) {
    const heading = m[1].replace(/\\/g, '').trim();
    const anchor = heading.match(/^[\w.]+/)?.[0] ?? heading;
    const id = `${page.url}#${anchor}`;
    const markdown = `### ${m[1]}\n${m[2]}`.trim();
    // A name documented twice (for example in two plugins) becomes one entry with both sections.
    const existing = sections.get(id);
    if (existing) existing.markdown += `\n\n${markdown}`;
    else sections.set(id, { id, url: id, title: `${heading} (${page.title})`, section: page.section, headings: [], markdown, published: page.published });
  }
  return [...sections.values()];
}

const entries: Entry[] = docs.flatMap((page) => (REFERENCE_PAGES.test(page.url) ? referenceSections(page) : [{ ...page, id: page.url }]));
const byUrl = new Map(docs.map((p) => [p.url, p]));
const byId = new Map(entries.map((e) => [e.id, e]));

// Migration guides and pages for AngularJS describe other setups, so they rank lower.
function weight(entry: Entry): number {
  if (entry.url.includes('/migration-guides/') || /\/(angular1|angularjs-[\d-]+)\//.test(entry.url)) return 0.5;
  if (entry.published === false) return 0.7;
  return entry.legacyCode ? 0.8 : 1;
}

let index: MiniSearch<Entry> | undefined;

/** Built on first use, then kept for the life of the process. */
function getIndex(): MiniSearch<Entry> {
  if (!index) {
    index = new MiniSearch<Entry>({
      // "path" is the URL path as words, so /plugins/table-plugin/ matches "table plugin".
      fields: ['title', 'path', 'headings', 'markdown'],
      storeFields: ['url', 'title'],
      extractField: (entry, field) => {
        if (field === 'path') return entry.url.replace('https://froala.com/wysiwyg-editor/', '').replace(/[/#.-]/g, ' ');
        const value = entry[field as keyof Entry];
        return Array.isArray(value) ? value.join(' ') : String(value ?? '');
      },
      searchOptions: {
        boost: { title: 4, path: 3, headings: 2 },
        boostDocument: (id) => weight(byId.get(id as string)!),
        prefix: true,
        fuzzy: 0.15,
        combineWith: 'AND'
      }
    });
    index.addAll(entries);
  }
  return index;
}

function snippet(entry: Entry, terms: string[]): string {
  const text = entry.markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>[\]]/g, '')
    .replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    at = lower.indexOf(term.toLowerCase());
    if (at >= 0) break;
  }
  const start = Math.max(0, at < 0 ? 0 : at - 120);
  const piece = text.slice(start, start + 400).trim();
  return (start > 0 ? '...' : '') + piece + (start + 400 < text.length ? '...' : '');
}

// Topics the docs cover only in part, and where the answer is instead.
const OTHER_SOURCES: [RegExp, string][] = [
  [/next\.?js|nextjs/i, 'froala_get_integration with name "nextjs" has the Next.js guide, and froala_get_setup with target "nextjs" gives tested setup code.'],
  [/nuxt/i, 'froala_get_integration with name "nuxt" has the Nuxt guide, and froala_get_setup with target "nuxt" gives tested setup code.'],
  [/svelte/i, 'froala_get_integration with name "svelte" has the Svelte guide, and froala_get_setup with target "svelte" gives tested setup code.'],
  [/tailwind|tanstack|salesforce/i, 'froala_get_integration has a guide for this.'],
  [/vite|blank page|white page|not (render|show)/i, 'For a blank page with Vite 8 and other known problems, call froala_audit_code with your package.json.']
];

const UNPUBLISHED_NOTE = 'This guide is in this server only, so do not link to its URL.';

export function searchDocs({ query, limit, offset, format }: { query: string; limit: number; offset: number; format: ResponseFormat }) {
  const idx = getIndex();
  let hits = idx.search(query);
  let partial = false;
  if (hits.length === 0) {
    hits = idx.search(query, { combineWith: 'OR' });
    partial = hits.length > 0;
  }
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const page = paginate(hits, limit, offset);
  const results = page.items.map((hit) => {
    const entry = byId.get(hit.id as string)!;
    const missing = partial ? words.filter((w) => !hit.terms.some((t) => t.startsWith(w.slice(0, Math.max(3, w.length - 2))))) : [];
    const notes = [
      entry.legacyCode && 'This page has code written for Froala 2. Event handlers there take (e, editor). Since Froala 3 the editor is this.',
      entry.published === false && UNPUBLISHED_NOTE
    ].filter(Boolean);
    return {
      title: entry.title,
      url: entry.url,
      snippet: snippet(entry, hit.terms),
      ...(missing.length ? { missing_words: missing } : {}),
      ...(notes.length ? { note: notes.join(' ') } : {})
    };
  });
  const hints = OTHER_SOURCES.filter(([pattern]) => pattern.test(query)).map(([, hint]) => hint);
  if (hits.length === 0) {
    return toolResult([`No Froala docs or examples match "${query}".`, ...hints].join('\n'), { ...SOURCE, query, partial: false, results: [], hints, ...pageFacts(page) }, format);
  }
  const text = [
    partial ? `No page has all the words in "${query}". These pages have some of them.\n` : '',
    results
      .map(
        (r, i) => `${offset + i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}${r.missing_words ? `\n   (does not mention ${r.missing_words.join(', ')})` : ''}${r.note ? `\n   Note. ${r.note}` : ''}`
      )
      .join('\n\n'),
    hints.length ? `\n${hints.join('\n')}` : '',
    moreLine(page) ? `\n${moreLine(page)}` : '',
    '\nUse froala_query_docs in read mode with one of these URLs to read it.'
  ]
    .join('\n')
    .trim();
  return toolResult(text, { ...SOURCE, query, partial, results, hints, ...pageFacts(page) }, format);
}

/** Turns a URL into its docs key and anchor, or explains why it is not a Froala docs URL. */
export function parseDocsUrl(url: string): { key: string; anchor?: string } | { error: string } {
  let u = url.trim();
  if (u.startsWith('/')) u = `https://froala.com${u}`;
  if (!/^[a-z]+:\/\//i.test(u)) u = `https://${u}`;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { error: `${url} is not a valid URL.` };
  }
  if (!/^https?:$/.test(parsed.protocol) || !/^(www\.)?froala\.com$/i.test(parsed.hostname)) {
    return { error: `Only froala.com docs and examples URLs are supported, and ${url} is on ${parsed.hostname || 'another site'}.` };
  }
  let pathname = parsed.pathname;
  if (!pathname.endsWith('/')) pathname += '/';
  let anchor: string | undefined;
  try {
    anchor = parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : undefined;
  } catch {
    return { error: `The part of ${url} after # is not valid. Send the URL without it.` };
  }
  return { key: `https://froala.com${pathname}`, anchor };
}

/** A line that opens or closes a code block, also when it follows a list marker such as "3. ". */
const CODE_FENCE = /^\s*(?:[-*+]|\d+[.)])?\s*```/;

/**
 * Splits a page into parts of up to PART_SIZE characters. It cuts at a heading or a blank line,
 * never inside a code block, so every part has whole code blocks.
 */
export function splitParts(markdown: string): string[] {
  const blocks: string[] = [];
  let current = '';
  let inCode = false;
  for (const line of markdown.split('\n')) {
    if (CODE_FENCE.test(line)) inCode = !inCode;
    current += `${line}\n`;
    if (!inCode && line.trim() === '') {
      blocks.push(current);
      current = '';
    }
  }
  if (current) blocks.push(current);
  // A very long paragraph, such as the list of every option, may be cut between lines, and a very long line between words.
  const cutLine = (line: string): string[] => {
    const pieces: string[] = [];
    let rest = line;
    // Half a part at a time, so the pieces fill parts that already have some text.
    while (rest.length > PART_SIZE / 2) {
      const at = rest.lastIndexOf(' ', PART_SIZE / 2);
      const cut = at > 0 ? at + 1 : PART_SIZE / 2;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return [...pieces, rest];
  };
  const hasCode = (block: string) => block.split('\n').some((line) => CODE_FENCE.test(line));
  const sized = blocks.flatMap((block) => (block.length <= PART_SIZE || hasCode(block) ? [block] : block.split(/(?<=\n)/).flatMap(cutLine)));
  const parts: string[] = [];
  let part = '';
  for (const block of sized) {
    if (part && part.length + block.length > PART_SIZE) {
      parts.push(part.trim());
      part = '';
    }
    part += block;
  }
  if (part.trim()) parts.push(part.trim());
  return parts;
}

export function getPage({ url, part, format }: { url: string; part?: number; format: ResponseFormat }) {
  const parsed = parseDocsUrl(url);
  if ('error' in parsed) return toolError(parsed.error);
  const page = byUrl.get(parsed.key);
  if (!page) {
    const words = parsed.key
      .replace(/https?:\/\/[^/]+/, '')
      .split(/[^a-zA-Z0-9]+/)
      .filter((w) => w.length > 2 && !['wysiwyg', 'editor', 'docs'].includes(w));
    const hits = words.length ? getIndex().search(words.join(' '), { combineWith: 'OR' }).slice(0, 5) : [];
    const suggestions = [...new Set(hits.map((h) => byId.get(h.id as string)!.url))];
    const text =
      `There is no Froala docs or examples page at ${url} in this server's copy of the docs (${SOURCE.docs_snapshot}).` +
      (suggestions.length ? ` Closest pages:\n${suggestions.map((s) => `- ${s}`).join('\n')}` : ' Use search mode to find the right page.');
    return { ...toolResult(text, { ...SOURCE, found: false, url, suggestions }, format), isError: true };
  }
  const published = page.published !== false;
  // An anchor such as #placeholderText returns that section of a reference page.
  if (parsed.anchor && !part) {
    const section = byId.get(`${page.url}#${parsed.anchor}`);
    if (section) {
      return toolResult(
        `${section.url}\n\n${section.markdown}`,
        { ...SOURCE, found: true, url: section.url, title: section.title, markdown: section.markdown, part: 1, parts_total: 1, published },
        format
      );
    }
  }
  const parts = splitParts(page.markdown);
  const wanted = part ?? 1;
  if (wanted > parts.length) return toolError(`${page.url} has ${parts.length} part(s), so there is no part ${wanted}. Ask for a part from 1 to ${parts.length}.`);
  const markdown = parts[wanted - 1];
  const header = parts.length > 1 ? `Part ${wanted} of ${parts.length}. ${page.url}\n\n` : `${page.url}\n\n`;
  const footer = wanted < parts.length ? `\n\n[Call froala_query_docs in read mode with part ${wanted + 1} for the next part.]` : '';
  const legacy = page.legacyCode ? '\n\nNote. This page has code written for Froala 2. Since Froala 3 the editor is this inside event handlers, not a parameter.' : '';
  const unpublished = published ? '' : `\n\nNote. ${UNPUBLISHED_NOTE}`;
  return toolResult(
    header + markdown + footer + legacy + unpublished,
    { ...SOURCE, found: true, url: page.url, title: page.title, markdown, part: wanted, parts_total: parts.length, published },
    format
  );
}
