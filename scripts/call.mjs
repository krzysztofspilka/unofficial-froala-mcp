// Calls the Froala MCP server from the command line. Useful for trying a tool, and for AI agents
// that can run shell commands but cannot connect to MCP servers.
//
//   node scripts/call.mjs tools                      the server instructions and every tool with its inputs
//   node scripts/call.mjs froala_get_setup target=react package_json=@package.json
//   node scripts/call.mjs froala_audit_code files=@src/Editor.tsx,@package.json
//
// A value is plain text, JSON (true, 3, ["a"]) or @path to read a file. For froala_audit_code,
// files= takes a comma-separated list of @paths.
// The server is dist/stdio.js (run npm run build first), or the URL in FROALA_MCP_URL.
// Set FROALA_MCP_LOG to a file path to record each call there.
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [command, ...pairs] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/call.mjs tools | <tool name> [name=value ...]');
  process.exit(1);
}

const readValue = (value) => {
  if (value.startsWith('@')) return readFileSync(value.slice(1), 'utf8');
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const args = {};
for (const pair of pairs) {
  const at = pair.indexOf('=');
  const name = pair.slice(0, at);
  const value = pair.slice(at + 1);
  args[name] =
    command === 'froala_audit_code' && name === 'files' ? value.split(',').map((path) => ({ path: path.replace(/^@/, ''), content: readFileSync(path.replace(/^@/, ''), 'utf8') })) : readValue(value);
}

const url = process.env.FROALA_MCP_URL;
const server = join(dirname(fileURLToPath(import.meta.url)), '../dist/stdio.js');
const transport = url ? new StreamableHTTPClientTransport(new URL(url)) : new StdioClientTransport({ command: process.execPath, args: [server], stderr: 'ignore' });
const client = new Client({ name: 'froala-mcp-call', version: '1.0.0' });
await client.connect(transport);

if (process.env.FROALA_MCP_LOG) {
  appendFileSync(process.env.FROALA_MCP_LOG, JSON.stringify({ time: new Date().toISOString(), call: command, args: Object.keys(args) }) + '\n');
}

if (command === 'tools') {
  console.log(`Server instructions:\n${client.getInstructions?.() ?? ''}\n`);
  const { tools } = await client.listTools();
  for (const tool of tools) {
    console.log(`## ${tool.name}\n${tool.description}\nInputs: ${JSON.stringify(tool.inputSchema.properties ?? {}, null, 1)}\n`);
  }
} else {
  const result = await client.callTool({ name: command, arguments: args });
  console.log(result.content.map((c) => c.text ?? '').join('\n'));
  if (result.isError) process.exitCode = 1;
}
await client.close();
