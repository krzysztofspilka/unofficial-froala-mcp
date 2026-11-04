import { describe, expect, test } from 'vitest';
import { audit, MAX_FINDINGS } from '../src/tools/audit.js';
import { MAX_RESPONSE_CHARS, MAX_STRUCTURED_CHARS } from '../src/util.js';

type Target = Parameters<typeof audit>[0]['target'];
type Result = { findings: { check: string; level: string; fix: string; message: string; file?: string; line?: number }[]; not_checked: string[]; findings_not_shown: number };

/** Runs froala_audit_code on several files. */
function run(files: Record<string, string>, target?: Target) {
  const result = audit({ files: Object.entries(files).map(([path, content]) => ({ path, content })), target });
  return { text: result.content[0].text, ...(result.structuredContent as Result) };
}
/** Runs froala_audit_code on one file and returns its findings. */
const findings = (code: string, path = 'main.js', target?: Target) => run({ [path]: code }, target).findings;
const checks = (code: string, path?: string, target?: Target) => findings(code, path, target).map((f) => f.check);
const find = (code: string, check: string, path?: string) => findings(code, path).find((f) => f.check === check);

const editor = (settings: string) => `import FroalaEditor from 'froala-editor';
import 'froala-editor/css/froala_editor.pkgd.min.css';
new FroalaEditor('#editor', ${settings});`;

const vite8 = JSON.stringify({ type: 'module', dependencies: { react: '^19.3.0', 'react-froala-wysiwyg': '5.5.0' }, devDependencies: { vite: '^8.3.4' } });
const vite7 = JSON.stringify({ type: 'module', dependencies: { react: '^19.1.0', 'react-froala-wysiwyg': '^5.5.0' }, devDependencies: { vite: '^7.1.0' } });

describe('which objects are Froala settings', () => {
  test('settings passed to new FroalaEditor, even with one wrong name', () => {
    const unknown = find(editor(`{ placeholder: 'Hello' }`), 'unknown-option');
    expect(unknown?.fix).toBe('Use placeholderText.');
    expect(unknown?.line).toBe(3);
  });

  test('a variable passed to the editor, a JSX config prop and an Angular binding', () => {
    expect(checks(`import F from 'froala-editor';\nconst options = { placeholder: 'x' };\nnew F('#e', options);`)).toContain('unknown-option');
    const react = `import FroalaEditorComponent from 'react-froala-wysiwyg';\nconst config = { placeholder: 'x' };\nexport default () => <FroalaEditorComponent config={config} />;`;
    expect(checks(react, 'Editor.jsx')).toContain('unknown-option');
    const angular = `import { Component } from '@angular/core';
@Component({ selector: 'x', templateUrl: './x.component.html' })
export class X { options = { placeholder: 'x' }; }`;
    expect(run({ 'x.component.ts': angular, 'x.component.html': '<div [froalaEditor]="options"></div>' }).findings.map((f) => f.check)).toContain('unknown-option');
  });

  test('Vue :config and a separate settings file named after Froala', () => {
    const vue = `<script setup>\nconst config = { placeholder: 'x' };\n</script>\n<template><froala :config="config" v-model:value="m" /></template>`;
    expect(checks(vue, 'Editor.vue')).toContain('unknown-option');
    expect(checks(`export const froalaConfig = { heightMin: 200, placeholder: 'x' };`, 'froala-config.ts')).toContain('unknown-option');
  });

  test('unrelated objects and JSON-LD are not Froala settings', () => {
    expect(run({ 'a.js': 'const size = { height: 20, width: 40, customerId: 123 };' }).text).toContain('No Froala code found');
    const html = `<script type="application/ld+json">{ "@context": "https://schema.org", "@type": "Organization" }</script>`;
    expect(checks(html, 'index.html')).toEqual([]);
  });

  test('settings from another file are listed as not checked', () => {
    const result = run({ 'Editor.jsx': `import F from 'react-froala-wysiwyg';\nimport { config } from './config';\nexport default () => <F config={config} />;` });
    expect(result.not_checked.join(' ')).toContain('come from config');
  });

  test('a script block that cannot be read is reported, not passed over', () => {
    const html = `<script>new FroalaEditor('#e', { heightMin: 200 });</script>\n<script>const = = ;</script>`;
    const result = run({ 'index.html': html });
    expect(result.not_checked.join(' ')).toContain('could not be read');
  });

  test('settings spread in from elsewhere are reported as not checked', () => {
    expect(run({ 'main.js': editor(`{ ...base, heightMin: 200 }`) }).not_checked.join(' ')).toContain('...base');
  });
});

describe('option, event and plugin names and values', () => {
  test('wrong values for known options', () => {
    const result = findings(editor(`{ key: 'k', imageUpload: 'false', toolbarButtons: 42, pluginsEnabled: ['notARealPlugin'] }`));
    expect(result.filter((f) => f.check === 'option-value').map((f) => f.message.split(' ')[0])).toEqual(['imageUpload', 'toolbarButtons']);
    expect(result.find((f) => f.message.startsWith('imageUpload'))?.fix).toBe('Write false without quotes.');
    expect(result.find((f) => f.check === 'unknown-plugin')?.message).toContain('notARealPlugin');
  });

  test('event names', () => {
    expect(find(editor(`{ events: { contentChange: function () {} } }`), 'unknown-event')?.fix).toBe('Use contentChanged.');
    expect(checks(editor(`{ events: { contentChanged: function () {}, 'image.inserted': function () {} } }`))).not.toContain('unknown-event');
  });

  test('toolbar button names and buttons registered with an imported alias', () => {
    expect(find(editor(`{ toolbarButtons: ['bolld'] }`), 'unknown-button')?.fix).toContain('Use bold.');
    const aliased = `import FE from 'froala-editor';\nFE.RegisterCommand('myButton', { title: 'Mine' });\nnew FE('#e', { toolbarButtons: ['myButton'] });`;
    expect(checks(aliased)).not.toContain('unknown-button');
  });

  test('wrapper settings in the wrong framework', () => {
    const react = `import F from 'react-froala-wysiwyg';\nexport default () => <F config={{ immediateVueModelUpdate: true }} />;`;
    expect(find(react, 'unknown-option', 'Editor.jsx')?.message).toContain('vue-froala-wysiwyg');
  });
});

describe('plugins, CSS and libraries', () => {
  test('a toolbar button whose plugin is not loaded', () => {
    const code = editor(`{ key: 'k', toolbarButtons: ['bold', 'alignLeft', 'insertTable'] }`).replace('new', "import 'froala-editor/js/plugins/align.min.js';\nnew");
    const missing = find(code, 'button-plugin-missing');
    expect(missing?.level).toBe('warning');
    expect(missing?.fix).toBe("import 'froala-editor/js/plugins/table.min.js';");
  });

  test('plugins.pkgd.min.js covers bundled plugins but not third-party ones', () => {
    const bundled = editor(`{ key: 'k', toolbarButtons: ['insertTable', 'embedly'] }`).replace('new', "import 'froala-editor/js/plugins.pkgd.min.js';\nnew");
    const result = findings(bundled).filter((f) => f.check === 'button-plugin-missing');
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('plugins.pkgd.min.js does not include it');
    expect(result[0].fix).toContain('third_party/embedly.min.js');
  });

  test('the CSS file of the same name does not count as plugins', () => {
    const cssOnly = editor(`{ key: 'k', toolbarButtons: ['insertTable'] }`).replace('new', "import 'froala-editor/js/plugins/align.min.js';\nnew");
    expect(checks(cssOnly)).toContain('button-plugin-missing');
  });

  test('two editors keep their own pluginsEnabled', () => {
    const code =
      editor(`{ key: 'k', pluginsEnabled: ['table'], toolbarButtons: ['insertTable'] }`).replace('new', "import 'froala-editor/js/plugins.pkgd.min.js';\nnew") +
      `\nnew FroalaEditor('#other', { key: 'k', pluginsEnabled: ['align'], toolbarButtons: ['alignLeft'] });`;
    expect(checks(code)).not.toContain('button-plugin-missing');
  });

  test('there is no advice to drop the plugins bundle', () => {
    const code = editor(`{ key: 'k', toolbarButtons: ['bold'], charCounterMax: 200 }`).replace('new', "import 'froala-editor/js/plugins.pkgd.min.js';\nnew");
    expect(checks(code)).not.toContain('all-plugins');
  });

  test('helper libraries need to be on window, and comments do not count', () => {
    const word = (extra: string) => editor(`{ key: 'k', toolbarButtons: ['import_from_word'] }`).replace('new', `import 'froala-editor/js/plugins/import_from_word.min.js';\n${extra}\nnew`);
    expect(checks(word('// TODO: install mammoth'))).toContain('plugin-library-missing');
    const withPackage = run({ 'main.js': word(''), 'package.json': JSON.stringify({ dependencies: { mammoth: '^1.11.0' } }) });
    expect(withPackage.findings.find((f) => f.check === 'plugin-library-missing')?.message).toContain('window.mammoth');
    expect(checks(word("import mammoth from 'mammoth';\nwindow.mammoth = mammoth;"))).not.toContain('plugin-library-missing');
  });

  test('the content stylesheet alone is not enough for an editor', () => {
    const code = `import FroalaEditor from 'froala-editor';\nimport 'froala-editor/css/froala_style.min.css';\nnew FroalaEditor('#e', { key: 'k' });`;
    expect(find(code, 'css-missing')?.message).toContain('froala_style.min.css, which only styles saved content');
  });

  test('a third-party plugin needs its own stylesheet', () => {
    const code = editor(`{ key: 'k' }`).replace('new', "import 'froala-editor/js/third_party/image_tui.min.js';\nnew");
    expect(find(code, 'plugin-css-missing')?.fix).toContain('third_party/image_tui.min.css');
  });

  test('CDN links: query strings and partial versions', () => {
    const html = (version: string) =>
      `<link href="https://cdn.jsdelivr.net/npm/froala-editor@${version}/css/froala_editor.pkgd.min.css?v=1" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/froala-editor@${version}/js/froala_editor.pkgd.min.js?v=1"></script>
<script>new FroalaEditor('#e', { key: 'k', toolbarButtons: ['insertTable'] });</script>`;
    expect(checks(html('5.5.0'), 'index.html')).toEqual([]);
    expect(checks(html('5.5'), 'index.html')).toEqual(['cdn-version']);
  });

  test('Font Awesome advice only where Froala is used', () => {
    expect(checks(`import '@fortawesome/fontawesome-free/css/all.css';`, 'main.js')).toEqual([]);
    expect(checks(editor(`{ key: 'k' }`).replace('new', "import 'font-awesome/css/font-awesome.css';\nnew"))).toContain('font-awesome');
  });
});

describe('frameworks and versions', () => {
  const component = `import FroalaEditorComponent from 'react-froala-wysiwyg';
import 'froala-editor/css/froala_editor.pkgd.min.css';
export default () => <FroalaEditorComponent tag="textarea" config={{ key: 'k' }} />;`;

  test('the wrapper import is an error with Vite 8 and Froala 5.5.0, and fine with Vite 7', () => {
    const found = run({ 'src/Editor.tsx': component, 'package.json': vite8 }).findings.find((f) => f.check === 'wrapper-import');
    expect(found).toMatchObject({ level: 'error', line: 1 });
    expect(run({ 'src/Editor.tsx': component, 'package.json': vite7 }).findings.map((f) => f.check)).not.toContain('wrapper-import');
    expect(findings(component, 'src/Editor.tsx').find((f) => f.check === 'wrapper-import')?.level).toBe('tip');
  });

  test('a version range package.json cannot read makes it a warning', () => {
    const latest = JSON.stringify({ type: 'module', dependencies: { 'react-froala-wysiwyg': 'latest' }, devDependencies: { vite: '^8.3.4' } });
    expect(run({ 'src/Editor.tsx': component, 'package.json': latest }).findings.find((f) => f.check === 'wrapper-import')?.level).toBe('warning');
  });

  test('code that takes the export from the module is fine', () => {
    const fixed = `import FroalaImport from 'react-froala-wysiwyg';\nconst FroalaEditorComponent = FroalaImport.default ?? FroalaImport;`;
    expect(run({ 'src/Editor.jsx': fixed, 'package.json': vite8 }).findings.map((f) => f.check)).not.toContain('wrapper-import');
  });

  test('core and wrapper versions must match', () => {
    const mismatch = JSON.stringify({ dependencies: { 'froala-editor': '^5.6.0', 'react-froala-wysiwyg': '5.5.0', react: '^19.0.0' } });
    expect(run({ 'src/Editor.jsx': component, 'package.json': mismatch }).findings.find((f) => f.check === 'version-mismatch')?.fix).toContain('--save-exact');
  });

  test('Next.js: Froala in a server component, and dynamic loading from another file', () => {
    const client = `'use client';\nimport FroalaEditorComponent from 'react-froala-wysiwyg';\nexport default function C() { return <FroalaEditorComponent />; }`;
    const loader = `'use client';\nimport dynamic from 'next/dynamic';\nexport default dynamic(() => import('./FroalaEditorClient'), { ssr: false });`;
    expect(run({ 'app/FroalaEditorClient.tsx': client, 'app/FroalaEditor.tsx': loader }).findings.map((f) => f.check)).not.toContain('client-only-loading');
    expect(findings(client, 'app/FroalaEditorClient.tsx').find((f) => f.check === 'client-only-loading')?.level).toBe('warning');
    // A dynamic import of another component does not count for the editor.
    const chart = `'use client';\nimport dynamic from 'next/dynamic';\nimport F from 'react-froala-wysiwyg';\nconst Chart = dynamic(() => import('./Chart'), { ssr: false });\nexport default () => <F />;`;
    expect(checks(chart, 'app/Editor.tsx')).toContain('client-only-loading');
    // ssr: false is not allowed in a Server Component.
    const server = `import dynamic from 'next/dynamic';\nconst E = dynamic(() => import('./FroalaEditorClient'), { ssr: false });\nexport default function Page() { return <E />; }`;
    expect(find(server, 'client-only-loading', 'app/page.tsx')?.level).toBe('error');
  });

  test('untyped onModelChange in TypeScript', () => {
    const code = `import F from 'react-froala-wysiwyg';\nexport default () => <F onModelChange={(m) => console.log(m)} />;`;
    expect(checks(code, 'src/Editor.tsx')).toContain('model-change-type');
    expect(checks(code.replace('(m)', '(m: string)'), 'src/Editor.tsx')).not.toContain('model-change-type');
  });

  test('Angular: forRoot() in a standalone component, and angular.json', () => {
    const code = `import { Component } from '@angular/core';
import { FroalaEditorModule } from 'angular-froala-wysiwyg';
@Component({ selector: 'x', imports: [FroalaEditorModule.forRoot()], template: '' })
export class X {}`;
    expect(checks(code, 'x.component.ts')).toContain('angular-forroot');
    const json = JSON.stringify({ projects: { app: { architect: { build: { options: { styles: ['styles.css'] } } } } } });
    expect(
      run({ 'angular.json': json })
        .findings.map((f) => f.check)
        .sort()
    ).toEqual(['angular-styles-path', 'css-missing']);
  });

  test('Vue: v-model instead of v-model:value', () => {
    expect(checks(`<template><froala tag="textarea" v-model="content" /></template>`, 'Editor.vue')).toContain('vue-v-model');
    expect(checks(`<template><froala tag="textarea" v-model:value="content" /></template>`, 'Editor.vue')).not.toContain('vue-v-model');
  });

  test('Nuxt: CSS in nuxt.config counts', () => {
    const nuxtConfig = `export default defineNuxtConfig({ css: ['froala-editor/css/froala_editor.pkgd.min.css'] });`;
    const plugin = `import VueFroala from 'vue-froala-wysiwyg';\nimport 'froala-editor/js/plugins/align.min.js';\nexport default defineNuxtPlugin((app) => app.vueApp.use(VueFroala));`;
    const page = `<template><ClientOnly><froala tag="textarea" :config="{ key: 'k', placeholderText: 'Hi' }" v-model:value="m" /></ClientOnly></template>`;
    expect(run({ 'nuxt.config.ts': nuxtConfig, 'app/plugins/froala.client.ts': plugin, 'app/pages/index.vue': page }).findings.map((f) => f.check)).not.toContain('css-missing');
  });

  test('CSS files are read for their imports, not reported as unreadable', () => {
    const result = run({
      'src/Editor.tsx': component.replace("import 'froala-editor/css/froala_editor.pkgd.min.css';\n", ''),
      'src/app.css': "@import 'froala-editor/css/froala_editor.pkgd.min.css';"
    });
    expect(result.findings.map((f) => f.check)).not.toContain('css-missing');
    expect(result.not_checked).toEqual([]);
  });
});

describe('event handlers', () => {
  test('a parameter used as the editor, and an arrow function using editor members', () => {
    const code = editor(`{ events: { focus: function (e, editor) { editor.selection.get(); }, blur: () => this.html.get() } }`);
    expect(findings(code).filter((f) => f.check === 'event-handler-this')).toHaveLength(2);
  });

  test('an arrow function that means its own class is left alone', () => {
    expect(checks(editor(`{ events: { contentChanged: () => this.save() } }`))).not.toContain('event-handler-this');
    expect(checks(editor(`{ events: { focus: function (e, editor) { console.log(editor); } } }`))).not.toContain('event-handler-this');
  });
});

describe('other checks and limits', () => {
  test('an Azure storage key in browser code', () => {
    expect(find(editor(`{ key: 'k', imageUploadToAzure: { account: 'a', container: 'c', accessKey: 'secret' } }`), 'azure-access-key')?.level).toBe('error');
  });

  test('outdated libraries from the docs', () => {
    const html = `<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.4.21/mammoth.browser.min.js"></script>`;
    expect(find(html, 'outdated-library', 'index.html')?.message).toContain('GHSA-rmjr-87wv-gf87');
  });

  test('a missing licence key is a tip', () => {
    expect(find(editor(`{ heightMin: 200 }`), 'licence-key')?.level).toBe('tip');
  });

  test('a clean result says what was checked', () => {
    const text = run({ 'main.js': editor(`{ key: 'k', heightMin: 200 }`) }).text;
    expect(text).toContain('No findings in the code checked.');
    expect(text).toContain('Build and run the app');
  });

  test('many findings are capped in both the text and the data', () => {
    const settings = `{ ${Array.from({ length: 2200 }, (_, i) => `unknownOption${i}: ${i}`).join(', ')} }`;
    const result = audit({ files: [{ path: 'main.js', content: editor(settings) }] });
    const data = result.structuredContent as Result;
    expect(data.findings.length).toBe(MAX_FINDINGS);
    expect(data.findings_not_shown).toBeGreaterThan(2000);
    expect(JSON.stringify(data).length).toBeLessThan(MAX_STRUCTURED_CHARS);
  });
});

describe('names follow JavaScript scope', () => {
  const editorFile = `import FroalaEditor from 'froala-editor';
import 'froala-editor/css/froala_editor.pkgd.min.css';

function start() {
  const config = { key: 'k', imageUploadToAzure: { accessKey: 'secret' } };
  new FroalaEditor('#e', config);
}
`;
  const unrelated = `
function other() {
  const config = { key: 'demo' };
  return config;
}
`;

  test('an unrelated function never changes the findings of the original editor', () => {
    const alone = checks(editorFile);
    expect(alone).toContain('azure-access-key');
    expect(checks(editorFile + unrelated)).toEqual(alone);
    const imports = editorFile.slice(0, editorFile.indexOf('function start'));
    expect(checks(imports + unrelated + editorFile.slice(imports.length))).toEqual(alone);
  });

  test('a variable shadowed in a block', () => {
    const code = `import FroalaEditor from 'froala-editor';
import 'froala-editor/css/froala_editor.pkgd.min.css';
const config = { key: 'k', placeholder: 'outer' };
if (window.x) {
  const config = { key: 'k' };
  console.log(config);
}
new FroalaEditor('#e', config);`;
    expect(checks(code)).toContain('unknown-option');
  });

  test('two classes with the same property name', () => {
    const code = `import { Component } from '@angular/core';
@Component({ selector: 'a-a', template: '<div [froalaEditor]="options"></div>' })
export class A { options = { key: 'k', placeholder: 'x' }; }
export class B { options = { width: 3 }; }`;
    expect(checks(code, 'a.component.ts')).toContain('unknown-option');
    const reversed = `import { Component } from '@angular/core';
export class B { options = { width: 3 }; }
@Component({ selector: 'a-a', template: '<div [froalaEditor]="options"></div>' })
export class A { options = { key: 'k', placeholder: 'x' }; }`;
    expect(checks(reversed, 'a.component.ts')).toContain('unknown-option');
  });

  test('a name with two possible values is reported as not checked', () => {
    const code = `import FroalaEditor from 'froala-editor';
import 'froala-editor/css/froala_editor.pkgd.min.css';
var config = { key: 'a' };
var config = { key: 'b', placeholder: 'x' };
new FroalaEditor('#e', config);`;
    const result = run({ 'main.js': code });
    expect(result.not_checked.join(' ')).toContain('more than one possible value');
  });

  test('a function parameter is not the outer variable of the same name', () => {
    const code = `import FroalaEditor from 'froala-editor';
import 'froala-editor/css/froala_editor.pkgd.min.css';
const config = { key: 'k', placeholder: 'x' };
function start(config) { new FroalaEditor('#e', config); }`;
    expect(run({ 'main.js': code }).not_checked.join(' ')).toContain('config');
  });
});

describe('server rendering follows real modules', () => {
  const nextProject = JSON.stringify({ dependencies: { next: '16.4.5', react: '^19.3.1' } });
  const editor = `'use client';\nimport FroalaEditorComponent from 'react-froala-wysiwyg';\nimport 'froala-editor/css/froala_editor.pkgd.min.css';\nexport default () => <FroalaEditorComponent config={{ key: 'k' }} />;`;
  const loader = (path: string) => `'use client';\nimport dynamic from 'next/dynamic';\nexport default dynamic(() => import('${path}'), { ssr: false });`;
  const ssr = (files: Record<string, string>) => run({ ...files, 'package.json': nextProject }).findings.filter((f) => f.check === 'client-only-loading');

  test('a loader in another folder does not protect a file with the same name', () => {
    expect(ssr({ 'app/a/Editor.tsx': editor })).toHaveLength(1);
    expect(ssr({ 'app/a/Editor.tsx': editor, 'app/b/Loader.tsx': loader('./Editor') })).toHaveLength(1);
  });

  test('a loader that points at the real file protects it', () => {
    expect(ssr({ 'app/a/Editor.tsx': editor, 'app/a/Loader.tsx': loader('./Editor') })).toHaveLength(0);
    expect(ssr({ 'app/a/Editor.tsx': editor, 'app/b/Loader.tsx': loader('../a/Editor') })).toHaveLength(0);
  });

  test('an alias cannot be followed, so it never counts as proof', () => {
    expect(ssr({ 'app/a/Editor.tsx': editor, 'app/b/Loader.tsx': loader('@/a/Editor') })).toHaveLength(1);
  });

  test('a server page that imports the protected file brings the warning back', () => {
    const files = { 'app/a/Editor.tsx': editor, 'app/a/Loader.tsx': loader('./Editor'), 'app/page.tsx': `import Editor from './a/Editor';\nexport default () => <Editor />;` };
    expect(ssr(files)).toHaveLength(1);
  });

  test('an import above the root of the files sent never counts as proof', () => {
    expect(ssr({ 'shared/Editor.tsx': editor, 'pages/Loader.tsx': loader('../../shared/Editor') })).toHaveLength(1);
  });

  test('a re-export is followed like an import', () => {
    const files = { 'app/ed/Editor.tsx': editor, 'app/ed/index.ts': `export { default } from './Editor';`, 'app/Loader.tsx': loader('./ed') };
    expect(ssr(files)).toHaveLength(0);
  });

  test('a file imported only by a protected file is protected too', () => {
    const files = {
      'app/f/Client.tsx': `'use client';\nimport FroalaEditorComponent from 'react-froala-wysiwyg';\nimport { froalaConfig } from './preset';\nexport default () => <FroalaEditorComponent config={froalaConfig} />;`,
      'app/f/preset.ts': `import 'froala-editor/js/plugins/link.min.js';\nexport const froalaConfig = { key: 'k', heightMin: 200 };`,
      'app/f/Editor.tsx': loader('./Client')
    };
    expect(ssr(files)).toHaveLength(0);
  });
});

describe('unexpected input', () => {
  test('angular.json with the wrong shape is a diagnostic, not an exception', () => {
    for (const content of ['null', '[]', '"x"', '{"projects":null}', '{"projects":{"a":{"architect":{"build":{"options":{"styles":{}}}}}}}']) {
      expect(() => run({ 'angular.json': content })).not.toThrow();
    }
    expect(run({ 'angular.json': 'null' }).findings[0].check).toBe('parse-error');
  });
});

describe('review findings', () => {
  const start = `import FroalaEditor from 'froala-editor';\nimport 'froala-editor/css/froala_editor.pkgd.min.css';\n`;

  test('a variable that is assigned again is reported, not guessed', () => {
    const code = `${start}let options = { key: 'k' };\noptions = { key: 'k', toolbarButtons: ['zzz'] };\nnew FroalaEditor('#e', options);`;
    const result = run({ 'main.js': code });
    expect(result.not_checked.join(' ')).toContain('more than one possible value');
    expect(result.findings.map((f) => f.check)).not.toContain('unknown-button');
  });

  test('a class property that is assigned again is reported', () => {
    const code = `import { Component } from '@angular/core';
@Component({ selector: 'a-a', template: '<div [froalaEditor]="options"></div>' })
export class A { options = {}; ngOnInit() { this.options = { placeholder: 'x' }; } }`;
    expect(run({ 'a.component.ts': code }).not_checked.join(' ')).toContain('more than one possible value');
  });

  test('a local froala variable that no editor uses is ignored', () => {
    const code = `${start}new FroalaEditor('#e', { key: 'k' });\nfunction other() { const froalaOptions = { toolbarButtons: ['zzz'] }; return froalaOptions; }`;
    expect(checks(code)).not.toContain('unknown-button');
  });

  test('an Angular template file applies only to its own component', () => {
    const code = `import { Component } from '@angular/core';
@Component({ selector: 'a-a', templateUrl: './a.html' })
export class A { options = { key: 'k' }; }
@Component({ selector: 'b-b', template: '<canvas></canvas>' })
export class B { options = { chart: 'pie' }; }`;
    expect(run({ 'x.ts': code, 'a.html': '<div [froalaEditor]="options"></div>' }).findings.map((f) => f.check)).not.toContain('unknown-option');
  });

  test('methods and getters in settings do not stop the audit', () => {
    expect(() => run({ 'main.js': `${start}new FroalaEditor('#e', { key: 'k', toolbarButtons() { return ['bold']; }, get toolbarButtonsXS() { return []; } });` })).not.toThrow();
  });

  test('very deep code is listed as not read, and the other files keep their results', () => {
    const deep = `const x = a${'.b'.repeat(20000)};`;
    const result = run({ 'deep.js': deep, 'main.js': `${start}new FroalaEditor('#e', { key: 'k', placeholder: 'x' });` });
    expect(result.not_checked.join(' ')).toContain('deep.js');
    expect(result.findings.map((f) => f.check)).toContain('unknown-option');
  });

  test('a TypeScript cast on window counts as an assignment', () => {
    const code = `${start}import mammoth from 'mammoth';\n(window as any).mammoth = mammoth;\nimport 'froala-editor/js/plugins/import_from_word.min.js';\nnew FroalaEditor('#e', { key: 'k', toolbarButtons: ['import_from_word'] });`;
    expect(checks(code, 'main.ts')).not.toContain('plugin-library-missing');
  });

  test('other JSON files are not Froala settings', () => {
    expect(run({ 'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["src"] }' }).findings).toEqual([]);
  });

  test('inline settings in Svelte and single-quoted Vue attributes are read', () => {
    expect(checks(`<script>\nimport FroalaEditorComponent from 'svelte-froala-wysiwyg';\n</script>\n<FroalaEditorComponent config={{ placeholder: 'Hi' }} />`, 'E.svelte')).toContain('unknown-option');
    expect(checks(`<template><froala :config='{ placeholder: "Hi" }' /></template>`, 'E.vue')).toContain('unknown-option');
  });

  test('settings in markup report their real line', () => {
    const file = `<template>\n\n\n<froala :config="{ placeholder: 'Hi' }" />\n</template>`;
    expect(findings(file, 'E.vue').find((f) => f.check === 'unknown-option')?.line).toBe(4);
  });

  test('events with a popup name and extension names are known', () => {
    expect(checks(editor(`{ key: 'k', events: { 'popups.show.link.edit': function () {}, 'markdown.set': function () {} } }`))).not.toContain('unknown-event');
    expect(checks(editor(`{ key: 'k', toolbarButtons: ['mergeField'], variables: [] }`))).not.toContain('unknown-button');
    expect(checks(editor(`{ key: 'k', variables: [], autofocus: true, editInPopup: true }`))).not.toContain('unknown-option');
  });

  test('a button registered in another file is valid', () => {
    const result = run({ 'buttons.js': `import FroalaEditor from 'froala-editor';\nFroalaEditor.RegisterCommand('myButton', {});`, 'main.js': editor(`{ key: 'k', toolbarButtons: ['myButton'] }`) });
    expect(result.findings.map((f) => f.check)).not.toContain('unknown-button');
  });

  test('an option default is always accepted', () => {
    expect(checks(editor(`{ key: 'k', imageUploadToS3: false }`))).not.toContain('option-value');
  });

  test('overlapping version ranges are not a mismatch', () => {
    const pkg = (core: string, wrapper: string) => JSON.stringify({ dependencies: { react: '^19.0.0', 'froala-editor': core, 'react-froala-wysiwyg': wrapper } });
    const mismatch = (core: string, wrapper: string) => run({ 'package.json': pkg(core, wrapper), 'main.js': editor(`{ key: 'k' }`) }).findings.some((f) => f.check === 'version-mismatch');
    expect(mismatch('^5.4.0', '^5.5.0')).toBe(false);
    expect(mismatch('5.5.0', '5.6.0')).toBe(true);
  });

  test('a library project in angular.json does not hide or fake missing CSS', () => {
    const json = JSON.stringify({
      projects: { app: { architect: { build: { options: { styles: ['node_modules/froala-editor/css/froala_editor.pkgd.min.css'] } } } }, lib: { projectType: 'library' } }
    });
    expect(run({ 'angular.json': json }).findings.map((f) => f.check)).not.toContain('css-missing');
    const targets = JSON.stringify({ projects: { app: { targets: { build: { options: { styles: ['node_modules/froala-editor/css/froala_editor.pkgd.min.css'] } } } } } });
    expect(run({ 'angular.json': targets }).findings.map((f) => f.check)).not.toContain('css-missing');
  });

  test('package.json alone keeps every issue that depends on code', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^19.3.1', 'froala-editor': '5.6.0' } });
    const inFiles = audit({ files: [{ path: 'package.json', content: pkg }], limit: 50 }).structuredContent as { issues_to_check: unknown[] };
    const asInput = audit({ package_json: pkg, limit: 50 }).structuredContent as { issues_to_check: unknown[] };
    expect(inFiles.issues_to_check.length).toBe(asInput.issues_to_check.length);
  });

  test('audit answers keep the list of possible issues and the paging line', () => {
    const settings = `{ key: 'k', ${Array.from({ length: 70 }, (_, i) => `unknownOption${i}: ${i}`).join(', ')} }`;
    const pkg = JSON.stringify({ type: 'module', dependencies: { react: '^19.3.1', 'react-froala-wysiwyg': '5.5.0', 'froala-editor': '5.5.0' }, devDependencies: { vite: '^8.3.5' } });
    const text = audit({
      files: [
        { path: 'main.js', content: editor(settings) },
        { path: 'package.json', content: pkg }
      ]
    }).content[0].text;
    expect(text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(text).not.toContain('longer than');
    expect(text).toContain('These may apply');
  });
});

describe('licence keys', () => {
  const settings = (key: string) => `import FroalaEditor from 'froala-editor';\nimport 'froala-editor/css/froala_editor.pkgd.min.css';\nnew FroalaEditor('#e', { ${key} heightMin: 200 });`;
  const trial = 'TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE';

  test('a missing key gets the trial key as a tip', () => {
    expect(find(settings(''), 'licence-key')?.fix).toContain(trial);
  });

  test('the trial key gets a reminder for production', () => {
    expect(find(settings(`key: '${trial}',`), 'trial-key')?.level).toBe('tip');
  });

  test('a key set in a way the audit cannot read is left alone', () => {
    const start = `import FroalaEditor from 'froala-editor';\nimport 'froala-editor/css/froala_editor.pkgd.min.css';\n`;
    for (const code of [
      `${start}FroalaEditor.DEFAULTS.key = 'ABC';\nnew FroalaEditor('#e', { heightMin: 200 });`,
      `${start}const c = { heightMin: 200 };\nc.key = process.env.KEY;\nnew FroalaEditor('#e', c);`,
      `${start}import { base } from './base';\nnew FroalaEditor('#e', { ...base, heightMin: 200 });`
    ]) {
      expect(run({ 'main.js': code }).text).not.toContain(trial);
    }
  });

  test('a project on Froala 5.5.0 is not told the 5.6.0 behaviour', () => {
    const pkg = JSON.stringify({ dependencies: { 'froala-editor': '5.5.0' } });
    const result = run({ 'main.js': settings(''), 'package.json': pkg });
    expect(result.findings.map((f) => f.check)).not.toContain('licence-key');
    expect(result.text).not.toContain('every feature still works');
  });

  test('a key the project sets is never questioned, so a commercial key stays', () => {
    const result = run({ 'main.js': settings("key: 'AB1-commercial-key-from-2019',") });
    expect(result.findings.map((f) => f.check)).not.toContain('licence-key');
    expect(result.findings.map((f) => f.check)).not.toContain('trial-key');
    expect(result.text).not.toContain(trial);
  });
});

describe('known issues in the audit', () => {
  const project = JSON.stringify({ type: 'module', dependencies: { react: '^19.3.1', 'react-froala-wysiwyg': '5.5.0', 'froala-editor': '5.5.0' }, devDependencies: { vite: '^8.3.5' } });
  const ids = (files: Record<string, string>) =>
    (audit({ files: Object.entries(files).map(([path, content]) => ({ path, content })), limit: 50 }).structuredContent as { issues: { id: string }[] }).issues.map((i) => i.id);

  test('the enhancements file removes the issues it covers', () => {
    const plain = `import FroalaEditor from 'froala-editor';\nnew FroalaEditor('#e', { key: 'k' });`;
    expect(ids({ 'main.js': plain, 'package.json': project })).toContain('pasted-html-handlers');
    const enhanced = `${plain}\nimport { installFroalaEnhancements } from './froala-enhancements';\ninstallFroalaEnhancements(FroalaEditor);`;
    expect(ids({ 'main.js': enhanced, 'package.json': project })).not.toContain('pasted-html-handlers');
    const skipped = `${plain}\ninstallFroalaEnhancements(FroalaEditor, { skip: ['safePaste'] });`;
    expect(ids({ 'main.js': skipped, 'package.json': project })).toContain('pasted-html-handlers');
  });

  test('code decides which feature issues apply', () => {
    const code = `import FroalaEditor from 'froala-editor';\nconst e = new FroalaEditor('#e', { key: 'k' });\ne.markdown.setMarkdown('# Hi');`;
    expect(ids({ 'main.js': code, 'package.json': project })).toContain('markdown-set-markdown');
    expect(ids({ 'main.js': code.replace('setMarkdown', 'getText'), 'package.json': project })).not.toContain('markdown-set-markdown');
  });

  test('a symptom finds issues and an id reads one', () => {
    const found = audit({ symptom: 'blank page', target: 'react' }).structuredContent as { issues: { id: string }[] };
    expect(found.issues[0].id).toBe('vite8-react-import');
    expect(audit({ issue: 'pasted-html-handlers' }).content[0].text).toContain('safePaste');
    expect(audit({ issue: 'pasted-html' }).isError).toBe(true);
    expect(audit({ issue: 'pasted-html' }).content[0].text).toContain('pasted-html-handlers');
  });
});
