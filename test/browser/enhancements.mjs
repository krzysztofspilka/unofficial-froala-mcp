// Runs every enhancement in Chrome against the installed froala-editor, with and without it.
// Each case must show the problem without the enhancement and not with it.
//
//   npm run test:browser
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { javascript } = JSON.parse(readFileSync(path.join(root, 'data/content.json'), 'utf8')).enhancements;
const SIMPLE_TOOLBAR = [['undo', 'redo'], ['paragraphFormat'], ['bold', 'italic', 'underline'], ['insertLink', 'insertImage'], ['formatUL', 'formatOL']];
const SIMPLE_PLUGINS = ['link', 'lists', 'image', 'paragraph_format'];
const TALL_TEXT = '<p>Line</p>'.repeat(60);

const page = ({ enhanced, plugins, options }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Enhancement test</title>
  <link href="/node_modules/froala-editor/css/froala_editor.pkgd.min.css" rel="stylesheet">
  <link href="/node_modules/froala-editor/css/froala_style.min.css" rel="stylesheet">
</head>
<body>
  <main>
    <h1>Enhancement test</h1>
    <button id="before">Before</button>
    <div id="editor"><p>Hello world</p><p>Second paragraph</p></div>
    <button id="after">After</button>
  </main>
  <script src="/node_modules/prismjs/prism.js"></script>
  <script src="/node_modules/froala-editor/js/froala_editor.min.js"></script>
  ${plugins.map((plugin) => `<script src="/node_modules/froala-editor/js/plugins/${plugin}.min.js"></script>`).join('\n  ')}
  <script type="module">
    import { installFroalaEnhancements } from '/froala-enhancements.js';
    ${enhanced ? 'installFroalaEnhancements(FroalaEditor);' : ''}
    window.ed = await new Promise((resolve) => {
      new FroalaEditor('#editor', { imageUploadRemoteUrls: false, heightMin: 200, ...${JSON.stringify(options)}, events: { initialized() { resolve(this); } } });
    });
    window.ready = true;
  </script>
</body>
</html>
`;

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/froala-enhancements.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(javascript);
    return;
  }
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' }).end(page(JSON.parse(url.searchParams.get('case'))));
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

async function open(enhanced, plugins, options) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', (error) => errors.push(error.message));
  await tab.goto(`http://localhost:${port}/?case=${encodeURIComponent(JSON.stringify({ enhanced, plugins, options }))}`);
  await tab.waitForFunction('window.ready === true', null, { timeout: 8000 });
  return { tab, errors, close: () => context.close() };
}

const paste = (tab, html) =>
  tab.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/html', text);
    data.setData('text/plain', 'x');
    window.ed.events.focus();
    window.ed.el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);

const modalOpen = (tab) => tab.evaluate(() => [...document.querySelectorAll('.fr-modal')].some((modal) => modal.offsetWidth > 0));
const SHORTCUT = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Each case returns true when the problem shows. */
const CASES = [
  ...Object.entries({
    'an image onerror handler': '<img src=x onerror="window.ran=1">',
    'a handler after a slash': '<img src="x"/onerror="window.ran=1">',
    'a details ontoggle handler': '<details open ontoggle="window.ran=1">a</details>',
    'a video source onerror handler': '<video><source onerror="window.ran=1"></video>',
    'a handler after a line break': '<img src=x\nonerror="window.ran=1">'
  }).map(([name, html]) => ({
    enhancement: 'safePaste',
    name: `Pasted HTML with ${name} runs nothing`,
    async problem({ tab }) {
      await paste(tab, html);
      await tab.waitForTimeout(300);
      return (await tab.evaluate(() => window.ran)) === 1;
    }
  })),
  {
    enhancement: 'shortcuts',
    name: 'The help and quote shortcuts work',
    plugins: [...SIMPLE_PLUGINS, 'help', 'quote'],
    async problem({ tab, errors }) {
      await tab.click('.fr-element p');
      await tab.keyboard.press(`${SHORTCUT}+/`);
      await tab.waitForTimeout(200);
      return errors.length > 0;
    }
  },
  {
    enhancement: 'toolbarLabels',
    name: 'Font and size dropdowns show real values after load',
    plugins: ['font_family', 'font_size', 'paragraph_format'],
    options: { toolbarButtons: [['fontFamily', 'fontSize', 'paragraphFormat']], fontFamilySelection: true, fontSizeSelection: true, paragraphFormatSelection: true },
    problem: ({ tab }) => tab.evaluate(() => [...document.querySelectorAll('.fr-toolbar .fr-dropdown > span')].some((label) => label.textContent.trim() === 'Font Size'))
  },
  {
    enhancement: 'dropdownNames',
    name: 'A dropdown name includes the value it shows',
    plugins: ['paragraph_format'],
    options: { toolbarButtons: [['paragraphFormat']], paragraphFormatSelection: true },
    async problem({ tab }) {
      await tab.click('.fr-element p');
      await tab.waitForTimeout(200);
      return tab.evaluate(() => document.querySelector('.fr-toolbar .fr-dropdown').getAttribute('aria-label') === 'Paragraph Format');
    }
  },
  {
    enhancement: 'dropdownNames',
    name: 'The align list stores clean values',
    plugins: ['align'],
    options: { toolbarButtons: [['align']] },
    problem: ({ tab }) =>
      tab.evaluate(() => [...document.querySelectorAll('.fr-dropdown-menu .fr-command[data-param1]')].some((item) => item.getAttribute('data-param1') !== item.getAttribute('data-param1').trim()))
  },
  {
    enhancement: 'keyboardToolbar',
    name: 'Tab reaches a named toolbar and moves on',
    async problem({ tab }) {
      await tab.focus('#before');
      await tab.keyboard.press('Tab');
      const inToolbar = await tab.evaluate(() => !!document.activeElement.closest('.fr-toolbar'));
      await tab.keyboard.press('Tab');
      const left = await tab.evaluate(() => !document.activeElement.closest('.fr-toolbar'));
      const named = await tab.evaluate(() => document.querySelector('.fr-toolbar').getAttribute('role') === 'toolbar');
      return !(inToolbar && left && named);
    }
  },
  {
    enhancement: 'keyboardToolbar',
    name: 'Home and End move inside the toolbar',
    async problem({ tab }) {
      await tab.focus('#before');
      await tab.keyboard.press('Tab');
      await tab.keyboard.press('End');
      return tab.evaluate(() => !document.activeElement.getAttribute('data-cmd')?.startsWith('formatOL'));
    }
  },
  {
    enhancement: 'editingAreaName',
    name: 'The text area has a role and a name',
    problem: ({ tab }) => tab.evaluate(() => window.ed.el.getAttribute('role') !== 'textbox' || !window.ed.el.getAttribute('aria-label'))
  },
  {
    enhancement: 'popupEscape',
    name: 'Esc on a popup Back button goes back without an error',
    plugins: [...SIMPLE_PLUGINS, 'table'],
    options: { toolbarButtons: [['bold', 'insertTable']] },
    async problem({ tab, errors }) {
      await tab.click('.fr-element p');
      await tab.click('[data-cmd="insertTable"]');
      await tab.waitForTimeout(200);
      await tab.evaluate(() => [...document.querySelectorAll('.fr-popup .fr-back')].find((button) => button.offsetWidth)?.focus());
      await tab.keyboard.press('Escape');
      await tab.waitForTimeout(200);
      return errors.length > 0;
    }
  },
  {
    enhancement: 'popupPosition',
    name: 'Table properties follow the text while it scrolls',
    plugins: [...SIMPLE_PLUGINS, 'table'],
    options: { heightMin: 220, heightMax: 220 },
    async problem({ tab }) {
      await tab.evaluate((text) => window.ed.html.set(`<table style="width:100%"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>${text}`), TALL_TEXT);
      await tab.click('.fr-element td');
      await tab.waitForTimeout(300);
      await tab.click('.fr-popup.fr-active [data-cmd="tableProperties"]');
      await tab.waitForTimeout(400);
      const top = () => tab.evaluate(() => document.querySelector('.fr-popup.fr-active').getBoundingClientRect().top);
      const before = await top();
      await tab.evaluate(() => {
        window.ed.$wp[0].scrollTop = 60;
      });
      await tab.waitForTimeout(250);
      return Math.abs((await top()) - before) < 30;
    }
  },
  {
    enhancement: 'uploadChecks',
    name: 'A wrong file type says what is wrong',
    async problem({ tab }) {
      await tab.click('.fr-element p');
      await tab.click('[data-cmd="insertImage"]');
      await tab.waitForTimeout(300);
      const input = await tab.$('.fr-popup.fr-active input[type=file]');
      await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
      await tab.waitForTimeout(400);
      return tab.evaluate(() => !document.body.innerText.includes('notes.txt is not an image'));
    }
  },
  {
    enhancement: 'cleanRestart',
    name: 'Restarting an editor keeps the content clean',
    problem: ({ tab }) =>
      tab.evaluate(async () => {
        await window.ed.destroy();
        const next = await new Promise((resolve) => {
          new FroalaEditor('#editor', {
            events: {
              initialized() {
                resolve(this);
              }
            }
          });
        });
        return next.html.get().includes('fr-selection-handle');
      })
  },
  {
    enhancement: 'ariaMarkup',
    name: 'The link popup passes axe, apart from colour contrast',
    async problem({ tab }) {
      await tab.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
      await tab.click('.fr-element p');
      await tab.click('[data-cmd="insertLink"]');
      await tab.waitForTimeout(300);
      const violations = await tab.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((violation) => violation.id));
      return violations.some((id) => id !== 'color-contrast');
    }
  },
  {
    enhancement: 'windowEscape',
    name: 'Esc closes the code snippet window',
    plugins: [...SIMPLE_PLUGINS, 'code_snippet'],
    options: { toolbarButtons: [['bold', 'codeSnippet']] },
    async problem({ tab }) {
      await tab.click('.fr-element p');
      await tab.click('[data-cmd="codeSnippet"]');
      await tab.waitForTimeout(600);
      await tab.evaluate(() => [...document.querySelectorAll('.fr-modal [contenteditable], .fr-modal textarea, .fr-modal code')].find((field) => field.offsetWidth)?.focus());
      await tab.keyboard.press('Escape');
      await tab.waitForTimeout(300);
      return modalOpen(tab);
    }
  },
  {
    enhancement: 'scrollHints',
    name: 'A tooltip goes away when the text scrolls',
    options: { heightMin: 200, heightMax: 200 },
    async problem({ tab }) {
      await tab.evaluate((text) => window.ed.html.set(text), TALL_TEXT);
      await tab.hover('[data-cmd="bold"]');
      await tab.waitForTimeout(600);
      await tab.evaluate(() => {
        window.ed.$wp[0].scrollTop = 200;
      });
      await tab.waitForTimeout(250);
      return tab.evaluate(() => document.querySelectorAll('.fr-tooltip.fr-visible').length > 0);
    }
  }
];

let failures = 0;
for (const { enhancement, name, plugins = SIMPLE_PLUGINS, options = { toolbarButtons: SIMPLE_TOOLBAR }, problem } of CASES) {
  const shows = async (enhanced) => {
    const opened = await open(enhanced, plugins, options);
    try {
      return await problem(opened);
    } finally {
      await opened.close();
    }
  };
  const [without, enhanced] = [await shows(false), await shows(true)];
  const passed = without && !enhanced;
  if (!passed) failures += 1;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${enhancement}: ${name}`);
  if (!without) console.log(`     The editor now behaves this way without ${enhancement}. Check the release notes, and remove the enhancement and its case.`);
  if (enhanced) console.log(`     ${enhancement} no longer solves this problem.`);
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} of ${CASES.length} cases failed.` : `\nAll ${CASES.length} cases passed.`);
if (failures) process.exitCode = 1;
