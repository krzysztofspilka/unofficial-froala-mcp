// Guides for using Froala with other tools. Each one is a Markdown file in content/integrations,
// so adding a file adds an integration, with no code to change.
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { content, SOURCE } from '../data.js';
import { TARGETS } from '../project.js';
import { READ_ONLY, closest, responseFormat, toolError, toolResult } from '../util.js';

export const integrationsInput = z.strictObject({
  name: z.string().min(2).max(60).optional().describe('The integration to read. Leave it out to list them. Example: "tailwind"'),
  target: z.enum(TARGETS).optional().describe('When listing, only show integrations for this kind of project.'),
  response_format: responseFormat
});

export function getIntegration({ name, target, response_format: format = 'markdown' }: z.input<typeof integrationsInput>) {
  const { integrations } = content;
  if (!name) {
    const list = target ? integrations.filter((i) => i.targets.includes(target)) : integrations;
    const text = [
      `Froala integrations${target ? ` for ${target}` : ''}.`,
      '',
      ...list.map((i) => `- ${i.id}: ${i.title}. ${i.summary}`),
      '',
      'Call froala_get_integration with name to read one.'
    ].join('\n');
    return toolResult(text, { ...SOURCE, integrations: list.map(({ id, title, summary, targets }) => ({ id, title, summary, targets })) }, format);
  }
  const found = integrations.find((i) => i.id === name.toLowerCase());
  if (!found) {
    const suggestion = closest(
      name.toLowerCase(),
      integrations.map((i) => i.id)
    );
    return toolError(`There is no integration called "${name}".${suggestion ? ` Did you mean "${suggestion}"?` : ''} The list is ${integrations.map((i) => i.id).join(', ')}.`);
  }
  return toolResult(
    `${found.markdown}\n\nChecked. ${found.checked}`,
    { ...SOURCE, id: found.id, title: found.title, targets: found.targets, checked: found.checked, markdown: found.markdown },
    format
  );
}

export const integrationsTool = {
  names: ['froala_get_integration'],
  instruction: 'When the project uses another tool with Froala, such as Tailwind, TanStack or Salesforce, call froala_get_integration for its guide.',
  register(server: McpServer) {
    server.registerTool(
      'froala_get_integration',
      {
        title: 'Froala Integrations',
        description:
          `Use this when Froala has to work with another tool. It returns a guide with code for ${content.integrations.map((i) => i.title).join(', ')}. With no input it lists every integration. ` +
          'Use froala_get_setup first to add the editor itself. Examples: { name: "tailwind" } and { target: "react" }.',
        inputSchema: integrationsInput,
        annotations: READ_ONLY
      },
      async (args) => getIntegration(args)
    );
  }
};
