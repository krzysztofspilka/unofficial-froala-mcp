// End-to-end check with the official MCP client.
//   node scripts/smoke.mjs                         tests dist/stdio.js (run npm run build first)
//   node scripts/smoke.mjs http://localhost:8787/mcp   tests a running hosted version (npm run dev)
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const target = process.argv[2];
const transport = target ? new StreamableHTTPClientTransport(new URL(target)) : new StdioClientTransport({ command: process.execPath, args: ['dist/stdio.js'], stderr: 'ignore' });

const client = new Client({ name: 'froala-mcp-smoke-test', version: '1.0.0' });
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
};
const text = (result) => result.content.map((c) => c.text ?? '').join('\n');
const call = (name, args) => client.callTool({ name, arguments: args });

await client.connect(transport);
console.log(`Connected to ${target ?? 'dist/stdio.js'}`);

const instructions = client.getInstructions?.() ?? '';
check('server sends instructions', instructions.includes('froala_audit_code'));

const { tools } = await client.listTools();
const expected = ['froala_audit_code', 'froala_find_presets', 'froala_get_integration', 'froala_get_setup', 'froala_query_docs'];
check('lists the 5 tools', JSON.stringify(tools.map((t) => t.name).sort()) === JSON.stringify(expected), tools.map((t) => t.name).join(', '));
check(
  'every tool is read-only',
  tools.every((t) => t.annotations?.readOnlyHint === true)
);
check(
  'every tool has a title',
  tools.every((t) => t.title?.startsWith('Froala'))
);
check(
  'every tool refuses unknown inputs',
  tools.every((t) => t.inputSchema.additionalProperties === false)
);

const { prompts } = await client.listPrompts();
check(
  'lists the 2 prompts',
  prompts
    .map((p) => p.name)
    .sort()
    .join(',') === 'add-froala,review-froala'
);
const prompt = await client.getPrompt({ name: 'add-froala', arguments: { target: 'vue' } });
check('add-froala prompt mentions the target', prompt.messages[0].content.text.includes('vue'));

const vite8 = JSON.stringify({ type: 'module', dependencies: { react: '^19.3.0', 'react-froala-wysiwyg': '5.5.0' }, devDependencies: { vite: '^8.3.4' } });
const audited = await call('froala_audit_code', {
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
});
const findings = audited.structuredContent?.findings ?? [];
check(
  'audit suggests placeholderText',
  findings.some((f) => f.check === 'unknown-option' && f.fix.includes('placeholderText'))
);
check(
  'audit finds the missing table plugin',
  findings.some((f) => f.check === 'button-plugin-missing' && f.fix.includes('table.min.js'))
);
check(
  'audit catches the Vite 8 import',
  findings.some((f) => f.check === 'wrapper-import' && f.level === 'error')
);
check(
  'audit returns the known issues',
  (audited.structuredContent?.issues ?? []).some((i) => i.id === 'vite8-react-import')
);
const symptom = await call('froala_audit_code', { symptom: 'undo empties the document' });
check(
  'audit searches known issues',
  (symptom.structuredContent?.issues ?? []).some((i) => i.id === 'collaboration-undo')
);
check('a broken package.json is a tool error', (await call('froala_audit_code', { package_json: '{ nope' })).isError === true);

const react = await call('froala_get_setup', { target: 'react', package_json: vite8 });
const files = react.structuredContent?.files ?? [];
check(
  'setup returns the enhancements file',
  files.some((f) => f.path.endsWith('froala-enhancements.js'))
);
check('setup uses the plain wrapper import', !files.some((f) => f.content.includes('.default ??')));
check(
  'setup uses the trial key unless the project sets a key',
  files.some((f) => f.content.includes('import.meta.env.VITE_FROALA_KEY || '))
);
check(
  'setup starts the toolbar with undo and redo',
  files.some((f) => f.content.includes("['undo', 'redo']"))
);
const next = await call('froala_get_setup', { target: 'nextjs' });
check(
  'setup returns Next.js files',
  (next.structuredContent?.files ?? []).some((f) => f.content.includes('ssr: false'))
);

const presets = await call('froala_find_presets', { query: 'comments' });
check('presets finds the comment box', presets.structuredContent?.results?.[0]?.id === 'comment-box');
const sample = await call('froala_find_presets', { id: 'example:color-themes', target: 'vue' });
check('presets returns Vue sample code', sample.structuredContent?.code?.includes('vue-froala-wysiwyg'));

const search = await call('froala_query_docs', { mode: 'search', query: 'table plugin' });
check('docs search finds the table plugin page', text(search).includes('/docs/plugins/table-plugin/'));
const page = await call('froala_query_docs', { mode: 'read', url: 'https://froala.com/wysiwyg-editor/docs/options/' });
check('docs read splits the long options page', (page.structuredContent?.parts_total ?? 0) > 1, `${page.structuredContent?.parts_total} parts`);
const buttons = await call('froala_query_docs', { mode: 'lookup', kind: 'button', names: ['insertTable', 'bold'] });
check('docs lookup answers several buttons at once', buttons.structuredContent?.results?.[0]?.plugin === 'table' && buttons.structuredContent?.results?.length === 2);
const licensing = await call('froala_query_docs', { mode: 'licensing' });
check('docs licensing explains the trial key', text(licensing).includes('TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE'));
const json = await call('froala_query_docs', { mode: 'licensing', response_format: 'json' });
check('json format returns JSON text', JSON.parse(text(json)).markdown.length > 100);

const integrations = await call('froala_get_integration', {});
check('integrations lists the guides', (integrations.structuredContent?.integrations ?? []).length >= 6);
const tailwind = await call('froala_get_integration', { name: 'tailwind' });
check('integrations returns the Tailwind guide', text(tailwind).includes('.fr-view'));

await client.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
