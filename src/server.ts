import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { FROALA_VERSION } from './data.js';
import { registerPrompts } from './prompts.js';
import { setupTool } from './tools/setup.js';
import { recipesTool } from './tools/recipes.js';
import { workaroundsTool } from './tools/workarounds.js';
import { checkCodeTool } from './tools/check-code.js';
import { lookupTool } from './tools/lookup.js';
import { docsTools } from './tools/docs.js';
import { licensingTool } from './tools/licensing.js';

export const VERSION: string = pkg.version;

/**
 * The tools this server offers. To remove one (for example workarounds, once a release fixes them all),
 * delete it from this list. Its line in the instructions and its step in the prompts go with it.
 */
const TOOLS = [setupTool, recipesTool, checkCodeTool, workaroundsTool, lookupTool, docsTools, licensingTool];

/** Every tool name this server offers. */
export const TOOL_NAMES: string[] = TOOLS.flatMap((tool) => tool.names);

export const INSTRUCTIONS = [
  `Tools for the Froala WYSIWYG editor, with data from Froala ${FROALA_VERSION}.`,
  ...TOOLS.map((tool) => tool.instruction),
  'The tools return information and suggested code. Review it before changing files, and build and run the app to confirm the result.'
].join('\n');

/** Builds a fresh server with all tools and prompts. Used by both the hosted and the local version. */
export function createFroalaServer(): McpServer {
  const server = new McpServer({ name: 'froala', title: 'Froala', version: VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) tool.register(server);
  registerPrompts(server, { workarounds: TOOLS.includes(workaroundsTool), recipes: TOOLS.includes(recipesTool) });
  return server;
}
