import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { SOURCE } from '../data.js';
import { FRAMEWORKS, newerNote, readProject } from '../project.js';
import { readCode } from '../check/context.js';
import { FILE_CHECKS, PROJECT_CHECKS, cssImportsIn, nuxtConfigCss, readAngularJson, type Finding, type Level, type Sent } from '../check/rules.js';
import { READ_ONLY, toolResult } from '../util.js';

export const MAX_TOTAL_CHARS = 200_000;
/** At most this many findings are returned, most serious first. */
export const MAX_FINDINGS = 60;

const input = z.object({
  files: z
    .array(
      z.object({
        path: z.string().max(300).describe('For example src/components/Editor.tsx, src/main.ts, index.html, angular.json or package.json'),
        content: z.string().max(100_000).describe('The whole file')
      })
    )
    .min(1)
    .max(20)
    .refine((files) => files.reduce((sum, f) => sum + f.content.length, 0) <= MAX_TOTAL_CHARS, {
      message: `Send at most ${MAX_TOTAL_CHARS.toLocaleString('en-US')} characters in total.`
    })
    .describe(
      'The files to check: every file you changed that uses Froala, the file that imports its plugins and CSS, and package.json. ' +
        'Add angular.json, nuxt.config.ts or a CSS file if Froala is set up there. Plugin, CSS and version checks look across all files you send.'
    ),
  framework: z.enum(FRAMEWORKS).optional().describe('The framework, if package.json is not sent')
});

const ORDER: Record<Level, number> = { error: 0, warning: 1, tip: 2 };
const CODE_FILE = /\.(m?[jt]sx?|cjs|vue|svelte|html?)$/i;

export function checkCode({ files, framework }: z.infer<typeof input>) {
  const sent: Sent = { files: [], configCss: [], configScripts: [], angularJson: false, nuxtConfig: false };
  const findings: Finding[] = [];
  const notChecked: string[] = [];

  // package.json and config files first, so the code checks know the project.
  for (const { path, content } of files) {
    if (/(^|\/)package\.json$/.test(path)) {
      try {
        sent.project = readProject(content);
      } catch (error) {
        notChecked.push(`${path}: ${(error as Error).message}`);
      }
    } else if (/(^|\/)angular\.json$/.test(path)) {
      const angular = readAngularJson(content);
      findings.push(...angular.findings.map((f) => ({ ...f, file: path })));
      sent.configCss.push(...angular.styles);
      sent.configScripts.push(...angular.scripts);
      sent.angularJson = true;
    } else if (/(^|\/)nuxt\.config\.[cm]?[jt]s$/.test(path)) {
      sent.configCss.push(...nuxtConfigCss(content));
      sent.nuxtConfig = true;
    } else if (/\.(css|scss|sass|less)$/i.test(path)) {
      sent.configCss.push(...cssImportsIn(content));
    }
  }
  // Angular templates in separate .html files name the settings the component class holds.
  const angularBindings = files
    .filter((f) => /\.html?$/i.test(f.path))
    .flatMap((f) => [...f.content.matchAll(/\[froalaEditor\]\s*=\s*"([^"]*)"/g)].map((m) => m[1]));
  for (const { path, content } of files) {
    if (/(^|\/)(package|angular)\.json$|(^|\/)nuxt\.config\.[cm]?[jt]s$|\.(css|scss|sass|less)$/i.test(path)) continue;
    if (!CODE_FILE.test(path) && !content.trim().startsWith('{')) {
      notChecked.push(`${path}: not a code file this tool reads.`);
      continue;
    }
    const ctx = readCode(content, path, framework ?? sent.project?.framework, { angularBindings });
    notChecked.push(...ctx.notChecked.map((note) => `${path}: ${note}`));
    if (ctx.parsed) sent.files.push(ctx);
  }

  for (const ctx of sent.files) {
    findings.push(...FILE_CHECKS.flatMap((check) => check(ctx).map((f) => ({ file: ctx.fileName, ...f }))));
  }
  findings.push(...PROJECT_CHECKS.flatMap((check) => check(sent)));
  findings.sort((a, b) => ORDER[a.level] - ORDER[b.level] || (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0));
  const shown = findings.slice(0, MAX_FINDINGS);

  const froalaFound = sent.angularJson || sent.files.some((f) => f.configs.length > 0 || f.createsEditor || f.paths.some((p) => /froala/i.test(p)));
  const count = (level: Level) => findings.filter((f) => f.level === level).length;
  const summary = { errors: count('error'), warnings: count('warning'), tips: count('tip') };
  const where = (f: Finding) => [f.file, f.line && `line ${f.line}`].filter(Boolean).join(', ');

  const lines = [`Checked ${files.length} file(s): ${files.map((f) => f.path).join(', ')}.`];
  if (findings.length === 0) lines.push(froalaFound ? 'No findings in the code checked.' : 'No Froala code found in these files.');
  else {
    lines.push(`${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.tips} tip(s). Errors are confirmed problems, warnings are likely problems to confirm, and tips are optional.`, '');
    lines.push(shown.map((f) => `[${f.level}] ${f.check}${where(f) ? ` (${where(f)})` : ''}\n${f.message}\nFix: ${f.fix}`).join('\n\n'));
    if (findings.length > shown.length) lines.push('', `${findings.length - shown.length} more finding(s) not shown. Fix these first, then check again.`);
  }
  if (notChecked.length) lines.push('', 'Not checked:', ...notChecked.map((n) => `- ${n}`));
  const newer = sent.project && newerNote(sent.project);
  if (newer) lines.push('', newer);
  if (!sent.project && froalaFound) lines.push('', 'Send package.json as well, so the checks can use the versions your project has.');
  if (froalaFound) lines.push('', 'These checks look for common Froala mistakes. Build and run the app to confirm it works.');

  return toolResult(lines.join('\n'), {
    ...SOURCE,
    files: files.map((f) => f.path),
    summary,
    findings: shown,
    findings_not_shown: findings.length - shown.length,
    not_checked: notChecked
  });
}

export const checkCodeTool = {
  names: ['froala_check_code'],
  instruction:
    'After writing or changing Froala code, call froala_check_code with the changed files and package.json. Review each finding: fix errors, confirm warnings apply before changing code, and treat tips as optional. Then build and run the app.',
  register(server: McpServer) {
    server.registerTool(
      'froala_check_code',
      {
        title: 'Check Froala code',
        description:
          'Checks Froala code for common mistakes and suggests a fix for each: wrong option, event or button names, wrong option values, plugins, CSS or helper libraries ' +
          'that are not loaded, imports that break with your Vite or Nuxt version, mismatched Froala package versions, server rendering in Next.js and Nuxt, ' +
          'event handler mistakes, Angular and Vue wiring, unsafe upload settings, outdated libraries and unpinned CDN links. Send the changed files together with package.json.',
        inputSchema: input,
        annotations: READ_ONLY
      },
      async (args) => checkCode(args)
    );
  }
};
