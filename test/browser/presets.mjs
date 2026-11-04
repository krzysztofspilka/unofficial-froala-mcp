// Starts every preset and every extension in Chrome, with the settings and plugin files the tools return.
//
//   npm run build
//   node test/browser/presets.mjs
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensions = new Map(JSON.parse(readFileSync(path.join(root, 'data/knowledge.json'), 'utf8')).extensions.map((e) => [e.id, e]));

const client = new Client({ name: 'froala-preset-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/stdio.js')], stderr: 'ignore' }));
const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;

const pageFor = ({ scripts, settings, extension }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Preset check</title>
  <link href="/node_modules/froala-editor/css/froala_editor.pkgd.min.css" rel="stylesheet">
</head>
<body>
  <div id="editor"><p>Hello world</p></div>
  <script src="/node_modules/prismjs/prism.js"></script>
  <script src="/node_modules/froala-editor/js/froala_editor.min.js"></script>
  ${scripts.map((file) => `<script src="/node_modules/${file}"></script>`).join('\n  ')}
  <script type="module">
    ${extension ? `import { installFroalaExtension } from '/extension/${extension}.js';\n    installFroalaExtension(FroalaEditor);` : ''}
    window.ed = await new Promise((resolve) => {
      new FroalaEditor('#editor', { ...${JSON.stringify(settings)}, events: { initialized() { resolve(this); } } });
    });
    window.ready = true;
  </script>
</body>
</html>
`;

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' }).end(pageFor(JSON.parse(url.searchParams.get('case'))));
    return;
  }
  const extension = url.pathname.match(/^\/extension\/(.+)\.js$/)?.[1];
  if (extension) {
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(extensions.get(extension).code);
    return;
  }
  try {
    const file = readFileSync(path.join(root, url.pathname));
    response.writeHead(200, { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(file);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL ?? 'chrome', headless: true });

/** Returns what is wrong with this editor, or an empty list. */
async function check(scenario, buttons) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message.slice(0, 140)));
  await page.goto(`http://localhost:${port}/?case=${encodeURIComponent(JSON.stringify(scenario))}`);
  try {
    await page.waitForFunction('window.ready === true', null, { timeout: 8000 });
    const shown = await page.evaluate(() => [...document.querySelectorAll('.fr-toolbar [data-cmd]')].map((button) => button.getAttribute('data-cmd').replace(/-\d+$/, '')));
    const missing = buttons.filter((button) => !shown.includes(button));
    if (missing.length) problems.push(`Missing buttons: ${missing.join(', ')}`);
    const order = shown.filter((button) => buttons.includes(button)).filter((button, index, all) => all.indexOf(button) === index);
    if (!missing.length && JSON.stringify(order) !== JSON.stringify(buttons)) problems.push(`Wrong order: ${order.join(' ')}`);
  } catch {
    problems.push('The editor did not start.');
  }
  await context.close();
  return problems;
}

let failures = 0;
const report = (name, problems) => {
  if (problems.length) failures += 1;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? `\n     ${problems.join('\n     ')}` : ''}`);
};

const { total } = await call('froala_find_presets', { limit: 1 });
const { results: presets } = await call('froala_find_presets', { limit: 50 });
if (presets.length !== total) throw new Error('This check needs one page of presets.');
for (const { id } of presets) {
  const preset = await call('froala_find_presets', { id });
  const scripts = preset.plugin_imports.map((line) => line.match(/'(.+)'/)[1]);
  const buttons = (preset.settings.toolbarButtons ?? []).flat();
  report(`preset ${id}`, await check({ scripts, settings: preset.settings }, buttons));
}
for (const [id, extension] of extensions) {
  const buttons = extension.buttons ?? [];
  const settings = { toolbarButtons: buttons.length ? [buttons] : [['bold']] };
  report(`extension ${id}`, await check({ scripts: ['froala-editor/js/plugins.pkgd.min.js'], settings, extension: id }, buttons));
}

await browser.close();
await client.close();
server.close();
console.log(failures ? `\n${failures} failed.` : `\nAll ${presets.length} presets and ${extensions.size} extensions started.`);
if (failures) process.exitCode = 1;
