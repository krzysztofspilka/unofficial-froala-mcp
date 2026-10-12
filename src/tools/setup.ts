import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { SOURCE } from '../data.js';
import { getSetup } from '../templates/index.js';
import { FRAMEWORKS, describeProject, newProject, newerNote, readProject, type Project } from '../project.js';
import { READ_ONLY, toolError, toolResult } from '../util.js';

const input = z.object({
  framework: z
    .enum(FRAMEWORKS)
    .describe('The framework to set up Froala in. "vanilla" is plain TypeScript or JavaScript with npm and a bundler such as Vite; "cdn" is a single HTML page.'),
  package_json: z
    .string()
    .max(50_000)
    .optional()
    .describe('The full package.json of the project. The code then matches its versions of Froala, Vite, Nuxt, Angular and so on. Without it, the code is for a project created today.'),
  typescript: z.boolean().optional().describe('Use TypeScript. Default: read from package.json, otherwise true.'),
  plugins: z.enum(['essentials', 'all']).optional().describe('"essentials" (default) loads a small set of plugins; "all" loads every plugin')
});

export function setup({ framework, package_json, typescript, plugins = 'essentials' }: z.infer<typeof input>) {
  let project: Project;
  try {
    project = package_json ? readProject(package_json) : newProject(framework, typescript ?? true);
  } catch (error) {
    return toolError((error as Error).message);
  }
  const detected = project.framework;
  project = { ...project, framework };
  const useTypescript = typescript ?? (package_json ? project.typescript : true);
  const s = getSetup(framework, { typescript: useTypescript, plugins, project });

  const notes = [...s.notes];
  if (detected && detected !== framework && framework !== 'cdn') {
    notes.unshift(`Your package.json looks like a ${detected} project. If that's right, call froala_get_setup again with framework "${detected}".`);
  }
  const newer = newerNote(project);
  if (newer) notes.unshift(newer);
  const basedOn = package_json
    ? `Based on your package.json: ${describeProject(project) || 'no framework packages found'}.`
    : `Written for a new project (${describeProject(project)}). Send package_json to match your versions.`;

  const language = ['angular', 'cdn'].includes(framework) ? '' : useTypescript ? ' with TypeScript' : ' with JavaScript';
  const text = [
    `Froala ${s.froala_version} setup for ${framework}${language}. ${framework === 'cdn' ? '' : basedOn}`.trim(),
    '',
    `Install: ${s.install}`,
    '',
    ...s.files.flatMap((f) => [`File ${f.path}:`, '```', f.content.trimEnd(), '```', '']),
    'Notes:',
    ...notes.map((n) => `- ${n}`),
    '',
    `Docs: ${s.docs_url}`,
    'After creating the files, call froala_check_code with the files you changed and package.json, then build and run the app.'
  ].join('\n');
  return toolResult(text, { ...SOURCE, ...s, notes, project: framework === 'cdn' ? null : basedOn });
}

export const setupTool = {
  names: ['froala_get_setup'],
  instruction: "Before writing Froala setup code, call froala_get_setup with the project's package.json.",
  register(server: McpServer) {
    server.registerTool(
      'froala_get_setup',
      {
        title: 'Get Froala setup code',
        description:
          'Returns the install command, the files to create and short notes to add the Froala editor to a React, Vue, Angular, Next.js, Nuxt, Svelte, ' +
          'plain TypeScript or JavaScript project, or a single HTML page. Send package.json so the code fits the versions the project uses.',
        inputSchema: input,
        annotations: READ_ONLY
      },
      async (args) => setup(args)
    );
  }
};
