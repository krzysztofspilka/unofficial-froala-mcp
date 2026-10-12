// End-to-end check with the official MCP client.
//   node scripts/smoke.mjs                         tests dist/stdio.js (run npm run build first)
//   node scripts/smoke.mjs http://localhost:8787/mcp   tests a running hosted version (npm run dev)
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const target = process.argv[2];
const transport = target
  ? new StreamableHTTPClientTransport(new URL(target))
  : new StdioClientTransport({ command: process.execPath, args: ['dist/stdio.js'], stderr: 'ignore' });

const client = new Client({ name: 'froala-mcp-smoke-test', version: '1.0.0' });
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
};
const text = (result) => result.content.map((c) => c.text ?? '').join('\n');

await client.connect(transport);
console.log(`Connected to ${target ?? 'dist/stdio.js'}`);

const instructions = client.getInstructions?.() ?? '';
check('server sends instructions', instructions.includes('froala_check_code'));

const { tools } = await client.listTools();
const expected = ['froala_check_code', 'froala_get_page', 'froala_get_setup', 'froala_licensing', 'froala_lookup', 'froala_recipes', 'froala_search_docs', 'froala_workarounds'];
check('lists the 8 tools', JSON.stringify(tools.map((t) => t.name).sort()) === JSON.stringify(expected), tools.map((t) => t.name).join(', '));
check('every tool is read-only', tools.every((t) => t.annotations?.readOnlyHint === true));

const { prompts } = await client.listPrompts();
check('lists the 2 prompts', prompts.map((p) => p.name).sort().join(',') === 'add-froala,review-froala');

const prompt = await client.getPrompt({ name: 'add-froala', arguments: { framework: 'vue' } });
check('add-froala prompt mentions the framework', prompt.messages[0].content.text.includes('vue'));

const vite8 = JSON.stringify({ type: 'module', dependencies: { react: '^19.3.0', 'react-froala-wysiwyg': '^5.5.0' }, devDependencies: { vite: '^8.3.4' } });
const checked = await client.callTool({
  name: 'froala_check_code',
  arguments: {
    files: [
      {
        path: 'src/Editor.tsx',
        content: `import FroalaEditorComponent from 'react-froala-wysiwyg';
import 'froala-editor/css/froala_editor.pkgd.min.css';
import 'froala-editor/js/plugins/align.min.js';
const config = { placeholder: 'Type here', toolbarButtons: ['bold', 'insertTable'] };
export default () => <FroalaEditorComponent tag="textarea" config={config} />;`
      },
      { path: 'package.json', content: vite8 }
    ]
  }
});
const findings = checked.structuredContent?.findings ?? [];
check('check_code suggests placeholderText', findings.some((f) => f.check === 'unknown-option' && f.fix.includes('placeholderText')));
check('check_code finds the missing table plugin', findings.some((f) => f.check === 'button-plugin-missing' && f.fix.includes('table.min.js')));
check('check_code catches the Vite 8 import', findings.some((f) => f.check === 'wrapper-import' && f.level === 'error'));

const setup = await client.callTool({ name: 'froala_get_setup', arguments: { framework: 'nextjs' } });
check('get_setup returns Next.js files', (setup.structuredContent?.files ?? []).some((f) => f.content.includes('ssr: false')));
const react = await client.callTool({ name: 'froala_get_setup', arguments: { framework: 'react', package_json: vite8 } });
check('get_setup adapts React code to Vite 8', (react.structuredContent?.files ?? []).some((f) => f.content.includes('.default ??')));

const search = await client.callTool({ name: 'froala_search_docs', arguments: { query: 'table plugin' } });
check('search finds the table plugin page', text(search).includes('/docs/plugins/table-plugin/'));

const page = await client.callTool({ name: 'froala_get_page', arguments: { url: 'https://froala.com/wysiwyg-editor/docs/options/' } });
check('get_page splits the long options page', (page.structuredContent?.parts_total ?? 0) > 1, `${page.structuredContent?.parts_total} parts`);

const buttons = await client.callTool({ name: 'froala_lookup', arguments: { kind: 'button', names: ['insertTable', 'bold'] } });
check('lookup answers several buttons at once', buttons.structuredContent?.results?.[0]?.plugin === 'table' && buttons.structuredContent?.results?.length === 2);

const lic = await client.callTool({ name: 'froala_licensing', arguments: {} });
check('licensing explains the free start and the trial key', text(lic).includes('no sign-up and no key') && text(lic).includes('get-trial-key'));

const recipe = await client.callTool({ name: 'froala_recipes', arguments: { use_case: 'email' } });
check('recipes return email settings', recipe.structuredContent?.config?.useClasses === false);

const broken = await client.callTool({ name: 'froala_workarounds', arguments: { package_json: '{ nope' } });
check('broken package.json is a tool error', broken.isError === true);

const fixes = await client.callTool({ name: 'froala_workarounds', arguments: { package_json: vite8 } });
check('workarounds catch React with Vite 8', (fixes.structuredContent?.workarounds ?? []).some((w) => w.id === 'vite8-react-import'));

await client.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
