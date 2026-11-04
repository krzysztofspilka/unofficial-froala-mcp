// Checks that every answer in eval/questions.xml is in the tool answer named by its check, so the questions stay
// true as the data changes. To measure a model, give it the questions and the tools, and compare its answers.
//
//   npm run build
//   npm run test:eval
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const folder = path.dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(path.join(folder, 'questions.xml'), 'utf8');
const pairs = [...xml.matchAll(/<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>\s*<check tool="([^"]+)" args='([^']+)'\/>/g)].map(([, question, answer, tool, args]) => ({
  question,
  answer,
  tool,
  args: JSON.parse(args)
}));

const client = new Client({ name: 'froala-questions', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(folder, '../dist/stdio.js')], stderr: 'ignore' }));

let failures = 0;
for (const { question, answer, tool, args } of pairs) {
  const result = await client.callTool({ name: tool, arguments: args });
  const found = result.content
    .map((part) => part.text ?? '')
    .join('\n')
    .includes(answer);
  if (!found) failures += 1;
  console.log(`${found ? 'ok  ' : 'FAIL'} ${question}`);
}
await client.close();
console.log(failures ? `\n${failures} of ${pairs.length} answers were not found.` : `\nAll ${pairs.length} answers were found.`);
if (failures || pairs.length < 10) process.exitCode = 1;
