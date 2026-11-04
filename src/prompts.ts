import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { TARGETS } from './project.js';

const userMessage = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'add-froala',
    {
      title: 'Add Froala to this project',
      description: 'Sets up the Froala editor in the current project, audits the result and starts the app.',
      argsSchema: z.object({
        target: z.enum(TARGETS).describe('The kind of project'),
        use_case: z.string().optional().describe('What the editor is for, for example comments, chat, email or documents')
      })
    },
    ({ target, use_case }) => {
      const steps = [
        use_case && `Call froala_find_presets with the query "${use_case}" and pick the closest preset.`,
        `Call froala_get_setup with target "${target}", this project's package.json${use_case ? ' and the preset id' : ''}.`,
        'Install the packages, create the files, and follow the notes.',
        'Call froala_audit_code with the files you changed and package.json. Fix the errors, and confirm a warning applies before changing code.',
        'Build the app and start the dev server to confirm the editor appears.'
      ].filter(Boolean);
      return userMessage(
        `Add the Froala editor to this ${target} project.\n${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\nThe preset uses the public trial key while I try it. Tell me where my own key goes later, keep any commercial key the project already sets, and never make one up.`
      );
    }
  );

  server.registerPrompt(
    'review-froala',
    {
      title: 'Review Froala code',
      description: 'Finds the files that use Froala, audits them and fixes what it finds.'
    },
    () =>
      userMessage(
        [
          'Find every file in this project that uses Froala, which means imports of froala-editor or a Froala wrapper, or Froala settings.',
          'Call froala_audit_code with those files and package.json.',
          'Show me the findings first. Then fix the errors. For warnings and known issues, change only what you have confirmed applies, and keep the app working the same way.',
          'Build and run the app afterwards, and summarise what changed.'
        ].join('\n')
      )
  );
}
