import { expect, test } from 'vitest';
import { parse } from '@babel/parser';
import { lookup } from '../src/tools/lookup.js';
import { searchDocs, getPage, splitParts } from '../src/tools/docs.js';
import { licensing } from '../src/tools/licensing.js';
import { recipes, RECIPES } from '../src/tools/recipes.js';
import { setup } from '../src/tools/setup.js';
import { docs } from '../src/data.js';

const data = (result: { structuredContent?: Record<string, unknown> }) => result.structuredContent as Record<string, any>;
const first = (result: { structuredContent?: Record<string, unknown> }) => data(result).results[0];

test('lookup: types come from the docs or the package types, not from defaults', () => {
  expect(first(lookup({ kind: 'option', name: 'placeholderText' })).type).toBe('String');
  expect(first(lookup({ kind: 'option', name: 'toolbarButtons' })).type).toBe('Object/Array');
  const azure = first(lookup({ kind: 'option', name: 'imageUploadToAzure' }));
  expect(azure.type).toBeNull();
  expect(azure.documented).toBe(false);
  expect(azure.docs_url).toBeNull();
});

test('lookup: full defaults, or a clear note when they are long', () => {
  expect(first(lookup({ kind: 'option', name: 'htmlAllowedTags' })).default).toHaveLength(106);
  expect(lookup({ kind: 'option', name: 'htmlAllowedTags' }).content[0].text).not.toContain('shortened');
});

test('lookup: plugins, bundles, buttons, events, methods and wrapper settings', () => {
  expect(first(lookup({ kind: 'button', name: 'insertTable' })).import).toBe('froala-editor/js/plugins/table.min.js');
  expect(lookup({ kind: 'plugin', name: 'imageTUI' }).content[0].text).toContain('Not included in plugins.pkgd.min.js');
  expect(lookup({ kind: 'plugin', name: 'imageTUI' }).content[0].text).toContain("froala_editor.pkgd.min.css doesn't include it");
  expect(first(lookup({ kind: 'event', name: 'contentChanged' })).docs_url).toBe('https://froala.com/wysiwyg-editor/docs/events/#contentChanged');
  expect(first(lookup({ kind: 'method', name: 'html.get' })).returns).toBe('String');
  expect(first(lookup({ kind: 'option', name: 'IMMEDIATEREACTMODELUPDATE' })).wrapper).toBe('react-froala-wysiwyg');
  expect(data(lookup({ kind: 'option', query: 'immediate' })).names).toContain('immediateReactModelUpdate');
});

test('lookup: several names at once, with suggestions for unknown ones', () => {
  const result = data(lookup({ kind: 'button', names: ['bold', 'insertTable', 'boldd'] }));
  expect(result.results.map((r: { found: boolean }) => r.found)).toEqual([true, true, false]);
  expect(result.results[2].suggestions).toContain('bold');
});

test('docs: search, sections and honest misses', () => {
  expect(first(searchDocs({ query: 'contentChanged event' })).url).toBe('https://froala.com/wysiwyg-editor/docs/events/#contentChanged');
  expect(data(searchDocs({ query: 'Next.js setup' })).hints.join(' ')).toContain('no Next.js guide');
  const partial = data(searchDocs({ query: 'table zzzunknownword' }));
  expect(partial.partial).toBe(true);
  expect(searchDocs({ query: 'table zzzunknownword' }).content[0].text).toContain('No page has all the words');
});

test('docs: pages, anchors, parts and hosts', () => {
  const page = data(getPage({ url: 'froala.com/wysiwyg-editor/docs/options' }));
  expect(page.parts_total).toBeGreaterThan(1);
  expect(page.markdown.length).toBeGreaterThan(1000);
  const section = data(getPage({ url: 'https://froala.com/wysiwyg-editor/docs/options/#placeholderText' }));
  expect(section.markdown).toMatch(/^### placeholderText/);
  expect(getPage({ url: 'https://froala.com/wysiwyg-editor/docs/options/', part: 999 }).isError).toBe(true);
  expect(getPage({ url: 'https://attacker.example/wysiwyg-editor/docs/options/' }).isError).toBe(true);
  expect(data(getPage({ url: 'https://froala.com/wysiwyg-editor/docs/does-not-exist/' })).found).toBe(false);
});

test('docs: every part has whole code blocks', () => {
  const fences = (text: string) => (text.match(/^\s*```/gm) ?? []).length;
  // Some converted pages have an unclosed code block of their own; only pages with whole blocks are checked.
  for (const page of docs.filter((p) => fences(p.markdown) % 2 === 0)) {
    for (const part of splitParts(page.markdown)) expect(fences(part) % 2, page.url).toBe(0);
  }
});

test('licensing explains the free trial with what was tested', () => {
  const text = licensing().content[0].text;
  expect(text).toContain('needs no sign-up and no key');
  expect(text).toContain('only bold, italic and underline work'.replace('only', 'Only'));
  expect(text).toContain('On localhost');
  expect(text).not.toContain('<!--');
});

test('recipes: images stay plain links, and the display snippets are valid code', () => {
  expect(data(recipes({})).recipes.length).toBeGreaterThanOrEqual(8);
  expect(data(recipes({ use_case: 'minimal' })).plugin_imports).toContain("import 'froala-editor/js/plugins/char_counter.min.js';");
  expect(data(recipes({ use_case: 'classic' })).config.imageUploadRemoteUrls).toBe(false);
  const display = RECIPES.find((r) => r.id === 'display')!;
  const react = display.snippets!.find((s) => s.language === 'tsx')!;
  expect(() => parse(react.code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  expect(react.install).toBe('npm install dompurify');
});

test('setup reads package.json', () => {
  expect(data(setup({ framework: 'cdn' })).files[0].content).toContain('froala-editor@5.5.0');
  expect(data(setup({ framework: 'react' })).project).toContain('Written for a new project (React 19.3.0, Vite 8.3.4');
  expect(data(setup({ framework: 'react' })).install).toBe('npm install --save-exact froala-editor@5.5.0 react-froala-wysiwyg@5.5.0');

  const vite7 = JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^7.1.0' } });
  const react = data(setup({ framework: 'react', package_json: vite7 }));
  expect(react.project).toBe('Based on your package.json: React 19.0.0, Vite 7.1.0.');
  expect(react.files[0].path).toBe('src/components/FroalaEditor.jsx');
  expect(react.files[0].content).not.toContain('.default ??');

  const cra = JSON.stringify({ dependencies: { react: '^18.0.0', 'react-scripts': '5.0.1' } });
  expect(data(setup({ framework: 'react', package_json: cra })).files[0].content).toContain('process.env.REACT_APP_FROALA_KEY');

  const nuxt3 = JSON.stringify({ type: 'module', dependencies: { nuxt: '^3.17.0' } });
  expect(data(setup({ framework: 'nuxt', package_json: nuxt3 })).files[0].path).toBe('plugins/froala.client.js');

  const angularSsr = JSON.stringify({ dependencies: { '@angular/core': '^22.2.2', '@angular/ssr': '^22.2.2' } });
  const angular = data(setup({ framework: 'angular', package_json: angularSsr }));
  expect(angular.files[0].content).toContain('isPlatformBrowser');
  expect(angular.files.map((f: { path: string }) => f.path)).toContain('src/froala-plugins.d.ts');

  const next = JSON.stringify({ dependencies: { next: '16.0.0', react: '^19.3.0' } });
  expect(data(setup({ framework: 'react', package_json: next })).notes[0]).toContain('framework "nextjs"');
  const newer = JSON.stringify({ dependencies: { react: '^19.0.0', 'froala-editor': '^5.6.0' } });
  expect(data(setup({ framework: 'react', package_json: newer })).notes[0]).toContain('newer than the Froala 5.5.0 data');
});

test('broken package.json input is a tool error', () => {
  expect(setup({ framework: 'react', package_json: '{ nope' }).isError).toBe(true);
  expect(setup({ framework: 'react', package_json: '[1, 2]' }).isError).toBe(true);
  // A dependency with a wrong type is ignored instead of crashing.
  expect(setup({ framework: 'react', package_json: JSON.stringify({ dependencies: { react: 19 } }) }).isError).toBeUndefined();
});
