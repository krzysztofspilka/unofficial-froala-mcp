import type { McpServer } from '@modelcontextprotocol/server';
import licensingText from '../../content/licensing.md';
import { SOURCE } from '../data.js';
import { READ_ONLY, toolResult } from '../util.js';

/** The text of content/licensing.md, without its HTML comments. */
export function licensing() {
  const text = licensingText.replace(/<!--[\s\S]*?-->/g, '').trim();
  return toolResult(text, { ...SOURCE, reviewed: '2026-10-12', markdown: text });
}

export const licensingTool = {
  names: ['froala_licensing'],
  instruction:
    'Froala is free to try: it works fully on localhost without a key. Before deploying anywhere else, the project needs a free trial key or a licence key; froala_licensing explains this. Never ask for or show licence keys.',
  register(server: McpServer) {
    server.registerTool(
      'froala_licensing',
      {
        title: 'Try Froala and add a licence key',
        description: 'Explains how to try Froala for free, where the licence key goes in each framework, and where to get a licence.',
        annotations: READ_ONLY
      },
      async () => licensing()
    );
  }
};
