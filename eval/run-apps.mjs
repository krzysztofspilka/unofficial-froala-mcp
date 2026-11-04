// Builds a fresh app for every target, follows the output of froala_get_setup, builds it, and checks it in Chrome.
//
//   npm run build
//   node eval/run-apps.mjs <folder for the apps> [target ...]
//
// With no targets it runs all of them. Results go to <folder>/results.json. Angular CLI needs Node 24.15 or newer.
// To test against another Froala release, set FROALA_INSTALL_VERSION. A release older than 5.6.0 also needs
// Vite's older CommonJS behaviour, so the script turns it on.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright-core';

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/stdio.js');
const [workspace, ...wanted] = process.argv.slice(2);
if (!workspace) {
  console.error('Usage: node eval/run-apps.mjs <folder for the apps> [target ...]');
  process.exit(1);
}
const root = path.resolve(workspace);
const installVersion = process.env.FROALA_INSTALL_VERSION;
const useRelease = (text) => (installVersion ? text.replace(/@\d+\.\d+\.\d+/g, `@${installVersion}`) : text);
mkdirSync(root, { recursive: true });

const write = (app, file, content) => {
  mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
  writeFileSync(path.join(app, file), content);
};
const read = (app, file) => readFileSync(path.join(app, file), 'utf8');
const sh = (command, cwd) =>
  execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, env: { ...process.env, CI: '1', NG_CLI_ANALYTICS: 'false', NEXT_TELEMETRY_DISABLED: '1' } }).toString();

const vite = (template, target, glue) => ({
  target,
  create: (name) => `npm create -y vite@latest ${name} -- --template ${template} --no-interactive --no-immediate`,
  glue,
  build: 'npm run build',
  serve: (port) => `npx vite preview --port ${port} --strictPort`
});

const reactGlue = (ext) => (app) => write(app, `src/App.${ext}`, `import FroalaEditor from './froala/FroalaEditor';\n\nexport default function App() {\n  return <FroalaEditor />;\n}\n`);
const vueGlue = (lang) => (app) =>
  write(app, 'src/App.vue', `<script setup${lang}>\nimport FroalaEditor from './froala/FroalaEditor.vue';\n</script>\n\n<template>\n  <FroalaEditor />\n</template>\n`);
const plainGlue = (ext) => (app) => {
  write(app, `src/main.${ext}`, `import { createEditor } from './froala/froala-preset';\n\ndocument.querySelector('#app').innerHTML = '<div id="editor"></div>';\ncreateEditor('#editor');\n`);
};
const angularGlue = (app) => {
  write(
    app,
    'src/app/app.ts',
    `import { Component } from '@angular/core';\nimport { FroalaEditorComponent } from './froala/froala-editor.component';\n\n@Component({\n  selector: 'app-root',\n  imports: [FroalaEditorComponent],\n  template: '<app-froala-editor />'\n})\nexport class App {}\n`
  );
  const json = JSON.parse(read(app, 'angular.json'));
  const options = Object.values(json.projects)[0].architect.build.options;
  options.styles = [...options.styles, 'node_modules/froala-editor/css/froala_editor.pkgd.min.css', 'node_modules/froala-editor/css/froala_style.min.css'];
  options.allowedCommonJsDependencies = ['froala-editor'];
  write(app, 'angular.json', JSON.stringify(json, null, 2));
};

const APPS = {
  'react-ts': vite('react-ts', 'react', reactGlue('tsx')),
  'react-js': vite('react', 'react', reactGlue('jsx')),
  // The dev server runs StrictMode, which starts the editor twice.
  'react-dev': { ...vite('react-ts', 'react', reactGlue('tsx')), build: '', serve: (port) => `npx vite --port ${port} --strictPort` },
  'vue-ts': vite('vue-ts', 'vue', vueGlue(' lang="ts"')),
  'vue-js': vite('vue', 'vue', vueGlue('')),
  typescript: {
    ...vite('vanilla-ts', 'typescript', (app) => {
      plainGlue('ts')(app);
      write(app, 'src/main.ts', read(app, 'src/main.ts').replace("document.querySelector('#app').innerHTML", "document.querySelector<HTMLDivElement>('#app')!.innerHTML"));
    })
  },
  javascript: vite('vanilla', 'javascript', plainGlue('js')),
  'html-page': { target: 'javascript', page: true, create: (name) => `mkdir ${name}`, glue: () => {}, build: '', staticFolder: '.' },
  angular: {
    target: 'angular',
    create: (name) => `npx -y -p node@24 -p @angular/cli@latest ng new ${name} --defaults --skip-git --ssr=false --ai-config=none`,
    glue: angularGlue,
    build: 'npx -y -p node@24 npx ng build',
    staticFolder: 'dist'
  },
  'angular-ssr': {
    target: 'angular',
    create: (name) => `npx -y -p node@24 -p @angular/cli@latest ng new ${name} --defaults --skip-git --ssr --ai-config=none`,
    glue: angularGlue,
    build: 'npx -y -p node@24 npx ng build',
    serve: (port, app) => `NG_ALLOWED_HOSTS=localhost PORT=${port} node dist/${path.basename(app)}/server/server.mjs`
  },
  nextjs: {
    target: 'nextjs',
    create: (name) => `npx -y create-next-app@latest ${name} --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm --yes --disable-git`,
    glue: (app) => write(app, 'app/page.tsx', `import FroalaEditor from './froala/FroalaEditor';\n\nexport default function Home() {\n  return <main><FroalaEditor /></main>;\n}\n`),
    build: 'npm run build',
    serve: (port) => `npx next start -p ${port}`
  },
  nuxt: {
    target: 'nuxt',
    create: (name) => `npx -y nuxi@latest init ${name} --packageManager npm --gitInit false --template minimal --no-modules --force`,
    glue: (app) => {
      write(app, 'app/app.vue', '<template>\n  <FroalaEditor />\n</template>\n');
      const config = read(app, 'nuxt.config.ts');
      write(app, 'nuxt.config.ts', config.replace('defineNuxtConfig({', "defineNuxtConfig({\n  runtimeConfig: { public: { froalaKey: '' } },"));
    },
    build: 'npm run build',
    serve: (port) => `PORT=${port} node .output/server/index.mjs`
  },
  svelte: {
    target: 'svelte',
    create: (name) => `npx -y sv@latest create ${name} --template minimal --types ts --no-add-ons --install npm`,
    glue: (app) => {
      write(app, 'src/routes/+page.svelte', `<script lang="ts">\n  import FroalaEditor from '#lib/froala/FroalaEditor.svelte';\n</script>\n\n<FroalaEditor />\n`);
      write(app, 'src/routes/+page.ts', 'export const ssr = false;\n');
    },
    build: 'npm run build',
    serve: (port) => `npx vite preview --port ${port} --strictPort`
  }
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/** Serves a folder of built files on localhost. */
function serveStatic(folder, port) {
  const http = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost').pathname;
    const file = path.join(folder, url.endsWith('/') ? `${url}index.html` : url);
    if (!file.startsWith(folder) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((resolve) => http.listen(port, '127.0.0.1', () => resolve(() => http.close())));
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}/`);
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Nothing answered on port ${port}.`);
}

/** The folder that holds index.html after an Angular build. */
function findIndex(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isFile() && entry.name === 'index.html') return folder;
    if (entry.isDirectory()) {
      const found = findIndex(full);
      if (found) return found;
    }
  }
  return undefined;
}

/** Turns on Vite's older CommonJS behaviour, which gives wrappers from before Froala 5.6.0 the import they expect. */
function olderCommonJs(app) {
  const flag = 'legacy: { inconsistentCjsInterop: true },';
  for (const file of ['vite.config.ts', 'vite.config.js']) {
    if (existsSync(path.join(app, file))) write(app, file, read(app, file).replace('defineConfig({', `defineConfig({\n  ${flag}`));
  }
  if (existsSync(path.join(app, 'nuxt.config.ts'))) write(app, 'nuxt.config.ts', read(app, 'nuxt.config.ts').replace('defineNuxtConfig({', `defineNuxtConfig({\n  vite: { ${flag} },`));
}

const SIMPLE_TOOLBAR = ['undo', 'redo', 'paragraphFormat', 'bold', 'italic', 'underline', 'insertLink', 'insertImage', 'formatUL', 'formatOL'];

async function checkInBrowser(browser, url) {
  const checks = {};
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/404|favicon/.test(message.text())) errors.push(message.text().slice(0, 200));
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.fr-box .fr-element', { timeout: 20000 });
  await page.waitForSelector('.fr-toolbar .fr-command', { timeout: 20000 });
  checks.editor_appears = true;

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.fr-toolbar .fr-btn-grp .fr-command.fr-btn, .fr-toolbar > .fr-command.fr-btn')]
      .map((b) => b.getAttribute('data-cmd'))
      .filter((c) => c && !c.endsWith('Options') && !/^more/.test(c))
  );
  checks.toolbar_order = JSON.stringify(order.filter((c, i) => order.indexOf(c) === i)) === JSON.stringify(SIMPLE_TOOLBAR) ? true : order.join(' ');

  checks.no_unlicensed_banner = await page.evaluate(() => !document.body.innerText.includes('unlicensed'));

  await page.click('.fr-element');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Hello Froala');
  await page.keyboard.press('ControlOrMeta+A');
  await page.click('.fr-toolbar [data-cmd="bold"]');
  checks.bold_works = await page.evaluate(() => /<strong>/.test(document.querySelector('.fr-element').innerHTML));

  await page.click('.fr-toolbar [data-cmd="formatUL"]');
  checks.list_works = await page.evaluate(() => !!document.querySelector('.fr-element ul li') && getComputedStyle(document.querySelector('.fr-element ul')).listStyleType !== 'none');

  await page.click('.fr-toolbar [data-cmd="undo"]');
  checks.undo_works = await page.evaluate(() => !document.querySelector('.fr-element ul'));

  checks.enhancements = await page.evaluate(() => document.querySelector('.fr-toolbar').getAttribute('role') === 'toolbar' && document.querySelector('.fr-element').getAttribute('role') === 'textbox');

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/html', '<img src=x onerror="window.ran=1">');
    data.setData('text/plain', 'x');
    document.querySelector('.fr-element').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  checks.safe_paste = (await page.evaluate(() => window.ran)) === undefined;

  const screenshot = await page.screenshot({ type: 'png' });
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForTimeout(400);
  checks.phone_toolbar_one_row = await page.evaluate(() => document.querySelector('.fr-toolbar').offsetHeight < 80);

  checks.no_errors = errors.length ? errors.slice(0, 3).join(' | ') : true;
  await context.close();
  return { checks, screenshot };
}

async function runApp(name, app, browser, client, port) {
  const folder = path.join(root, name);
  const result = { name, target: app.target };
  rmSync(folder, { recursive: true, force: true });
  sh(app.create(name), root);
  result.versions = {};
  const hasPackage = existsSync(path.join(folder, 'package.json'));
  if (hasPackage) {
    const pkg = JSON.parse(read(folder, 'package.json'));
    Object.assign(result.versions, pkg.dependencies, pkg.devDependencies);
    if (!existsSync(path.join(folder, 'node_modules'))) sh('npm install', folder);
  }

  const args = { target: app.target, ...(hasPackage ? { package_json: read(folder, 'package.json') } : {}) };
  const answer = await client.callTool({ name: 'froala_get_setup', arguments: args });
  const setup = answer.structuredContent;
  if (!setup?.files) throw new Error(answer.content?.[0]?.text ?? 'No setup returned');
  result.install = setup.install;
  if (setup.install.startsWith('npm')) sh(useRelease(setup.install), folder);
  for (const file of setup.files) write(folder, file.path, file.path.endsWith('.html') ? useRelease(file.content) : file.content);
  app.glue(folder);
  if (installVersion) olderCommonJs(folder);

  const audited = await client.callTool({
    name: 'froala_audit_code',
    arguments: { files: [...setup.files.filter((f) => !f.path.endsWith('.d.ts')), ...(hasPackage ? [{ path: 'package.json', content: read(folder, 'package.json') }] : [])] }
  });
  result.audit = audited.structuredContent?.summary;

  if (app.build)
    result.build_output = sh(app.build, folder)
      .split('\n')
      .filter((line) => /warning|error|exceeded/i.test(line))
      .slice(0, 5);

  let stop;
  if (app.serve) {
    const child = spawn(app.serve(port, folder), { cwd: folder, shell: true, stdio: 'ignore', detached: true });
    stop = () => process.kill(-child.pid);
  } else {
    stop = await serveStatic(app.page ? folder : findIndex(path.join(folder, app.staticFolder)), port);
  }
  try {
    await waitForServer(port);
    const { checks, screenshot } = await checkInBrowser(browser, `http://localhost:${port}/`);
    result.checks = checks;
    writeFileSync(path.join(root, `${name}.png`), screenshot);
  } finally {
    stop();
  }
  return result;
}

const names = wanted.length ? wanted : Object.keys(APPS);
const client = new Client({ name: 'froala-run-apps', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], stderr: 'ignore' }));
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL ?? 'chrome', headless: true });
const results = [];
let port = 4310;
for (const name of names) {
  const started = Date.now();
  process.stdout.write(`${name}... `);
  let result;
  try {
    result = await runApp(name, APPS[name], browser, client, port++);
  } catch (error) {
    result = { name, failed: String(error.stderr ?? error.message).slice(-900) };
  }
  result.seconds = Math.round((Date.now() - started) / 1000);
  const passed = result.checks && Object.values(result.checks).every((value) => value === true);
  console.log(passed ? `passed in ${result.seconds} s` : 'FAILED');
  if (!passed) console.log(JSON.stringify(result.checks ?? result.failed, null, 1));
  results.push({ ...result, passed: !!passed });
}
await browser.close();
await client.close();
writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
const failures = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failures} of ${results.length} apps passed. Details are in ${path.join(root, 'results.json')}.`);
if (failures) process.exitCode = 1;
