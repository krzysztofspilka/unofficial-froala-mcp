import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { SOURCE } from '../data.js';
import { DEFAULT_PRESET, PRESETS } from '../presets.js';
import { getSetup } from '../setup/index.js';
import { TARGETS, describeProject, newProject, newerNote, readProject, unsupportedMessage, type Project } from '../project.js';
import { READ_ONLY, closest, responseFormat, toolError, toolResult } from '../util.js';

export const setupInput = z.strictObject({
  target: z.enum(TARGETS).describe('The kind of project. "typescript" and "javascript" mean no framework. Example: "react"'),
  package_json: z
    .string()
    .max(50_000)
    .optional()
    .describe('The full package.json of the project. The code then fits its versions. Without it, the code is for a project created today, and "javascript" gives a page with no build step.'),
  preset: z
    .string()
    .min(1)
    .max(60)
    .default(DEFAULT_PRESET)
    .describe(`The preset id from froala_find_presets. Default "${DEFAULT_PRESET}", the toolbar on the Froala website with undo and redo first.`),
  typescript: z.boolean().optional().describe('For React, Vue, Next.js, Nuxt and Svelte. Default is read from package.json, otherwise true.'),
  response_format: responseFormat
});

export function setup({ target, package_json, preset: presetId, typescript, response_format: format }: z.input<typeof setupInput>) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (presetId && !preset) {
    const suggestion = closest(
      presetId,
      PRESETS.map((p) => p.id)
    );
    return toolError(`There is no preset called "${presetId}".${suggestion ? ` Did you mean "${suggestion}"?` : ''} Call froala_find_presets to list them.`);
  }
  let project: Project;
  try {
    project = package_json ? readProject(package_json) : newProject(target, typescript ?? true);
  } catch (error) {
    return toolError((error as Error).message);
  }
  if (project.unsupported) return toolError(unsupportedMessage(project.unsupported));
  const detected = project.target;
  project = { ...project, target };
  const useTypescript = target === 'typescript' ? true : target === 'javascript' ? false : (typescript ?? (package_json ? project.typescript : true));
  const chosen = preset ?? PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
  const s = getSetup(target, { typescript: useTypescript, preset: chosen, project });

  const notes = [...s.notes];
  if (detected && detected !== target) notes.unshift(`Your package.json looks like a ${detected} project. If that is right, call froala_get_setup again with target "${detected}".`);
  const newer = newerNote(project);
  if (newer) notes.unshift(`${newer} This setup keeps your version.`);
  const basedOn = package_json
    ? `Based on your package.json: ${describeProject(project) || 'no framework packages found'}.`
    : 'Written for a project created today. Send package_json to match your versions.';

  const text = [
    `Froala ${s.froala_version} setup for ${target} with the ${chosen.title} preset. ${basedOn}`,
    '',
    `Install: ${s.install}`,
    '',
    ...s.files.flatMap((f) => [`File ${f.path}:`, '```', f.content.trimEnd(), '```', '']),
    'Notes:',
    ...notes.map((n) => `- ${n}`),
    '',
    `Docs: ${s.docs_url}`,
    'After creating the files, call froala_audit_code with the files you changed and package.json, then build and run the app.'
  ].join('\n');
  return toolResult(text, { ...SOURCE, ...s, notes, project: basedOn }, format);
}

export const setupTool = {
  names: ['froala_get_setup'],
  instruction: "Before writing Froala setup code, call froala_get_setup with the project's package.json. It gives the install command and the files to create.",
  register(server: McpServer) {
    server.registerTool(
      'froala_get_setup',
      {
        title: 'Froala Setup',
        description:
          'Use this first when adding the Froala editor to a project. It returns the install command, the files to create and short notes for React, Vue, Angular, Next.js, Nuxt, Svelte, TypeScript or JavaScript. ' +
          'The default Simple preset has the toolbar of the Froala website, with undo and redo first, and one froala-enhancements file that adds safe pasting, keyboard access and screen reader names. ' +
          "The preset uses Froala's public trial key unless the project sets its own key. Never replace a commercial key, even an expired one. " +
          'Send package.json so the code fits the versions the project uses. Use froala_find_presets to choose another preset, then pass its id here. ' +
          'Examples: { target: "react", package_json: "{...}" } and { target: "vue", preset: "comment-box" }.',
        inputSchema: setupInput,
        annotations: READ_ONLY
      },
      async (args) => setup(args)
    );
  }
};
