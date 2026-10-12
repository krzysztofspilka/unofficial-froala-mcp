// Setup code for each framework. The code follows the project's versions: for example, with
// Froala 5.5.0 and Vite 8 the React and Vue wrappers need a different import (see project.ts).
import semver from 'semver';
import { FROALA_VERSION } from '../data.js';
import { usesAngularSsr, wrapperImportBug, type Framework, type Project } from '../project.js';
import {
  base,
  cssImports,
  editorConfig,
  installCommand,
  pluginFiles,
  pluginImports,
  pluginNote,
  wrapperImport,
  tailwindFix,
  COMMON_NOTES,
  KEY_NOTE,
  PIN_NOTE,
  type Setup,
  type TemplateOptions
} from './shared.js';

const DOCS = 'https://froala.com/wysiwyg-editor/docs/framework-plugins/';
const START = '<p>Start writing here.</p>';
const IMPORT_NOTE = (wrapper: string) =>
  `The ${wrapper} import is written for Froala ${FROALA_VERSION} with Vite 8, where the usual default import shows a blank page. It also works with other versions.`;

/** Where the licence key comes from: Vite, Create React App and Vue CLI expose environment variables differently. */
function keyFrom(project: Project, framework: 'react' | 'vue'): { expression: string; where: string } {
  if (!project.fromPackageJson || project.has('vite')) return { expression: 'import.meta.env.VITE_FROALA_KEY', where: '.env as VITE_FROALA_KEY' };
  if (framework === 'react' && project.has('react-scripts')) return { expression: 'process.env.REACT_APP_FROALA_KEY', where: '.env as REACT_APP_FROALA_KEY' };
  if (framework === 'vue' && project.has('@vue/cli-service')) return { expression: 'process.env.VUE_APP_FROALA_KEY', where: '.env as VUE_APP_FROALA_KEY' };
  return { expression: "''", where: 'the key setting (read it from your environment variables)' };
}

/** The wrapper import fix is used when it's needed, and also when package.json can't tell (it works everywhere). */
const needsImportFix = (project: Project, wrapper: 'react-froala-wysiwyg' | 'vue-froala-wysiwyg') => wrapperImportBug(project, wrapper) !== 'no';

function react({ typescript, plugins, project }: TemplateOptions): Setup {
  const ext = typescript ? 'tsx' : 'jsx';
  const importBug = needsImportFix(project, 'react-froala-wysiwyg');
  const wrapper = wrapperImport('FroalaEditorComponent', 'react-froala-wysiwyg', { typescript, importBug, typed: true });
  const key = keyFrom(project, 'react');
  const tailwind = tailwindFix(project, 'src/components/');
  return {
    ...base('react', installCommand('react-froala-wysiwyg'), `${DOCS}react/`),
    files: [
      {
        path: `src/components/FroalaEditor.${ext}`,
        content: `import { useState } from 'react';
${wrapper.importLine}
${cssImports()}
${tailwind.importLine}${pluginImports(plugins)}
${wrapper.fixLines}
const config = ${editorConfig(key.expression, plugins)};

export default function FroalaEditor() {
  const [model, setModel] = useState('${START}');

  return (
    <FroalaEditorComponent
      tag="textarea"
      config={config}
      model={model}
      onModelChange={(value${typescript ? ': string' : ''}) => setModel(value)}
    />
  );
}
`
      },
      ...(tailwind.file ? [tailwind.file] : [])
    ],
    notes: [
      `Render <FroalaEditor /> wherever you want the editor, for example in src/App.${ext}.`,
      importBug && IMPORT_NOTE('react-froala-wysiwyg'),
      PIN_NOTE('react-froala-wysiwyg'),
      KEY_NOTE(key.where),
      pluginNote(plugins),
      ...COMMON_NOTES
    ].filter((n): n is string => !!n)
  };
}

function vue({ typescript, plugins, project }: TemplateOptions): Setup {
  const ext = typescript ? 'ts' : 'js';
  const importBug = needsImportFix(project, 'vue-froala-wysiwyg');
  const wrapper = wrapperImport('VueFroala', 'vue-froala-wysiwyg', { typescript, importBug, typed: false });
  const key = keyFrom(project, 'vue');
  const files = [
    {
      path: `src/main.${ext}`,
      content: `import { createApp } from 'vue';
${wrapper.importLine}
${cssImports()}
${pluginImports(plugins)}
import App from './App.vue';
${wrapper.fixLines}
createApp(App).use(VueFroala).mount('#app');
`
    },
    {
      path: 'src/components/FroalaEditor.vue',
      content: `<script setup${typescript ? ' lang="ts"' : ''}>
import { ref } from 'vue';

const model = ref('${START}');

const config = ${editorConfig(key.expression, plugins)};
</script>

<template>
  <froala tag="textarea" :config="config" v-model:value="model" />
</template>
`
    }
  ];
  // The Vue wrapper ships without type declarations.
  if (typescript) files.push({ path: 'src/froala.d.ts', content: "declare module 'vue-froala-wysiwyg';\n" });
  return {
    ...base('vue', installCommand('vue-froala-wysiwyg'), `${DOCS}vue-js-3/`),
    files,
    notes: [
      `src/main.${ext} shows the lines to add. Keep the imports your project already has, such as its own CSS.`,
      'The wrapper registers a <froala> component. Use <FroalaEditor /> from src/components/FroalaEditor.vue where you want the editor.',
      importBug && IMPORT_NOTE('vue-froala-wysiwyg'),
      PIN_NOTE('vue-froala-wysiwyg'),
      KEY_NOTE(key.where),
      pluginNote(plugins),
      ...COMMON_NOTES
    ].filter((n): n is string => !!n)
  };
}

function angular({ plugins, project }: TemplateOptions): Setup {
  const ssr = usesAngularSsr(project);
  // The plugins load after the page starts, in the browser only. That keeps Froala out of the initial
  // bundle (Angular's default budget is 1 MB) and out of server rendering.
  const component = `import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FroalaEditorModule, FroalaViewModule } from 'angular-froala-wysiwyg';

@Component({
  selector: 'app-editor',
  imports: [FroalaEditorModule, FroalaViewModule],
  template: \`
    @if (ready()) {
      <div [froalaEditor]="options" [(froalaModel)]="content"></div>
    }
  \`
})
export class EditorComponent {
  ready = signal(false);
  content = '${START}';

  options = ${editorConfig("''", plugins, 1)};

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      Promise.all([
${pluginFiles(plugins)
  .map((f) => `        import('${f}')`)
  .join(',\n')}
      ]).then(() => this.ready.set(true));
    }
  }
}
`;
  return {
    ...base('angular', installCommand('angular-froala-wysiwyg'), `${DOCS}angular/`),
    files: [
      { path: 'src/app/editor/editor.component.ts', content: component },
      // Froala's plugin files ship without types, which import() needs.
      { path: 'src/froala-plugins.d.ts', content: "declare module 'froala-editor/js/plugins/*';\ndeclare module 'froala-editor/js/plugins.pkgd.min.js';\n" }
    ],
    notes: [
      'In angular.json, add the editor CSS to projects > (your app) > architect > build > options > styles, after your own styles file: "node_modules/froala-editor/css/froala_editor.pkgd.min.css" and "node_modules/froala-editor/css/froala_style.min.css". Keep the path of your own file as it is, usually "src/styles.css".',
      'Add "allowedCommonJsDependencies": ["froala-editor"] to the same build options. Froala ships CommonJS, and without this ng build prints warnings about it.',
      'Add EditorComponent to the imports of the component that shows the editor, then use <app-editor />. Standalone components list FroalaEditorModule and FroalaViewModule directly, without forRoot().',
      'The component loads the plugins in the browser after the page starts. That keeps the initial bundle under the default 1 MB budget' + (ssr ? ' and keeps Froala out of server rendering.' : ', and works with server rendering too.'),
      PIN_NOTE('angular-froala-wysiwyg'),
      KEY_NOTE('options.key'),
      pluginNote(plugins),
      ...COMMON_NOTES
    ]
  };
}

function nextjs({ typescript, plugins, project }: TemplateOptions): Setup {
  const ext = typescript ? 'tsx' : 'jsx';
  const tailwind = tailwindFix(project, 'app/components/');
  return {
    ...base('nextjs', installCommand('react-froala-wysiwyg'), `${DOCS}react/`),
    files: [
      {
        path: `app/components/FroalaEditorClient.${ext}`,
        content: `'use client';

import { useState } from 'react';
import FroalaEditorComponent from 'react-froala-wysiwyg';
${cssImports()}
${tailwind.importLine}${pluginImports(plugins)}

const config = ${editorConfig('process.env.NEXT_PUBLIC_FROALA_KEY', plugins)};

export default function FroalaEditorClient() {
  const [model, setModel] = useState('${START}');

  return (
    <FroalaEditorComponent
      tag="textarea"
      config={config}
      model={model}
      onModelChange={(value${typescript ? ': string' : ''}) => setModel(value)}
    />
  );
}
`
      },
      {
        path: `app/components/FroalaEditor.${ext}`,
        content: `'use client';

import dynamic from 'next/dynamic';

// Froala runs in the browser only, so load it without server-side rendering.
const FroalaEditor = dynamic(() => import('./FroalaEditorClient'), { ssr: false });

export default FroalaEditor;
`
      },
      ...(tailwind.file ? [tailwind.file] : [])
    ],
    notes: [
      'Use <FroalaEditor /> from app/components/FroalaEditor in any page or component. If your app keeps its code in src/, put both files in src/app/components/.',
      'Import FroalaEditor, not FroalaEditorClient. FroalaEditor loads the editor in the browser only, which keeps next build working.',
      'With the Pages Router, put both files in components/ and import FroalaEditor in a page; next/dynamic with ssr: false works the same way.',
      tailwind.file && "froala-content.css brings back list bullets, heading sizes and margins inside the editor, which Tailwind's preflight removes.",
      PIN_NOTE('react-froala-wysiwyg'),
      KEY_NOTE('.env.local as NEXT_PUBLIC_FROALA_KEY'),
      pluginNote(plugins),
      ...COMMON_NOTES
    ].filter((n): n is string => !!n)
  };
}

function nuxt({ typescript, plugins, project }: TemplateOptions): Setup {
  const ext = typescript ? 'ts' : 'js';
  const importBug = needsImportFix(project, 'vue-froala-wysiwyg');
  const wrapper = wrapperImport('VueFroala', 'vue-froala-wysiwyg', { typescript, importBug, typed: false });
  // Nuxt 4 keeps the app in app/; Nuxt 3 keeps plugins and components at the top level.
  const nuxtVersion = project.version('nuxt');
  const dir = nuxtVersion && semver.major(nuxtVersion) < 4 ? '' : 'app/';
  const files = [
    {
      path: `${dir}plugins/froala.client.${ext}`,
      content: `${wrapper.importLine}
${cssImports()}
${pluginImports(plugins)}
${wrapper.fixLines}
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VueFroala);
});
`
    },
    {
      path: `${dir}components/FroalaEditor.vue`,
      content: `<script setup${typescript ? ' lang="ts"' : ''}>
const model = ref('${START}');
const runtimeConfig = useRuntimeConfig();

const config = ${editorConfig('runtimeConfig.public.froalaKey', plugins)};
</script>

<template>
  <ClientOnly>
    <froala tag="textarea" :config="config" v-model:value="model" />
  </ClientOnly>
</template>
`
    }
  ];
  // The Vue wrapper ships without type declarations.
  if (typescript) files.push({ path: `${dir || 'types/'}froala.d.ts`, content: "declare module 'vue-froala-wysiwyg';\n" });
  return {
    ...base('nuxt', installCommand('vue-froala-wysiwyg'), `${DOCS}vue-js-3/`),
    files,
    notes: [
      `Use <FroalaEditor /> in any page or in ${dir}app.vue.`,
      "In nuxt.config, add runtimeConfig: { public: { froalaKey: '' } } so the key can come from NUXT_PUBLIC_FROALA_KEY.",
      'The plugin file ends in .client so it runs only in the browser, and <ClientOnly> keeps the editor out of server rendering.',
      importBug && IMPORT_NOTE('vue-froala-wysiwyg'),
      PIN_NOTE('vue-froala-wysiwyg'),
      KEY_NOTE('.env as NUXT_PUBLIC_FROALA_KEY'),
      pluginNote(plugins),
      ...COMMON_NOTES
    ].filter((n): n is string => !!n)
  };
}

function svelte({ typescript, plugins, project }: TemplateOptions): Setup {
  const files = [
    {
      path: 'src/lib/Editor.svelte',
      content: `<script${typescript ? ' lang="ts"' : ''}>
  import FroalaEditor from 'svelte-froala-wysiwyg';
${cssImports().replace(/^/gm, '  ')}
${pluginImports(plugins).replace(/^/gm, '  ')}

  let model = $state('${START}');

  const config = ${editorConfig('import.meta.env.VITE_FROALA_KEY', plugins, 1)};
</script>

<FroalaEditor bind:model {config} />
`
    }
  ];
  // The Svelte wrapper ships without type declarations.
  if (typescript) files.push({ path: 'src/froala.d.ts', content: "declare module 'svelte-froala-wysiwyg';\n" });
  const kit = project.has('@sveltejs/kit');
  // SvelteKit 3 renamed the $lib alias to #lib.
  const kitVersion = project.version('@sveltejs/kit');
  const lib = kitVersion && semver.major(kitVersion) >= 3 ? '#lib' : '$lib';
  return {
    ...base('svelte', installCommand('svelte-froala-wysiwyg'), 'https://www.npmjs.com/package/svelte-froala-wysiwyg'),
    files,
    notes: [
      kit
        ? `Use <Editor /> where you want the editor: import Editor from '${lib}/Editor.svelte';. The wrapper needs Svelte 5.`
        : 'Use <Editor /> from src/lib/Editor.svelte where you want the editor. The wrapper needs Svelte 5.',
      kit &&
        "SvelteKit also renders pages on the server, and Froala needs the browser. In the +page.ts (or +layout.ts) of the route that shows the editor, add export const ssr = false;",
      KEY_NOTE('.env as VITE_FROALA_KEY'),
      pluginNote(plugins),
      ...COMMON_NOTES
    ].filter((n): n is string => !!n)
  };
}

function vanilla({ typescript, plugins }: TemplateOptions): Setup {
  const ext = typescript ? 'ts' : 'js';
  return {
    ...base('vanilla', installCommand(), 'https://froala.com/wysiwyg-editor/docs/overview/'),
    files: [
      {
        path: `src/editor.${ext}`,
        content: `import FroalaEditor from 'froala-editor';
${cssImports()}
${pluginImports(plugins)}

const config = ${editorConfig('import.meta.env.VITE_FROALA_KEY', plugins)};

/** Creates the editor in an element, for example createEditor('#editor'). */
export function createEditor(target${typescript ? ': string | HTMLElement' : ''}) {
  return new FroalaEditor(target, config);
}
`
      }
    ],
    notes: [
      `Add an element for the editor, such as <div id="editor"></div>, then in src/main.${ext} call createEditor('#editor') from './editor' once that element is on the page.`,
      'This setup is for npm with a bundler such as Vite. For a single HTML page without a build step, use framework "cdn".',
      KEY_NOTE('.env as VITE_FROALA_KEY'),
      pluginNote(plugins),
      ...COMMON_NOTES
    ]
  };
}

function cdn({ plugins }: TemplateOptions): Setup {
  const url = `https://cdn.jsdelivr.net/npm/froala-editor@${FROALA_VERSION}`;
  const scripts =
    plugins === 'all'
      ? [`  <script src="${url}/js/froala_editor.pkgd.min.js"></script>`]
      : [`  <script src="${url}/js/froala_editor.min.js"></script>`, ...pluginFiles(plugins).map((f) => `  <script src="${url}/${f.replace('froala-editor/', '')}"></script>`)];
  return {
    ...base('cdn', 'No install needed. The page loads Froala from the jsDelivr CDN.', 'https://froala.com/wysiwyg-editor/docs/overview/'),
    files: [
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Froala editor</title>
  <link href="${url}/css/froala_editor.pkgd.min.css" rel="stylesheet">
  <link href="${url}/css/froala_style.min.css" rel="stylesheet">
</head>
<body>
  <div id="editor">${START}</div>

${scripts.join('\n')}
  <script>
    new FroalaEditor('#editor', ${editorConfig("''", plugins, 2)});
  </script>
</body>
</html>
`
      }
    ],
    notes: [
      'Open index.html in a browser, or serve the folder with any static server.',
      KEY_NOTE('the key setting'),
      pluginNote(plugins),
      ...COMMON_NOTES
    ]
  };
}

const BUILDERS: Record<Framework, (o: TemplateOptions) => Setup> = { react, vue, angular, nextjs, nuxt, svelte, vanilla, cdn };

export function getSetup(framework: Framework, options: TemplateOptions): Setup {
  return BUILDERS[framework](options);
}
