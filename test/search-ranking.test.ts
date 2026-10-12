// The first result for common questions, and honest answers for topics the docs don't cover.
// If a docs rebuild breaks one of these, look at weight() and NOT_IN_DOCS in src/tools/docs.ts.
import { expect, test } from 'vitest';
import { searchDocs } from '../src/tools/docs.js';

const search = (query: string) => searchDocs({ query }).structuredContent as { results: { url: string }[]; hints: string[]; partial: boolean };

test.each([
  ['table plugin', 'docs/plugins/table-plugin/'],
  ['image upload s3', '/image-s3-upload/'],
  ['react', 'docs/framework-plugins/react/'],
  ['angular', 'docs/framework-plugins/angular/'],
  ['custom button', 'docs/concepts/custom/button/'],
  ['paste from word', 'docs/plugins/word-paste-plugin/'],
  ['contentChanged event', 'docs/events/#contentChanged'],
  ['placeholderText', 'docs/options/#placeholderText']
])('"%s" finds %s first', (query, expected) => {
  expect(search(query).results[0]?.url).toContain(expected);
});

test.each([
  ['license key', 'docs/activation/'],
  ['html.get method', 'docs/methods/#html.get']
])('"%s" finds %s in the first two', (query, expected) => {
  expect(search(query).results.slice(0, 2).map((r) => r.url).join(' ')).toContain(expected);
});

test.each([
  ['Next.js setup', 'no Next.js guide'],
  ['nuxt module', 'no Nuxt guide'],
  ['React Vite 8 blank page', 'froala_workarounds']
])('"%s" points to the right tool', (query, hint) => {
  expect(search(query).hints.join(' ')).toContain(hint);
});
