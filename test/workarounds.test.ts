import { expect, test } from 'vitest';
import { workarounds } from '../src/tools/workarounds.js';

type Returned = { id: string; applies: string };
/** The workarounds returned for a package.json. */
const returnedFor = (pkg: object) => (workarounds({ package_json: JSON.stringify(pkg) }).structuredContent as { workarounds: Returned[] }).workarounds;
/** The ids of the workarounds that apply for sure. */
const idsFor = (pkg: object) => returnedFor(pkg).filter((w) => w.applies === 'yes').map((w) => w.id);
/** The ids of the workarounds that depend on the project's code. */
const maybeFor = (pkg: object) => returnedFor(pkg).filter((w) => w.applies !== 'yes').map((w) => w.id);

const viteReact = {
  type: 'module',
  dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0', 'froala-editor': '^5.5.0', 'react-froala-wysiwyg': '^5.5.0' },
  devDependencies: { vite: '^8.3.4', typescript: '~6.0.3' }
};

test('React with Vite 8 and Froala 5.5.0 gets the import fix; code-dependent ones are marked as such', () => {
  expect(idsFor(viteReact)).toContain('vite8-react-import');
  expect(maybeFor(viteReact)).toEqual(expect.arrayContaining(['react-typescript-model', 'react-strict-mode-events']));
  expect([...idsFor(viteReact), ...maybeFor(viteReact)]).not.toContain('nextjs-browser-only');
});

test('the wrapper version decides, not the core version', () => {
  const coreNewer = { ...viteReact, dependencies: { ...viteReact.dependencies, 'froala-editor': '^5.6.0', 'react-froala-wysiwyg': '5.5.0' } };
  expect(idsFor(coreNewer)).toContain('vite8-react-import');
  const wrapperNewer = { ...viteReact, dependencies: { ...viteReact.dependencies, 'froala-editor': '5.5.0', 'react-froala-wysiwyg': '^5.6.0' } };
  expect(idsFor(wrapperNewer)).not.toContain('vite8-react-import');
});

test('versions that package.json cannot pin down make a fix possible, not certain', () => {
  const tagged = { ...viteReact, dependencies: { ...viteReact.dependencies, 'react-froala-wysiwyg': 'latest' } };
  expect(maybeFor(tagged)).toContain('vite8-react-import');
});

test('a project without Froala yet is treated as the latest release', () => {
  const { dependencies, ...rest } = viteReact;
  expect(idsFor({ ...rest, dependencies: { react: '^19.3.0' } })).toContain('vite8-react-import');
});

test('a fixed Froala release or Vite 7 does not get the import fix', () => {
  expect(idsFor({ ...viteReact, dependencies: { ...viteReact.dependencies, 'react-froala-wysiwyg': '^5.6.0', 'froala-editor': '^5.6.0' } })).not.toContain(
    'vite8-react-import'
  );
  expect(idsFor({ ...viteReact, devDependencies: { vite: '^7.1.0' } })).not.toContain('vite8-react-import');
  expect(idsFor({ ...viteReact, type: undefined })).not.toContain('vite8-react-import');
});

test('Nuxt 4.5 and newer use Vite 8, so they get the Vue import fix', () => {
  expect(idsFor({ type: 'module', dependencies: { nuxt: '^4.6.1', 'vue-froala-wysiwyg': '^5.5.0' } })).toContain('vite8-vue-plugin');
  expect(idsFor({ type: 'module', dependencies: { nuxt: '^4.3.0', 'vue-froala-wysiwyg': '^5.5.0' } })).not.toContain('vite8-vue-plugin');
});

test('Next.js 16 gets browser-only loading', () => {
  const pkg = { dependencies: { next: '16.0.0', react: '^19.3.0', 'react-froala-wysiwyg': '^5.5.0' }, devDependencies: { typescript: '^6.0.0' } };
  expect(idsFor(pkg)).toContain('nextjs-browser-only');
  expect(maybeFor(pkg)).toContain('plugin-types');
  expect(idsFor(pkg)).not.toContain('vite8-react-import');
});

test('Angular 22 with server rendering gets the Angular fixes', () => {
  const pkg = { dependencies: { '@angular/core': '^22.2.2', '@angular/ssr': '^22.2.2', 'angular-froala-wysiwyg': '^5.5.0' } };
  expect(idsFor(pkg)).toEqual(expect.arrayContaining(['angular-standalone', 'angular-ssr']));
  expect(maybeFor(pkg)).toEqual(expect.arrayContaining(['angular-styles-path', 'angular-bundle-budget']));
});

test('lists every workaround when nothing is sent, and rejects broken input as an error', () => {
  expect(workarounds({}).content[0].text).toContain('vite8-react-import');
  expect(workarounds({ package_json: '{ nope' }).isError).toBe(true);
  expect(workarounds({ package_json: JSON.stringify({ dependencies: { react: 19 } }) }).isError).toBeUndefined();
});
