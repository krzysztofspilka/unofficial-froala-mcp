// The first result for common questions, and the right tool for topics the docs cover only in part.
// If a docs rebuild breaks one of these, look at weight() and OTHER_SOURCES in src/docs/search.ts.
import { expect, test } from 'vitest';
import { searchDocs } from '../src/docs/search.js';

const search = (query: string) => searchDocs({ query, limit: 5, offset: 0, format: 'markdown' }).structuredContent as { results: { url: string }[]; hints: string[]; partial: boolean };

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
  expect(
    search(query)
      .results.slice(0, 2)
      .map((r) => r.url)
      .join(' ')
  ).toContain(expected);
});

test.each([
  ['Next.js setup', 'target "nextjs"'],
  ['nuxt module', 'target "nuxt"'],
  ['svelte editor', 'target "svelte"'],
  ['tailwind reset', 'froala_get_integration'],
  ['React Vite 8 blank page', 'froala_audit_code']
])('"%s" points to the right tool', (query, hint) => {
  expect(search(query).hints.join(' ')).toContain(hint);
});
