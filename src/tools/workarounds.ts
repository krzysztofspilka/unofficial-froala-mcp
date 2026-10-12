// Fixes for known problems in Froala 5.5.0 and older, found while testing fresh projects (October 2026).
// Each entry says which versions it affects, how sure we are that it applies, and what was tested.
// When a Froala release fixes a problem, keep the entry: its version check stops matching newer projects,
// and people on older versions still get the fix. Remove this tool (its line in server.ts) once nobody needs it.
import * as z from 'zod/v4';
import semver from 'semver';
import type { McpServer } from '@modelcontextprotocol/server';
import { FROALA_VERSION, SOURCE } from '../data.js';
import {
  FRAMEWORKS,
  describeProject,
  froalaAtMost,
  isAtLeast,
  newerNote,
  readProject,
  usesAngularSsr,
  wrapperImportBug,
  type Answer,
  type Framework,
  type Project
} from '../project.js';
import { READ_ONLY, toolError, toolResult } from '../util.js';

interface Workaround {
  id: string;
  title: string;
  frameworks: Framework[] | 'all';
  appliesTo: string;
  /**
   * 'yes' when package.json shows the problem affects the project, 'unknown' when it depends on the
   * project's code (or on versions package.json doesn't show), 'no' when it doesn't apply.
   */
  applies: (p: Project) => Answer;
  problem: string;
  fix: string;
  tested: string;
}

const usesReactWrapper = (p: Project) => p.framework === 'react' || p.framework === 'nextjs';
const usesVueWrapper = (p: Project) => p.framework === 'vue' || p.framework === 'nuxt';
/** Applies to these frameworks when the package is 5.5.0 or older, but only if the code does what the problem describes. */
const dependsOnCode = (matches: boolean, version: Answer): Answer => (!matches || version === 'no' ? 'no' : 'unknown');
const when = (condition: boolean): Answer => (condition ? 'yes' : 'no');

export const WORKAROUNDS: Workaround[] = [
  {
    id: 'vite8-react-import',
    title: 'React wrapper shows a blank page with Vite 8',
    frameworks: ['react'],
    appliesTo: 'react-froala-wysiwyg 5.5.0 or older, Vite 8 or newer, and "type": "module" in package.json',
    applies: (p) => (p.framework === 'react' ? wrapperImportBug(p, 'react-froala-wysiwyg') : 'no'),
    problem:
      'The usual import gives a blank page, and the console shows "Element type is invalid ... but got: object". Vite 8 hands back the whole CommonJS module instead of its default export.',
    fix: `Take the component from the module. This keeps working after the wrapper is fixed.

\`\`\`tsx
// Instead of: import FroalaEditorComponent from 'react-froala-wysiwyg';
import FroalaEditorComponentImport from 'react-froala-wysiwyg';

const FroalaEditorComponent =
  (FroalaEditorComponentImport as unknown as { default?: typeof FroalaEditorComponentImport }).default ?? FroalaEditorComponentImport;
\`\`\`

In JavaScript: const FroalaEditorComponent = FroalaEditorComponentImport.default ?? FroalaEditorComponentImport;`,
    tested: 'Fresh Vite 8.3 and React 19.3 project with react-froala-wysiwyg 5.5.0, dev server and production build (11 Oct 2026). On 12 Oct 2026, React apps built with this import rendered and worked in Chrome; an AI agent that used the plain import got a blank page first.'
  },
  {
    id: 'vite8-vue-plugin',
    title: 'Vue wrapper shows a blank page with Vite 8 or Nuxt 4.5 and newer',
    frameworks: ['vue', 'nuxt'],
    appliesTo: 'vue-froala-wysiwyg 5.5.0 or older with Vite 8 or Nuxt 4.5 and newer, and "type": "module" in package.json',
    applies: (p) => (usesVueWrapper(p) ? wrapperImportBug(p, 'vue-froala-wysiwyg') : 'no'),
    problem:
      'The page is blank and <froala> stays an unknown element. Vue warns "A plugin must either be a function or an object with an install function". Vite 8 hands back the whole CommonJS module instead of its default export.',
    fix: `Take the plugin from the module. This keeps working after the wrapper is fixed.

\`\`\`ts
// Instead of: import VueFroala from 'vue-froala-wysiwyg';
import VueFroalaImport from 'vue-froala-wysiwyg';

const VueFroala = VueFroalaImport.default ?? VueFroalaImport;

app.use(VueFroala); // In a Nuxt plugin: nuxtApp.vueApp.use(VueFroala)
\`\`\``,
    tested: 'Fresh create-vue project with Vite 8.3 and Vue 3.5 (11 Oct 2026). On 12 Oct 2026, Vue and Nuxt 4.6 apps built with this import rendered and worked in Chrome; with the plain import the Nuxt build passed and the page showed an inert <froala> element.'
  },
  {
    id: 'vue-types',
    title: 'Vue TypeScript build fails with TS7016',
    frameworks: ['vue', 'nuxt'],
    appliesTo: 'vue-froala-wysiwyg 5.5.0 or older in a TypeScript project',
    applies: (p) => (usesVueWrapper(p) && p.typescript ? froalaAtMost(p, 'vue-froala-wysiwyg', '5.5.0') : 'no'),
    problem: 'npm run build fails with "Could not find a declaration file for module vue-froala-wysiwyg", because the wrapper ships without type declarations.',
    fix: `Add a declaration file, for example src/froala.d.ts.

\`\`\`ts
declare module 'vue-froala-wysiwyg';
\`\`\``,
    tested: 'create-vue starter build with vue-tsc (11 Oct 2026).'
  },
  {
    id: 'plugin-types',
    title: 'TypeScript reports TS7016 for dynamic imports of Froala plugins',
    frameworks: ['nextjs', 'angular'],
    appliesTo: 'froala-editor 5.5.0 or older in a TypeScript project that loads plugins with import(), as the server rendering examples do',
    applies: (p) => dependsOnCode((p.framework === 'nextjs' || p.framework === 'angular') && p.typescript, froalaAtMost(p, 'froala-editor', '5.5.0')),
    problem: "import('froala-editor/js/plugins.pkgd.min.js') fails the type check with TS7016, because the plugin files have no type declarations. Plain import lines are fine.",
    fix: `Add a declaration file, for example src/froala-plugins.d.ts.

\`\`\`ts
declare module 'froala-editor/js/plugins/*';
declare module 'froala-editor/js/plugins.pkgd.min.js';
\`\`\``,
    tested: 'Next.js 16 type check with the README server rendering example (11 Oct 2026).'
  },
  {
    id: 'nextjs-browser-only',
    title: 'Next.js build fails with "Element is not defined"',
    frameworks: ['nextjs'],
    appliesTo: 'Next.js with any Froala version (tested with Next.js 16)',
    applies: (p) => when(p.framework === 'nextjs'),
    problem:
      'next build fails with "ReferenceError: Element is not defined", even in a "use client" component, because Next.js also renders client components once on the server. The README server-side rendering example fails too.',
    fix: `Keep the editor in a client component and load that component without server rendering.

\`\`\`tsx
// app/components/FroalaEditor.tsx
'use client';

import dynamic from 'next/dynamic';

const FroalaEditor = dynamic(() => import('./FroalaEditorClient'), { ssr: false });

export default FroalaEditor;
\`\`\`

FroalaEditorClient.tsx is a "use client" component that imports react-froala-wysiwyg, the CSS and the plugins. froala_get_setup with framework "nextjs" gives both files.`,
    tested: 'Next.js 16 App Router, next build and next start (11 Oct 2026).'
  },
  {
    id: 'angular-standalone',
    title: 'Angular standalone components fail with forRoot()',
    frameworks: ['angular'],
    appliesTo: 'angular-froala-wysiwyg 5.5.0 or older with Angular 19 or newer',
    applies: (p) => (p.framework === 'angular' ? isAtLeast(p, '@angular/core', '19.0.0') : 'no'),
    problem: 'The README shows NgModule setup with FroalaEditorModule.forRoot(). New Angular apps use standalone components, where forRoot() fails with NG2012 and TS2322.',
    fix: `List the modules directly in the component.

\`\`\`ts
@Component({
  selector: 'app-editor',
  imports: [FroalaEditorModule, FroalaViewModule],
  template: \`<div [froalaEditor]="options" [(froalaModel)]="content"></div>\`
})
export class EditorComponent {}
\`\`\``,
    tested: 'Angular 22 ng build, standalone and zoneless (11 Oct 2026).'
  },
  {
    id: 'angular-styles-path',
    title: 'Angular build cannot find "styles.css"',
    frameworks: ['angular'],
    appliesTo: 'Angular projects that follow the README angular.json snippet',
    applies: (p) => dependsOnCode(p.framework === 'angular', 'yes'),
    problem: 'The README angular.json snippet lists "styles.css". New projects keep that file in src/, so the build fails with "Could not resolve styles.css".',
    fix: `In angular.json, keep your own styles path and add Froala's CSS after it.

\`\`\`json
"styles": [
  "src/styles.css",
  "node_modules/froala-editor/css/froala_editor.pkgd.min.css",
  "node_modules/froala-editor/css/froala_style.min.css"
]
\`\`\``,
    tested: 'Angular 22 ng build (11 Oct 2026).'
  },
  {
    id: 'angular-bundle-budget',
    title: 'Angular build fails the bundle budget with all plugins',
    frameworks: ['angular'],
    appliesTo: 'Angular projects that import Froala plugins at the top of a file',
    applies: (p) => dependsOnCode(p.framework === 'angular', 'yes'),
    problem:
      'Importing plugins at the top of a component puts Froala in the initial bundle, and ng build fails with "bundle initial exceeded maximum budget": 2.55 MB with every plugin, and 1.25 MB even with five plugins, against the default 1 MB.',
    fix: 'Load the plugins with import() after the page starts and show the editor when they have loaded. froala_get_setup with framework "angular" gives this component. Raising the "initial" budget in angular.json also works, but makes the first load slower.',
    tested: 'Angular 22 ng build (11 and 12 Oct 2026). The lazy component built within the default budget and rendered in Chrome.'
  },
  {
    id: 'angular-ssr',
    title: 'Angular server-side rendering fails with "document is not defined"',
    frameworks: ['angular'],
    appliesTo: 'Angular projects with server-side rendering (@angular/ssr)',
    applies: (p) => when(p.framework === 'angular' && usesAngularSsr(p)),
    problem: 'Importing Froala plugins at the top of a file breaks the server build with "document is not defined", and no routes are prerendered.',
    fix: `Load the plugins in the browser only, then show the editor.

\`\`\`ts
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FroalaEditorModule } from 'angular-froala-wysiwyg';

@Component({
  selector: 'app-editor',
  imports: [FroalaEditorModule],
  template: \`@if (ready()) { <div [froalaEditor]="options" [(froalaModel)]="content"></div> }\`
})
export class EditorComponent {
  ready = signal(false);
  content = '';
  options = {};

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      import('froala-editor/js/plugins.pkgd.min.js').then(() => this.ready.set(true));
    }
  }
}
\`\`\`

If TypeScript reports TS7016 for the import, see the plugin-types workaround.`,
    tested: 'Angular 22 with ng new --ssr: the failure is confirmed, and browser-only loading follows the wrapper README (11 Oct 2026).'
  },
  {
    id: 'react-strict-mode-events',
    title: 'Event handlers run twice in React development mode',
    frameworks: ['react', 'nextjs'],
    appliesTo: 'react-froala-wysiwyg 5.5.0 or older with React StrictMode (on by default in Vite)',
    applies: (p) => dependsOnCode(usesReactWrapper(p), froalaAtMost(p, 'react-froala-wysiwyg', '5.5.0')),
    problem: 'With StrictMode, the initialized event runs 3 times in development, so handlers added inside it with editor.events.on fire twice per keystroke.',
    fix: `Put handlers in config.events instead of adding them inside initialized.

\`\`\`ts
const config = {
  events: {
    keyup: function () {
      // runs once per key
    }
  }
};
\`\`\``,
    tested: 'React 19.3 and Vite 8.3 dev server, with and without StrictMode (12 Oct 2026).'
  },
  {
    id: 'react-model-change-on-load',
    title: 'onModelChange runs when the editor loads',
    frameworks: ['react', 'nextjs'],
    appliesTo: 'react-froala-wysiwyg 5.5.0 or older',
    applies: (p) => dependsOnCode(usesReactWrapper(p), froalaAtMost(p, 'react-froala-wysiwyg', '5.5.0')),
    problem: 'onModelChange runs once as the editor loads, before anyone types, so a form looks edited.',
    fix: `Compare with the starting content before marking the form as changed.

\`\`\`tsx
const initial = useRef(model);

<FroalaEditorComponent
  model={model}
  onModelChange={(value: string) => {
    setModel(value);
    setChanged(value !== initial.current);
  }}
/>
\`\`\`

In JavaScript, leave out : string.`,
    tested: 'React 19.3 (12 Oct 2026).'
  },
  {
    id: 'react-undo-reset',
    title: 'Updating the content from outside clears undo',
    frameworks: ['react', 'nextjs'],
    appliesTo: 'react-froala-wysiwyg 5.5.0 or older',
    applies: (p) => dependsOnCode(usesReactWrapper(p), froalaAtMost(p, 'react-froala-wysiwyg', '5.5.0')),
    problem: 'Setting model from your own code, for example after loading a draft, clears the undo history.',
    fix: 'Add the skipReset prop: <FroalaEditorComponent skipReset model={model} ... />',
    tested: 'React 19.3: undo history cleared after an outside update (12 Oct 2026). skipReset comes from the wrapper source and was not tested on its own.'
  },
  {
    id: 'react-config-changes',
    title: 'Changing the config after start has no effect',
    frameworks: ['react', 'nextjs'],
    appliesTo: 'react-froala-wysiwyg 5.5.0 or older',
    applies: (p) => dependsOnCode(usesReactWrapper(p), froalaAtMost(p, 'react-froala-wysiwyg', '5.5.0')),
    problem: 'The React wrapper reads config once. Later changes, such as a new placeholder or language, are ignored.',
    fix: 'Give the component a key that changes with the setting, so React starts a fresh editor: <FroalaEditorComponent key={language} config={config} ... />',
    tested: 'React 19.3: the change is ignored (12 Oct 2026). Restarting with a key is standard React behaviour and was not tested separately.'
  },
  {
    id: 'react-typescript-model',
    title: 'onModelChange fails strict TypeScript with TS7006',
    frameworks: ['react', 'nextjs'],
    appliesTo: 'react-froala-wysiwyg 5.5.0 or older in a TypeScript project',
    applies: (p) => dependsOnCode(usesReactWrapper(p) && p.typescript, froalaAtMost(p, 'react-froala-wysiwyg', '5.5.0')),
    problem: 'onModelChange={(model) => ...} fails with "Parameter implicitly has an any type", because the wrapper types onModelChange as object.',
    fix: 'Type the parameter: onModelChange={(model: string) => setModel(model)}',
    tested: 'TypeScript 6 strict mode (11 Oct 2026).'
  },
  {
    id: 'event-handler-this',
    title: 'Event handlers from older examples throw errors',
    frameworks: 'all',
    appliesTo: 'Any Froala 3 or newer project using events',
    applies: (p) => dependsOnCode(true, 'yes'),
    problem: 'Handlers written as function (e, editor) throw on every event, because since Froala 3 the editor is this, not a parameter. Arrow functions lose this as well.',
    fix: `Use a regular function and this.

\`\`\`ts
events: {
  focus: function () {
    console.log(this.html.get());
  }
}
\`\`\``,
    tested: 'Events example from the React wrapper README (11 Oct 2026).'
  },
  {
    id: 'vue-v-model',
    title: 'v-model on <froala> does not update your data',
    frameworks: ['vue', 'nuxt'],
    appliesTo: 'vue-froala-wysiwyg 5.5.0 or older',
    applies: (p) => dependsOnCode(usesVueWrapper(p), froalaAtMost(p, 'vue-froala-wysiwyg', '5.5.0')),
    problem: 'The Vue component reports changes as value, so plain v-model never receives them.',
    fix: 'Use v-model:value: <froala tag="textarea" :config="config" v-model:value="content" />',
    tested: 'Read in the vue-froala-wysiwyg 5.5.0 source (October 2026).'
  },
  {
    id: 'accessible-name',
    title: 'The editing area has no accessible role or name',
    frameworks: 'all',
    appliesTo: 'Any Froala 5.5.0 or older project',
    applies: (p) => froalaAtMost(p, 'froala-editor', '5.5.0'),
    problem: 'Accessibility testing found that the editing area has no role or label, so screen readers announce it poorly.',
    fix: `Add a role and a label when the editor starts.

\`\`\`ts
events: {
  initialized: function () {
    this.el.setAttribute('role', 'textbox');
    this.el.setAttribute('aria-multiline', 'true');
    this.el.setAttribute('aria-label', 'Content editor');
  }
}
\`\`\``,
    tested: 'Problem found with axe-core 4.14 and manual checks (October 2026). The fix follows WAI-ARIA guidance and has not been re-tested yet.'
  },
  {
    id: 'mobile-toolbar',
    title: 'The toolbar wraps to several rows on phones',
    frameworks: 'all',
    appliesTo: 'Any Froala 5.5.0 or older project using the default toolbar',
    applies: (p) => dependsOnCode(true, froalaAtMost(p, 'froala-editor', '5.5.0')),
    problem: 'On a 375 px wide screen the default toolbar wraps to 3 or 4 rows.',
    fix: `Group the buttons for small screens with toolbarButtonsXS.

\`\`\`ts
toolbarButtonsXS: {
  moreText: { buttons: ['bold', 'italic', 'underline'], buttonsVisible: 2 },
  moreParagraph: { buttons: ['paragraphFormat', 'formatOL', 'formatUL'], buttonsVisible: 0 },
  moreRich: { buttons: ['insertLink', 'insertImage'], buttonsVisible: 0 },
  moreMisc: { buttons: ['undo', 'redo'], align: 'right', buttonsVisible: 2 }
}
\`\`\``,
    tested: 'Row count measured in October 2026. The fix uses the documented toolbarButtonsXS setting and has not been re-tested yet.'
  },
  {
    id: 'word-export',
    title: 'Word export files may not open outside Microsoft Word',
    frameworks: 'all',
    appliesTo: 'Projects using Export to Word (html-docx-js)',
    applies: (p) => when(p.has('html-docx-js')),
    problem: 'Export to Word uses html-docx-js, whose own README says its files open in Microsoft Word but not in LibreOffice or Google Docs.',
    fix: 'If your users need other apps, convert the HTML to DOCX on your server instead. Otherwise tell users to open exports in Microsoft Word.',
    tested: 'Based on the html-docx-js 0.3.1 README; not tested in those apps.'
  },
  {
    id: 'pdf-export',
    title: 'PDF export creates image-only pages',
    frameworks: 'all',
    appliesTo: 'Projects using Export to PDF (html2pdf.js)',
    applies: (p) => when(p.has('html2pdf.js')),
    problem: "The getPDF button uses html2pdf.js in the browser, which draws the content as images, so the text in the PDF can't be selected or searched.",
    fix: 'For PDFs with real text, render the HTML on your server, for example with a headless browser that prints to PDF.',
    tested: 'Read in the Froala 5.5.0 print plugin and the html2pdf.js docs (October 2026).'
  },
  {
    id: 'helper-library-versions',
    title: 'The docs load helper library versions with known security issues',
    frameworks: 'all',
    appliesTo: 'Projects using Import from Word (mammoth) or code view with CodeMirror',
    applies: (p) => {
      const mammoth = p.version('mammoth');
      const codemirror = p.version('codemirror');
      return when((!!mammoth && semver.lt(mammoth, '1.11.0')) || (!!codemirror && semver.major(codemirror) === 5 && semver.lt(codemirror, '5.58.2')));
    },
    problem: 'The Froala docs load mammoth 1.4.21 and CodeMirror 5.3.0. Both versions have known security issues: GHSA-rmjr-87wv-gf87 (mammoth, fixed in 1.11.0) and GHSA-4gw3-8f77-f72c (CodeMirror, fixed in 5.58.2).',
    fix: 'Use mammoth 1.11.0 or newer and CodeMirror 5.65.21.',
    tested: 'GitHub Advisory Database (October 2026).'
  }
];

const input = z.object({
  package_json: z.string().max(50_000).optional().describe('The full content of the project package.json. Returns only the workarounds that can apply.'),
  framework: z.enum(FRAMEWORKS).optional().describe('Without package_json: list the workarounds for this framework'),
  id: z.enum(WORKAROUNDS.map((w) => w.id) as [string, ...string[]]).optional().describe('Return one workaround by id')
});

const describe = (w: Workaround) => `## ${w.title} (${w.id})\nAffects: ${w.appliesTo}\n\n${w.problem}\n\n${w.fix}\n\nTested: ${w.tested}`;
const asData = ({ id, title, appliesTo, problem, fix, tested }: Workaround, applies?: Answer) => ({
  id,
  title,
  affects: appliesTo,
  ...(applies ? { applies: applies === 'yes' ? 'yes' : 'depends on your code' } : {}),
  problem,
  fix,
  tested
});

export function workarounds({ package_json, framework, id }: z.infer<typeof input>) {
  if (id) {
    const w = WORKAROUNDS.find((w) => w.id === id)!;
    return toolResult(describe(w), { ...SOURCE, workarounds: [asData(w)] });
  }
  if (package_json) {
    let project: Project;
    try {
      project = readProject(package_json, framework);
    } catch (error) {
      return toolError((error as Error).message);
    }
    const matched = WORKAROUNDS.map((w) => ({ w, answer: w.applies(project) })).filter(({ answer }) => answer !== 'no');
    const sure = matched.filter(({ answer }) => answer === 'yes');
    const maybe = matched.filter(({ answer }) => answer === 'unknown');
    const lines = [`Project: ${describeProject(project) || 'no framework packages found'}.`];
    const newer = newerNote(project);
    if (newer) lines.push(newer);
    if (sure.length) lines.push('', `These apply to your versions (${sure.length}). Apply them to the code you write:`, '', ...sure.map(({ w }) => describe(w)));
    if (maybe.length) {
      lines.push('', `These may apply, depending on your code (${maybe.length}). Check whether your code does what each one describes before changing it:`, '');
      lines.push(...maybe.map(({ w }) => `- ${w.id}: ${w.title}`));
      lines.push('', 'Call froala_workarounds with an id for the details of one of them.');
    }
    if (!matched.length) lines.push('', 'No known workarounds apply to this project.');
    return toolResult(lines.join('\n'), { ...SOURCE, workarounds: matched.map(({ w, answer }) => asData(w, answer)) });
  }
  if (framework) {
    const list = WORKAROUNDS.filter((w) => w.frameworks === 'all' || w.frameworks.includes(framework));
    const text = [`Workarounds for ${framework}. Send package_json to get only the ones that can apply to your versions.`, ...list.map((w) => `- ${w.id}: ${w.title}`)].join('\n');
    return toolResult(text, { ...SOURCE, workarounds: list.map((w) => asData(w)) });
  }
  const index = WORKAROUNDS.map((w) => `- ${w.id}: ${w.title} (${w.appliesTo})`).join('\n');
  return toolResult(`Known problems with fixes, for Froala ${FROALA_VERSION} and older. Send package_json to get the ones that can apply.\n\n${index}`, {
    ...SOURCE,
    workarounds: WORKAROUNDS.map((w) => asData(w))
  });
}

export const workaroundsTool = {
  names: ['froala_workarounds'],
  instruction: "When existing Froala code fails (a blank page, build or type errors), call froala_workarounds with the project's package.json, and check that a fix applies before using it.",
  register(server: McpServer) {
    server.registerTool(
      'froala_workarounds',
      {
        title: 'Workarounds for known Froala issues',
        description:
          `Fixes for known problems in Froala ${FROALA_VERSION} and older, such as a blank page with Vite 8, Next.js build errors, ` +
          'Angular standalone and server rendering setup, and React wrapper quirks. Send the project package.json to get the fixes that apply to its versions.',
        inputSchema: input,
        annotations: READ_ONLY
      },
      async (args) => workarounds(args)
    );
  }
};
