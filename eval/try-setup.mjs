// Writes the exact output of froala_get_setup into a fresh starter app and adds the smallest glue
// that shows the editor on the main page. Then build and open the app to check the setup code works.
//   node eval/try-setup.mjs <framework> <app folder>
// The app folder must be a fresh starter with its dependencies installed (see eval/README.md).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [framework, appDir] = process.argv.slice(2);
if (!framework || !appDir) {
  console.error('Usage: node eval/try-setup.mjs <framework> <app folder>');
  process.exit(1);
}
const app = path.resolve(appDir);
const read = (file) => readFileSync(path.join(app, file), 'utf8');
const write = (file, content) => {
  mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
  writeFileSync(path.join(app, file), content);
};

// 1. Ask the MCP server for the setup, with the app's package.json.
const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/stdio.js');
const client = new Client({ name: 'froala-try-setup', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], stderr: 'ignore' }));
const result = await client.callTool({ name: 'froala_get_setup', arguments: { framework, package_json: read('package.json') } });
await client.close();
const setup = result.structuredContent;
if (!setup?.files) throw new Error(result.content?.[0]?.text ?? 'No setup returned');

// 2. Install exactly what it says, and write its files unchanged.
console.log(`$ ${setup.install}`);
execSync(setup.install, { cwd: app, stdio: 'inherit' });
for (const file of setup.files) write(file.path, file.content);

// 3. The glue: show the editor on the main page (what the notes ask the developer to do).
const glue = {
  react() {
    write('src/App.tsx', `import FroalaEditor from './components/FroalaEditor';\n\nexport default function App() {\n  return <FroalaEditor />;\n}\n`);
  },
  vue() {
    write('src/App.vue', `<script setup lang="ts">\nimport FroalaEditor from './components/FroalaEditor.vue';\n</script>\n\n<template>\n  <FroalaEditor />\n</template>\n`);
  },
  angular() {
    write('src/app/app.ts', `import { Component } from '@angular/core';\nimport { EditorComponent } from './editor/editor.component';\n\n@Component({\n  selector: 'app-root',\n  imports: [EditorComponent],\n  template: '<app-editor />'\n})\nexport class App {}\n`);
    const json = JSON.parse(read('angular.json'));
    const options = Object.values(json.projects)[0].architect.build.options;
    options.styles = [...options.styles, 'node_modules/froala-editor/css/froala_editor.pkgd.min.css', 'node_modules/froala-editor/css/froala_style.min.css'];
    options.allowedCommonJsDependencies = ['froala-editor'];
    write('angular.json', JSON.stringify(json, null, 2));
  },
  nextjs() {
    write('app/page.tsx', `import FroalaEditor from './components/FroalaEditor';\n\nexport default function Home() {\n  return <main><FroalaEditor /></main>;\n}\n`);
  },
  nuxt() {
    write('app/app.vue', `<template>\n  <FroalaEditor />\n</template>\n`);
  },
  svelte() {
    // SvelteKit 3 renamed the $lib alias to #lib.
    write('src/routes/+page.svelte', `<script lang="ts">\n  import Editor from '#lib/Editor.svelte';\n</script>\n\n<Editor />\n`);
    write('src/routes/+page.ts', 'export const ssr = false;\n');
  },
  vanilla() {
    write('src/main.ts', `import { createEditor } from './editor';\n\ndocument.querySelector<HTMLDivElement>('#app')!.innerHTML = '<div id="editor"></div>';\ncreateEditor('#editor');\n`);
  }
};
if (!glue[framework]) throw new Error(`No glue for ${framework}`);
glue[framework]();
if (existsSync(path.join(app, 'package.json'))) console.log(`Wrote ${setup.files.length} file(s). Now run npm run build in ${app}.`);
