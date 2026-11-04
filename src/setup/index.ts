// Setup code for each target. Every setup has the same three parts. These are froala-enhancements, the same file
// for every project, froala-preset with the toolbar, plugins and settings, and a small component for the framework.
import { FROALA_VERSION } from '../data.js';
import { isAtLeast, usesAngularSsr, type Project, type Target } from '../project.js';
import {
  COMMON_NOTES,
  ENHANCEMENTS_NOTE,
  KEY_NOTE,
  PIN_NOTE,
  START,
  base,
  cssImports,
  editorConfig,
  enhancementsFile,
  installCommand,
  pluginFiles,
  pluginImports,
  tailwindFix,
  type Setup,
  type SetupFile,
  type TemplateOptions
} from './shared.js';
import { presetRequirements, type Preset } from '../presets.js';

const DOCS = 'https://froala.com/wysiwyg-editor/docs/framework-plugins/';
const PLAIN_DOCS = 'https://froala.com/wysiwyg-editor/docs/overview/';

/** Where a project's own licence key comes from. Vite, Create React App and Vue CLI expose environment variables differently. */
function keyFrom(project: Project): { variable?: string; where: string } {
  if (!project.fromPackageJson || project.has('vite')) return { variable: 'import.meta.env.VITE_FROALA_KEY', where: '.env as VITE_FROALA_KEY' };
  if (project.has('react-scripts')) return { variable: 'process.env.REACT_APP_FROALA_KEY', where: '.env as REACT_APP_FROALA_KEY' };
  if (project.has('@vue/cli-service')) return { variable: 'process.env.VUE_APP_FROALA_KEY', where: '.env as VUE_APP_FROALA_KEY' };
  return { where: 'the key setting of froala-preset' };
}

/** The file with the plugins, the CSS and the settings of a preset. */
function presetFile(dir: string, { typescript, preset }: TemplateOptions, keyVariable: string | undefined, tailwindImport: string, extra = ''): SetupFile {
  return {
    path: `${dir}froala-preset.${typescript ? 'ts' : 'js'}`,
    content: `import FroalaEditor from 'froala-editor';
${cssImports(preset)}
${tailwindImport}${pluginImports(preset)}
import { installFroalaEnhancements } from './froala-enhancements';

installFroalaEnhancements(FroalaEditor);

export const froalaConfig = ${editorConfig(preset, keyVariable)};
${extra}`
  };
}

const presetNotes = (preset: Preset) => [...preset.notes, ...presetRequirements(preset)];

function react(options: TemplateOptions): Setup {
  const { typescript, preset, project } = options;
  const dir = 'src/froala/';
  const ext = typescript ? 'tsx' : 'jsx';
  const key = keyFrom(project);
  const tailwind = tailwindFix(project, dir);
  return {
    ...base('react', installCommand(project, 'react-froala-wysiwyg'), `${DOCS}react/`, preset),
    files: [
      enhancementsFile(dir, typescript),
      presetFile(dir, options, key.variable, tailwind.importLine),
      {
        path: `${dir}FroalaEditor.${ext}`,
        content: `import { useState } from 'react';
import FroalaEditorComponent from 'react-froala-wysiwyg';
import { froalaConfig } from './froala-preset';

export default function FroalaEditor() {
  const [model, setModel] = useState('${START}');

  return (
    <FroalaEditorComponent
      tag="textarea"
      config={froalaConfig}
      model={model}
      onModelChange={(value${typescript ? ': string' : ''}) => setModel(value)}
    />
  );
}
`
      },
      ...tailwind.files
    ],
    notes: [
      `Render <FroalaEditor /> from ${dir}FroalaEditor wherever you want the editor.`,
      ...presetNotes(preset),
      ENHANCEMENTS_NOTE,
      PIN_NOTE('react-froala-wysiwyg'),
      KEY_NOTE(key.where),
      ...COMMON_NOTES
    ]
  };
}

function vue(options: TemplateOptions): Setup {
  const { typescript, preset, project } = options;
  const dir = 'src/froala/';
  const key = keyFrom(project);
  const tailwind = tailwindFix(project, dir);
  const files: SetupFile[] = [
    enhancementsFile(dir, typescript),
    presetFile(dir, options, key.variable, tailwind.importLine),
    {
      path: `${dir}FroalaEditor.vue`,
      content: `<script setup${typescript ? ' lang="ts"' : ''}>
import { getCurrentInstance, ref } from 'vue';
import VueFroala from 'vue-froala-wysiwyg';
import { froalaConfig } from './froala-preset';

// The wrapper registers the <froala> component on the app, once.
const app = getCurrentInstance()${typescript ? '!' : ''}.appContext.app;
if (!app.component('Froala')) app.use(VueFroala);

const model = ref('${START}');
</script>

<template>
  <froala tag="textarea" :config="froalaConfig" v-model:value="model" />
</template>
`
    },
    ...tailwind.files
  ];
  // The Vue wrapper ships without type declarations.
  if (typescript) files.push({ path: `${dir}froala.d.ts`, content: "declare module 'vue-froala-wysiwyg';\n" });
  return {
    ...base('vue', installCommand(project, 'vue-froala-wysiwyg'), `${DOCS}vue-js-3/`, preset),
    files,
    notes: [
      `Use <FroalaEditor /> from ${dir}FroalaEditor.vue wherever you want the editor.`,
      ...presetNotes(preset),
      ENHANCEMENTS_NOTE,
      PIN_NOTE('vue-froala-wysiwyg'),
      KEY_NOTE(key.where),
      ...COMMON_NOTES
    ]
  };
}

function angular(options: TemplateOptions): Setup {
  const { preset, project } = options;
  const dir = 'src/app/froala/';
  const ssr = usesAngularSsr(project);
  const tailwind = tailwindFix(project, dir);
  const imports = pluginFiles(preset)
    .map((file) => `    import('${file}')`)
    .join(',\n');
  const presetCode = `import { installFroalaEnhancements } from './froala-enhancements';

export const froalaConfig = ${editorConfig(preset)};

/** Loads Froala's plugins in the browser after the page starts, which keeps them out of the initial bundle. */
export async function loadFroala(): Promise<void> {
  const { default: FroalaEditor } = await import('froala-editor');
  await Promise.all([
${imports}
  ]);
  installFroalaEnhancements(FroalaEditor);
}
`;
  const component = `import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FroalaEditorModule, FroalaViewModule } from 'angular-froala-wysiwyg';
import { froalaConfig, loadFroala } from './froala-preset';

@Component({
  selector: 'app-froala-editor',
  imports: [FroalaEditorModule, FroalaViewModule],
  template: \`
    @if (ready()) {
      <div [froalaEditor]="options" [(froalaModel)]="content"></div>
    }
  \`
})
export class FroalaEditorComponent {
  ready = signal(false);
  content = '${START}';
  options = froalaConfig;

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      loadFroala().then(() => this.ready.set(true));
    }
  }
}
`;
  return {
    ...base('angular', installCommand(project, 'angular-froala-wysiwyg'), `${DOCS}angular/`, preset),
    files: [
      enhancementsFile(dir, true),
      { path: `${dir}froala-preset.ts`, content: presetCode },
      { path: `${dir}froala-editor.component.ts`, content: component },
      // Froala's plugin files ship without types, which import() needs.
      {
        path: 'src/froala-plugins.d.ts',
        content: "declare module 'froala-editor/js/plugins/*';\ndeclare module 'froala-editor/js/plugins.pkgd.min.js';\ndeclare module 'froala-editor/js/third_party/*';\n"
      },
      ...tailwind.files
    ],
    notes: [
      `In angular.json, add "node_modules/froala-editor/css/froala_editor.pkgd.min.css" and "node_modules/froala-editor/css/froala_style.min.css" to projects > (your app) > architect > build > options > styles, after your own styles file${tailwind.files.length ? `, then "${dir}froala-content.css"` : ''}. Keep the path of your own file as it is, usually "src/styles.css".`,
      'Add "allowedCommonJsDependencies": ["froala-editor"] to the same build options. Froala ships CommonJS, and without this ng build prints warnings about it.',
      'Add FroalaEditorComponent to the imports of the component that shows the editor, then use <app-froala-editor />. Standalone components list FroalaEditorModule and FroalaViewModule directly, without forRoot().',
      `The plugins load in the browser after the page starts. That keeps the initial bundle under the default 1 MB budget${ssr ? ' and keeps Froala out of server rendering.' : ', and works with server rendering too.'}`,
      ...presetNotes(preset),
      ENHANCEMENTS_NOTE,
      PIN_NOTE('angular-froala-wysiwyg'),
      KEY_NOTE('the key setting of froala-preset.ts'),
      ...COMMON_NOTES
    ]
  };
}

function nextjs(options: TemplateOptions): Setup {
  const { typescript, preset, project } = options;
  const dir = 'app/froala/';
  const ext = typescript ? 'tsx' : 'jsx';
  const tailwind = tailwindFix(project, dir);
  return {
    ...base('nextjs', installCommand(project, 'react-froala-wysiwyg'), `${DOCS}react/`, preset),
    files: [
      enhancementsFile(dir, typescript),
      presetFile(dir, options, 'process.env.NEXT_PUBLIC_FROALA_KEY', tailwind.importLine),
      {
        path: `${dir}FroalaEditorClient.${ext}`,
        content: `'use client';

import { useState } from 'react';
import FroalaEditorComponent from 'react-froala-wysiwyg';
import { froalaConfig } from './froala-preset';

export default function FroalaEditorClient() {
  const [model, setModel] = useState('${START}');

  return (
    <FroalaEditorComponent
      tag="textarea"
      config={froalaConfig}
      model={model}
      onModelChange={(value${typescript ? ': string' : ''}) => setModel(value)}
    />
  );
}
`
      },
      {
        path: `${dir}FroalaEditor.${ext}`,
        content: `'use client';

import dynamic from 'next/dynamic';

// Froala runs in the browser only, so this loads it without server rendering.
const FroalaEditor = dynamic(() => import('./FroalaEditorClient'), { ssr: false });

export default FroalaEditor;
`
      },
      ...tailwind.files
    ],
    notes: [
      `Use <FroalaEditor /> from ${dir}FroalaEditor in any page or component. If your app keeps its code in src/, put the folder in src/app/.`,
      'Import FroalaEditor, not FroalaEditorClient. FroalaEditor loads the editor in the browser only, which keeps next build working.',
      'With the Pages Router, put the folder in components/ and import FroalaEditor in a page. next/dynamic with ssr: false works the same way.',
      ...presetNotes(preset),
      ENHANCEMENTS_NOTE,
      PIN_NOTE('react-froala-wysiwyg'),
      KEY_NOTE('.env.local as NEXT_PUBLIC_FROALA_KEY'),
      ...COMMON_NOTES
    ]
  };
}

function nuxt(options: TemplateOptions): Setup {
  const { typescript, preset, project } = options;
  const ext = typescript ? 'ts' : 'js';
  // Nuxt 4 keeps the app in app/, and Nuxt 3 keeps plugins and components at the top level.
  const nuxt4 = project.fromPackageJson ? isAtLeast(project, 'nuxt', '4.0.0') : 'yes';
  const root = nuxt4 === 'no' ? '' : 'app/';
  const dir = `${root}froala/`;
  const tailwind = tailwindFix(project, dir);
  const files: SetupFile[] = [
    enhancementsFile(dir, typescript),
    {
      path: `${dir}froala-config.${ext}`,
      content: `// The settings stay in their own file, because the server can read this one and must not load Froala.
export const froalaConfig = ${editorConfig(preset)};
`
    },
    {
      path: `${root}plugins/froala.client.${ext}`,
      content: `import FroalaEditor from 'froala-editor';
import VueFroala from 'vue-froala-wysiwyg';
${cssImports(preset)}
${tailwind.importLine.replace('./', '../froala/')}${pluginImports(preset)}
import { installFroalaEnhancements } from '../froala/froala-enhancements';

installFroalaEnhancements(FroalaEditor);

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VueFroala);
});
`
    },
    {
      path: `${root}components/FroalaEditor.vue`,
      content: `<script setup${typescript ? ' lang="ts"' : ''}>
import { froalaConfig } from '../froala/froala-config';

const model = ref('${START}');
const config = { ...froalaConfig, key: useRuntimeConfig().public.froalaKey || froalaConfig.key };
</script>

<template>
  <ClientOnly>
    <froala tag="textarea" :config="config" v-model:value="model" />
  </ClientOnly>
</template>
`
    },
    ...tailwind.files
  ];
  // The Vue wrapper ships without type declarations.
  if (typescript) files.push({ path: `${dir}froala.d.ts`, content: "declare module 'vue-froala-wysiwyg';\n" });
  return {
    ...base('nuxt', installCommand(project, 'vue-froala-wysiwyg'), `${DOCS}vue-js-3/`, preset),
    files,
    notes: [
      `Use <FroalaEditor /> in any page or in ${root}app.vue.`,
      ...(nuxt4 === 'unknown' ? ['package.json does not show the Nuxt version, so these paths are for Nuxt 4. On Nuxt 3, move the folders out of app/.'] : []),
      "In nuxt.config, add runtimeConfig: { public: { froalaKey: '' } } so the key can come from NUXT_PUBLIC_FROALA_KEY.",
      'The plugin file ends in .client so it runs only in the browser, and <ClientOnly> keeps the editor out of server rendering.',
      ...presetNotes(preset),
      ENHANCEMENTS_NOTE,
      PIN_NOTE('vue-froala-wysiwyg'),
      KEY_NOTE('.env as NUXT_PUBLIC_FROALA_KEY'),
      ...COMMON_NOTES
    ]
  };
}

function svelte(options: TemplateOptions): Setup {
  const { typescript, preset, project } = options;
  const dir = 'src/lib/froala/';
  const tailwind = tailwindFix(project, dir);
  const files: SetupFile[] = [
    enhancementsFile(dir, typescript),
    presetFile(dir, options, 'import.meta.env.VITE_FROALA_KEY', tailwind.importLine),
    {
      path: `${dir}FroalaEditor.svelte`,
      content: `<script${typescript ? ' lang="ts"' : ''}>
  import FroalaEditorComponent from 'svelte-froala-wysiwyg';
  import { froalaConfig } from './froala-preset';

  let model = $state('${START}');
</script>

<FroalaEditorComponent bind:model config={froalaConfig} />
`
    },
    ...tailwind.files
  ];
  // The Svelte wrapper ships without type declarations.
  if (typescript) files.push({ path: 'src/froala.d.ts', content: "declare module 'svelte-froala-wysiwyg';\n" });
  const kit = project.has('@sveltejs/kit');
  // SvelteKit 3 renamed the $lib alias to #lib.
  const kit3 = isAtLeast(project, '@sveltejs/kit', '3.0.0');
  const lib = kit3 === 'no' ? '$lib' : '#lib';
  return {
    ...base('svelte', installCommand(project, 'svelte-froala-wysiwyg'), 'https://www.npmjs.com/package/svelte-froala-wysiwyg', preset),
    files,
    notes: [
      kit
        ? `Use <FroalaEditor /> where you want the editor. import FroalaEditor from '${lib}/froala/FroalaEditor.svelte'; The wrapper needs Svelte 5.`
        : `Use <FroalaEditor /> from ${dir}FroalaEditor.svelte where you want the editor. The wrapper needs Svelte 5.`,
      ...(kit ? ['SvelteKit also renders pages on the server, and Froala needs the browser. In the +page.ts or +layout.ts of the route that shows the editor, add export const ssr = false;'] : []),
      ...(kit && kit3 === 'unknown' ? ['package.json does not show the SvelteKit version. SvelteKit 2 uses the $lib alias in place of #lib.'] : []),
      ...presetNotes(preset),
      ENHANCEMENTS_NOTE,
      KEY_NOTE('.env as VITE_FROALA_KEY'),
      ...COMMON_NOTES
    ]
  };
}

/** TypeScript or JavaScript with npm and a bundler such as Vite. */
function plainModule(target: 'typescript' | 'javascript', options: TemplateOptions): Setup {
  const { typescript, preset, project } = options;
  const dir = 'src/froala/';
  const ext = typescript ? 'ts' : 'js';
  const key = keyFrom(project);
  const tailwind = tailwindFix(project, dir);
  const createEditor = `
/** Creates the editor in an element, for example createEditor('#editor'). */
export function createEditor(target${typescript ? ': string | HTMLElement' : ''}) {
  return new FroalaEditor(target, froalaConfig${typescript ? ' as object' : ''});
}
`;
  return {
    ...base(target, installCommand(project), PLAIN_DOCS, preset),
    files: [enhancementsFile(dir, typescript), presetFile(dir, options, key.variable, tailwind.importLine, createEditor), ...tailwind.files],
    notes: [
      `Add an element for the editor, such as <div id="editor"></div>, then call createEditor('#editor') from './froala/froala-preset' in src/main.${ext} once that element is on the page.`,
      ...presetNotes(preset),
      ENHANCEMENTS_NOTE,
      KEY_NOTE(key.where),
      ...COMMON_NOTES
    ]
  };
}

/** A web page with no build step. It loads Froala with script tags. */
function plainPage({ preset }: TemplateOptions): Setup {
  const url = `https://cdn.jsdelivr.net/npm/froala-editor@${FROALA_VERSION}`;
  const scripts = preset.allPlugins
    ? [`  <script src="${url}/js/froala_editor.pkgd.min.js"></script>`]
    : [`  <script src="${url}/js/froala_editor.min.js"></script>`, ...pluginFiles(preset).map((file) => `  <script src="${url}/${file.replace('froala-editor/', '')}"></script>`)];
  return {
    ...base('javascript', 'No install is needed. The page loads Froala from the jsDelivr CDN.', PLAIN_DOCS, preset),
    files: [
      enhancementsFile('', false),
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
  <script type="module">
    import { installFroalaEnhancements } from './froala-enhancements.js';

    installFroalaEnhancements(FroalaEditor);

    new FroalaEditor('#editor', ${editorConfig(preset, undefined, 2)});
  </script>
</body>
</html>
`
      }
    ],
    notes: [
      'Serve the folder with any local web server, for example npx serve, and open it on localhost. Browsers do not load modules from file:// pages.',
      'If this project has a package.json with a bundler such as Vite, call froala_get_setup again with package_json.',
      ...presetNotes(preset),
      ENHANCEMENTS_NOTE,
      KEY_NOTE('the key setting of index.html'),
      ...COMMON_NOTES
    ]
  };
}

const BUILDERS: Record<Target, (options: TemplateOptions) => Setup> = {
  react,
  vue,
  angular,
  nextjs,
  nuxt,
  svelte,
  typescript: (options) => plainModule('typescript', { ...options, typescript: true }),
  javascript: (options) => (options.project.fromPackageJson ? plainModule('javascript', { ...options, typescript: false }) : plainPage(options))
};

export function getSetup(target: Target, options: TemplateOptions): Setup {
  return BUILDERS[target](options);
}
