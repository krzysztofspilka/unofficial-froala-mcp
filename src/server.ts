import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { FROALA_VERSION } from './data.js';
import { registerPrompts } from './prompts.js';
import { setupTool } from './tools/setup.js';
import { presetsTool } from './tools/presets.js';
import { auditTool } from './tools/audit.js';
import { docsTool } from './tools/docs.js';
import { integrationsTool } from './tools/integrations.js';

export const VERSION: string = pkg.version;

/** The tools this server offers. Each line of the instructions comes from its tool. */
const TOOLS = [setupTool, presetsTool, auditTool, docsTool, integrationsTool];

/** Every tool name this server offers. */
export const TOOL_NAMES: string[] = TOOLS.flatMap((tool) => tool.names);

export const INSTRUCTIONS = [
  `Tools for the Froala rich text editor, with data from Froala ${FROALA_VERSION}.`,
  ...TOOLS.map((tool) => tool.instruction),
  'The tools return information and suggested code. Review it before changing files, and build and run the app to confirm the result.'
].join('\n');

/** Builds a fresh server with all tools and prompts. Both the hosted and the local version use it. */
export function createFroalaServer(): McpServer {
  const server = new McpServer({ name: 'froala-mcp-server', title: 'Froala', version: VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) tool.register(server);
  registerPrompts(server);
  return server;
}
