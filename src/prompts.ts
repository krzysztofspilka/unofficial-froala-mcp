import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { FRAMEWORKS } from './project.js';

const userMessage = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

/** Which optional tools are available, so the prompts only mention tools that exist. */
interface Available {
  workarounds: boolean;
  recipes: boolean;
}

export function registerPrompts(server: McpServer, available: Available) {
  server.registerPrompt(
    'add-froala',
    {
      title: 'Add Froala to this project',
      description: 'Sets up the Froala editor in the current project, checks the result and starts the app.',
      argsSchema: z.object({
        framework: z.enum(FRAMEWORKS).describe('The framework of the current project'),
        use_case: z.string().optional().describe('What the editor is for, for example comments, chat, email or documents')
      })
    },
    ({ framework, use_case }) => {
      const steps = [
        "Call froala_get_setup for this framework with this project's package.json.",
        available.recipes && use_case && `Call froala_recipes for the closest match to "${use_case}" and use its settings and plugins.`,
        'Install the packages, create or update the files, and follow the notes.',
        'Call froala_check_code with the files you changed and package.json. Fix the errors, and confirm a warning applies before changing code.',
        'Build the app and start the dev server to confirm the editor appears.'
      ].filter(Boolean);
      return userMessage(
        `Add the Froala editor to this ${framework} project.\n` +
          steps.map((step, i) => `${i + 1}. ${step}`).join('\n') +
          '\nFroala works without a licence key while I try it. Tell me where the key goes later; never make one up.'
      );
    }
  );

  server.registerPrompt(
    'review-froala',
    {
      title: 'Review Froala code',
      description: 'Finds the files that use Froala, checks each one and fixes what it finds.'
    },
    () =>
      userMessage(
        [
          'Find every file in this project that uses Froala: imports of froala-editor or a Froala wrapper, or Froala settings.',
          'Call froala_check_code with those files and package.json.',
          available.workarounds && "Call froala_workarounds with this project's package.json for known problems with its versions.",
          'Show me the findings first. Then fix the errors, and for warnings and workarounds change only what you have confirmed applies, keeping the app working the same way.',
          'Build and run the app afterwards, and summarise what changed.'
        ]
          .filter(Boolean)
          .join('\n')
      )
  );
}
