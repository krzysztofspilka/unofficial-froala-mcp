import { describe, expect, test } from 'vitest';
import { lookup, type LookupArgs } from '../src/docs/lookup.js';
import { getPage, parseDocsUrl, searchDocs, splitParts } from '../src/docs/search.js';
import { licensing, queryDocs } from '../src/tools/docs.js';
import { setup } from '../src/tools/setup.js';
import { findPresets } from '../src/tools/presets.js';
import { getIntegration } from '../src/tools/integrations.js';
import { docs, knowledge } from '../src/data.js';
import { PRESETS } from '../src/presets.js';
import { MAX_RESPONSE_CHARS, paginate, toolResult } from '../src/util.js';

type Result = { content: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
// Results are read loosely here, because each test checks only a few fields of them.
const data = (result: Result) => result.structuredContent as Record<string, any>;
const first = (result: Result) => data(result).results[0];
const find = (args: Pick<LookupArgs, 'kind'> & Partial<LookupArgs> & { name?: string }) =>
  lookup({ names: args.name ? [args.name] : args.names, query: args.query, kind: args.kind, limit: args.limit ?? 50, offset: args.offset ?? 0, format: 'markdown' });
const search = (query: string) => searchDocs({ query, limit: 5, offset: 0, format: 'markdown' });
const read = (url: string, part?: number) => getPage({ url, part, format: 'markdown' });

describe('docs: lookup', () => {
  test('types come from the docs or the package types, not from defaults', () => {
    expect(first(find({ kind: 'option', name: 'placeholderText' })).type).toBe('String');
    expect(first(find({ kind: 'option', name: 'toolbarButtons' })).type).toBe('Object/Array');
    const azure = first(find({ kind: 'option', name: 'imageUploadToAzure' }));
    expect(azure.type).toBeNull();
    expect(azure.documented).toBe(false);
    expect(azure.docs_url).toBeNull();
  });

  test('full defaults, or a clear note when they are long', () => {
    expect(first(find({ kind: 'option', name: 'htmlAllowedTags' })).default).toHaveLength(106);
    expect(find({ kind: 'option', name: 'htmlAllowedTags' }).content[0].text).not.toContain('shortened');
  });

  test('plugins, bundles, buttons, events, methods and wrapper settings', () => {
    expect(first(find({ kind: 'button', name: 'insertTable' })).import).toBe('froala-editor/js/plugins/table.min.js');
    expect(find({ kind: 'plugin', name: 'imageTUI' }).content[0].text).toContain('Not included in plugins.pkgd.min.js');
    expect(find({ kind: 'plugin', name: 'imageTUI' }).content[0].text).toContain('froala_editor.pkgd.min.css does not include it');
    expect(first(find({ kind: 'event', name: 'contentChanged' })).docs_url).toBe('https://froala.com/wysiwyg-editor/docs/events/#contentChanged');
    expect(first(find({ kind: 'method', name: 'html.get' })).returns).toBe('String');
    expect(first(find({ kind: 'option', name: 'IMMEDIATEREACTMODELUPDATE' })).wrapper).toBe('react-froala-wysiwyg');
    expect(data(find({ kind: 'option', query: 'immediate' })).names).toContain('immediateReactModelUpdate');
  });

  test('options without a default have an answer', () => {
    expect(first(find({ kind: 'option', name: 'autofocus' })).found).toBe(true);
    expect(first(find({ kind: 'option', name: 'collabConfig' })).found).toBe(true);
    expect(find({ kind: 'option', name: 'nope' }).isError).toBe(true);
  });

  test('several names at once, with suggestions for unknown ones', () => {
    const result = data(find({ kind: 'button', names: ['bold', 'insertTable', 'boldd'] }));
    expect(result.results.map((r: { found: boolean }) => r.found)).toEqual([true, true, false]);
    expect(result.results[2].suggestions).toContain('bold');
  });

  test('lists come in pages', () => {
    const page = data(find({ kind: 'option', limit: 10, offset: 0 }));
    expect(page.count).toBe(10);
    expect(page.has_more).toBe(true);
    expect(page.next_offset).toBe(10);
    expect(data(find({ kind: 'option', limit: 10, offset: 10 })).names[0]).toBe(data(find({ kind: 'option', limit: 11, offset: 0 })).names[10]);
  });
});

describe('docs: search and read', () => {
  test('search, sections and honest misses', () => {
    expect(first(search('contentChanged event')).url).toBe('https://froala.com/wysiwyg-editor/docs/events/#contentChanged');
    const partial = data(search('table zzzunknownword'));
    expect(partial.partial).toBe(true);
    expect(search('table zzzunknownword').content[0].text).toContain('No page has all the words');
  });

  test('pages, anchors, parts and hosts', () => {
    const page = data(read('froala.com/wysiwyg-editor/docs/options'));
    expect(page.parts_total).toBeGreaterThan(1);
    expect(page.markdown.length).toBeGreaterThan(1000);
    expect(data(read('https://froala.com/wysiwyg-editor/docs/options/#placeholderText')).markdown).toMatch(/^### placeholderText/);
    expect(read('https://froala.com/wysiwyg-editor/docs/options/', 999).isError).toBe(true);
    expect(read('https://attacker.example/wysiwyg-editor/docs/options/').isError).toBe(true);
    const missing = read('https://froala.com/wysiwyg-editor/docs/does-not-exist/');
    expect(data(missing).found).toBe(false);
    expect(missing.isError).toBe(true);
  });

  test('a broken #anchor is a tool error, not an exception', () => {
    expect(parseDocsUrl('https://froala.com/wysiwyg-editor/docs/options/#%ZZ')).toHaveProperty('error');
    expect(read('https://froala.com/wysiwyg-editor/docs/options/#%ZZ').isError).toBe(true);
  });

  test('every part of every page has whole code blocks, also in lists', () => {
    const fence = /^\s*(?:[-*+]|\d+[.)])?\s*```/gm;
    const fences = (text: string) => (text.match(fence) ?? []).length;
    for (const page of docs.filter((p) => fences(p.markdown) % 2 === 0)) {
      for (const part of splitParts(page.markdown)) expect(fences(part) % 2, page.url).toBe(0);
    }
    const listed = `1. Install it.\n\n2. Add the module.\n\n3. \`\`\`ts\n${'x\n\n'.repeat(9000)}\`\`\`\n\nDone.`;
    for (const part of splitParts(listed)) expect(fences(part) % 2).toBe(0);
  });

  test('no answer about a whole page goes over the limit', () => {
    for (const page of docs) expect(read(page.url).content[0].text.length, page.url).toBeLessThanOrEqual(MAX_RESPONSE_CHARS + 200);
  });

  test('search past the last result still says the page exists', () => {
    expect(searchDocs({ query: 'image', limit: 2, offset: 100000, format: 'markdown' }).content[0].text).not.toContain('No Froala docs');
  });

  test('modes say what they need', () => {
    expect(queryDocs({ mode: 'search' }).isError).toBe(true);
    expect(queryDocs({ mode: 'read' }).isError).toBe(true);
    expect(queryDocs({ mode: 'lookup' }).isError).toBe(true);
    expect(queryDocs({ mode: 'lookup', kind: 'button', names: ['bold'] }).isError).toBeUndefined();
  });

  test('licensing explains the free trial with what was tested', () => {
    const text = licensing().content[0].text;
    expect(text).toContain('with no sign-up');
    expect(text).toContain('TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE');
    expect(text).toContain('Never use it in place of a commercial key');
    expect(queryDocs({ mode: 'licensing' }).content[0].text).toBe(text);
  });
});

describe('setup', () => {
  const pathsOf = (result: Result) => data(result).files.map((f: { path: string }) => f.path);
  const fileOf = (result: Result, name: string) => data(result).files.find((f: { path: string }) => f.path.endsWith(name)).content as string;

  test('a new React project gets the Simple preset, the enhancements file and a pinned install', () => {
    const react = setup({ target: 'react' });
    expect(pathsOf(react)).toEqual(['src/froala/froala-enhancements.ts', 'src/froala/froala-preset.ts', 'src/froala/FroalaEditor.tsx']);
    expect(data(react).install).toBe('npm install --save-exact froala-editor@5.6.0 react-froala-wysiwyg@5.6.0');
    expect(data(react).preset).toBe('simple');
    expect(fileOf(react, 'froala-preset.ts')).toContain(
      "['undo', 'redo'],\n    ['paragraphFormat'],\n    ['bold', 'italic', 'underline'],\n    ['insertLink', 'insertImage'],\n    ['formatUL', 'formatOL']"
    );
    expect(fileOf(react, 'froala-preset.ts')).toContain('installFroalaEnhancements(FroalaEditor);');
    expect(fileOf(react, 'froala-preset.ts')).toContain('htmlExecuteScripts: false');
    expect(fileOf(react, 'FroalaEditor.tsx')).toContain("import FroalaEditorComponent from 'react-froala-wysiwyg';");
    expect(fileOf(react, 'FroalaEditor.tsx')).not.toContain('.default ??');
  });

  test('the code follows package.json', () => {
    const vite7 = JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^7.1.0' } });
    const react = setup({ target: 'react', package_json: vite7 });
    expect(data(react).project).toBe('Based on your package.json: React 19.0.0, Vite 7.1.0.');
    expect(pathsOf(react)).toContain('src/froala/FroalaEditor.jsx');

    const cra = JSON.stringify({ dependencies: { react: '^18.0.0', 'react-scripts': '5.0.1' } });
    expect(fileOf(setup({ target: 'react', package_json: cra }), 'froala-preset.js')).toContain('process.env.REACT_APP_FROALA_KEY');

    const nuxt3 = JSON.stringify({ type: 'module', dependencies: { nuxt: '^3.17.0' } });
    expect(pathsOf(setup({ target: 'nuxt', package_json: nuxt3 }))).toContain('plugins/froala.client.js');

    const angularSsr = JSON.stringify({ dependencies: { '@angular/core': '^22.2.2', '@angular/ssr': '^22.2.2' } });
    const angular = setup({ target: 'angular', package_json: angularSsr });
    expect(fileOf(angular, 'froala-editor.component.ts')).toContain('isPlatformBrowser');
    expect(pathsOf(angular)).toContain('src/froala-plugins.d.ts');

    const next = JSON.stringify({ dependencies: { next: '16.0.0', react: '^19.3.0' } });
    expect(data(setup({ target: 'react', package_json: next })).notes[0]).toContain('target "nextjs"');
  });

  test('JavaScript gets a page without package.json and a module with it', () => {
    expect(pathsOf(setup({ target: 'javascript' }))).toEqual(['froala-enhancements.js', 'index.html']);
    expect(fileOf(setup({ target: 'javascript' }), 'index.html')).toContain('froala-editor@5.6.0');
    const vite = JSON.stringify({ type: 'module', devDependencies: { vite: '^8.0.0' } });
    expect(pathsOf(setup({ target: 'javascript', package_json: vite }))).toEqual(['src/froala/froala-enhancements.js', 'src/froala/froala-preset.js']);
  });

  test('Tailwind projects get the content styles', () => {
    const tailwind = JSON.stringify({ type: 'module', dependencies: { react: '^19.0.0', tailwindcss: '^4.0.0' }, devDependencies: { vite: '^8.0.0' } });
    const result = setup({ target: 'react', package_json: tailwind });
    expect(pathsOf(result)).toContain('src/froala/froala-content.css');
    expect(fileOf(result, 'froala-preset.js')).toContain("import './froala-content.css';");
  });

  test('another preset changes the toolbar and the plugins', () => {
    const result = setup({ target: 'typescript', preset: 'comment-box' });
    expect(fileOf(result, 'froala-preset.ts')).toContain("import 'froala-editor/js/plugins/char_counter.min.js';");
    expect(fileOf(result, 'froala-preset.ts')).toContain('charCounterMax: 1000');
    expect(setup({ target: 'react', preset: 'simpel' }).content[0].text).toContain('"simple"');
    expect(setup({ target: 'react', preset: 'simpel' }).isError).toBe(true);
  });

  test('command, code and notes agree on the Froala version', () => {
    const project = (froala: string) =>
      JSON.stringify({ type: 'module', dependencies: { react: '^19.3.0', 'froala-editor': froala, 'react-froala-wysiwyg': froala }, devDependencies: { vite: '^8.3.4' } });
    // A project on a newer release keeps it.
    const newer = setup({ target: 'react', package_json: project('5.7.0') });
    expect(data(newer).install).toBe('npm install');
    expect(data(newer).notes[0]).toContain('newer than the Froala 5.6.0 data');
    // Every other project installs 5.6.0, which needs no import fix.
    for (const version of ['4.7.1', '5.5.0', '^5.5.0', 'latest', 'workspace:*', '>=4 <6']) {
      const result = setup({ target: 'react', package_json: project(version) });
      expect(data(result).install, version).toContain('froala-editor@5.6.0');
      expect(fileOf(result, 'FroalaEditor.jsx'), version).not.toContain('.default ??');
    }
  });

  test('the key is never missing, and the key of the project comes first', () => {
    const trial = 'TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE';
    expect(fileOf(setup({ target: 'react' }), 'froala-preset.ts')).toContain(`key: import.meta.env.VITE_FROALA_KEY || '${trial}'`);
    expect(fileOf(setup({ target: 'nextjs' }), 'froala-preset.ts')).toContain(`key: process.env.NEXT_PUBLIC_FROALA_KEY || '${trial}'`);
    expect(fileOf(setup({ target: 'svelte' }), 'froala-preset.ts')).toContain(`key: import.meta.env.VITE_FROALA_KEY || '${trial}'`);
    expect(fileOf(setup({ target: 'angular' }), 'froala-preset.ts')).toContain(`key: '${trial}'`);
    expect(fileOf(setup({ target: 'javascript' }), 'index.html')).toContain(`key: '${trial}'`);
    const nuxt = setup({ target: 'nuxt' });
    expect(fileOf(nuxt, 'froala-config.ts')).toContain(`key: '${trial}'`);
    expect(fileOf(nuxt, 'FroalaEditor.vue')).toContain('useRuntimeConfig().public.froalaKey || froalaConfig.key');
    for (const target of ['react', 'vue', 'angular', 'nextjs', 'nuxt', 'svelte', 'typescript', 'javascript'] as const) {
      expect(data(setup({ target })).notes.join(' '), target).toContain('keep that key, even if it has expired');
    }
  });

  test('a project on a newer Froala gets what it is missing, at its own version', () => {
    const newer = (deps: object) => setup({ target: 'react', package_json: JSON.stringify({ dependencies: { react: '^19.3.0', ...deps } }) });
    expect(data(newer({ 'froala-editor': '5.7.0' })).install).toBe('npm install --save-exact react-froala-wysiwyg@5.7.0');
    expect(data(newer({ 'froala-editor': '5.7.0', 'react-froala-wysiwyg': '5.7.0' })).install).toBe('npm install');
    expect(data(newer({ 'froala-editor': '5.5.0', 'react-froala-wysiwyg': '5.7.0' })).install).toBe('npm install --save-exact froala-editor@5.7.0');
  });

  test('layouts follow version ranges, and say so when they cannot tell', () => {
    const nuxt = (range: string) => setup({ target: 'nuxt', package_json: JSON.stringify({ type: 'module', dependencies: { nuxt: range } }) });
    expect(pathsOf(nuxt('^4.0.0'))).toContain('app/plugins/froala.client.js');
    expect(pathsOf(nuxt('^3.17.0'))).toContain('plugins/froala.client.js');
    expect(data(nuxt('^3.0.0 || ^4.0.0')).notes.join(' ')).toContain('does not show the Nuxt version');
    const svelte = (range: string) => data(setup({ target: 'svelte', package_json: JSON.stringify({ devDependencies: { svelte: '^5.0.0', '@sveltejs/kit': range } }) })).notes.join(' ');
    expect(svelte('^2.0.0')).toContain('$lib/froala');
    expect(svelte('^3.0.0')).toContain('#lib/froala');
    expect(svelte('>=2.0.0')).toContain('does not show the SvelteKit version');
  });

  test('every target and preset fits in one answer, and JSON answers are valid', () => {
    for (const target of ['react', 'vue', 'angular', 'nextjs', 'nuxt', 'svelte', 'typescript', 'javascript'] as const) {
      for (const { id } of PRESETS) {
        const text = setup({ target, preset: id }).content[0].text;
        expect(text.length, `${target} ${id}`).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
        expect(text, `${target} ${id}`).not.toContain('longer than');
        expect(() => JSON.parse(setup({ target, preset: id, response_format: 'json' }).content[0].text), `${target} ${id}`).not.toThrow();
      }
    }
  });

  test('TypeScript presets pass their settings as an object, so every preset compiles', () => {
    expect(fileOf(setup({ target: 'typescript', preset: 'comment-box' }), 'froala-preset.ts')).toContain('new FroalaEditor(target, froalaConfig as object)');
  });

  test('broken input is a tool error', () => {
    expect(setup({ target: 'react', package_json: '{ nope' }).isError).toBe(true);
    expect(setup({ target: 'react', package_json: '[1, 2]' }).isError).toBe(true);
    // A dependency with a wrong type is ignored instead of crashing.
    expect(setup({ target: 'react', package_json: JSON.stringify({ dependencies: { react: 19 } }) }).isError).toBeUndefined();
    expect(setup({ target: 'react', package_json: JSON.stringify({ dependencies: { astro: '^5.0.0' } }) }).isError).toBe(true);
  });
});

describe('presets', () => {
  test('lists the presets, with paging', () => {
    const list = data(findPresets({}));
    expect(list.results[0].id).toBe('simple');
    expect(list.total).toBeGreaterThan(25);
    expect(data(findPresets({ limit: 5, offset: 5 })).results).toHaveLength(5);
  });

  test('finds presets, samples, whitepapers and extensions by what they are for', () => {
    expect(data(findPresets({ query: 'comments' })).results[0].id).toBe('comment-box');
    expect(data(findPresets({ query: 'LMS lessons' })).results.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining(['lms-lesson', 'whitepaper:lms-developers']));
    expect(data(findPresets({ query: 'markdown', kind: 'example' })).results.every((r: { kind: string }) => r.kind === 'example')).toBe(true);
    expect(data(findPresets({ kind: 'extension' })).total).toBe(knowledge.extensions.length);
  });

  test('reads a preset, a sample, a whitepaper and an extension', () => {
    const preset = data(findPresets({ id: 'comment-box' }));
    expect(preset.settings.charCounterMax).toBe(1000);
    expect(preset.settings.key).toBe('TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE');
    expect(preset.settings.toolbarButtons[0]).toEqual(['undo', 'redo']);
    expect(data(findPresets({ id: 'example:color-themes', target: 'react' })).code).toContain('react-froala-wysiwyg');
    expect(data(findPresets({ id: 'example:color-themes', target: 'svelte' })).code_for).toBe('javascript');
    expect(data(findPresets({ id: 'whitepaper:lms-developers' })).parts_total).toBeGreaterThan(1);
    const extension = data(findPresets({ id: 'extension:template-variables' }));
    expect(extension.parts_total).toBe(2);
    const whole = [1, 2].map((part) => data(findPresets({ id: 'extension:template-variables', part })).code).join('');
    expect(whole.trim()).toBe(knowledge.extensions.find((e) => e.id === 'template-variables')!.code.trim());
  });

  test('every sample has code, and its JSON answer carries the content', () => {
    for (const sample of knowledge.examples) {
      const answer = findPresets({ id: `example:${sample.id}`, target: 'react' });
      expect(data(answer).code.length, sample.id).toBeGreaterThan(50);
      expect(answer.content[0].text.length, sample.id).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      expect(data(answer).code, sample.id).not.toContain('.default ??');
    }
    expect(data(findPresets({ id: 'whitepaper:images', response_format: 'json' })).markdown.length).toBeGreaterThan(1000);
  });

  test('unknown ids are errors with suggestions', () => {
    const result = findPresets({ id: 'coment-box' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('comment-box');
  });
});

describe('integrations', () => {
  test('lists and reads integrations from the content folder', () => {
    const ids = data(getIntegration({})).integrations.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['tailwind', 'tanstack', 'salesforce', 'nextjs', 'nuxt', 'svelte']));
    expect(data(getIntegration({ name: 'tailwind' })).markdown).toContain('.fr-view');
    expect(data(getIntegration({ target: 'react' })).integrations.map((i: { id: string }) => i.id)).toContain('tanstack');
    expect(getIntegration({ name: 'tailwnd' }).isError).toBe(true);
    expect(getIntegration({ name: 'tailwnd' }).content[0].text).toContain('"tailwind"');
  });
});

describe('answers', () => {
  test('paginate reports the next page', () => {
    expect(paginate([1, 2, 3], 2, 0)).toMatchObject({ items: [1, 2], total: 3, count: 2, has_more: true, next_offset: 2 });
    expect(paginate([1, 2, 3], 2, 2)).toMatchObject({ items: [3], has_more: false, next_offset: null });
  });

  test('json answers carry the same data as text', () => {
    const result = toolResult('Hello', { a: 1 }, 'json');
    expect(JSON.parse(result.content[0].text)).toEqual({ a: 1 });
    expect(result.structuredContent).toEqual({ a: 1 });
  });
});
