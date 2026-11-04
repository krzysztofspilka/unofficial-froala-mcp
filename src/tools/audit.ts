import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { SOURCE } from '../data.js';
import { TARGETS, describeProject, newerNote, readProject, type Answer, type Project, type Target } from '../project.js';
import { readCode } from '../audit/context.js';
import { FILE_CHECKS, PROJECT_CHECKS, cssImportsIn, nuxtConfigCss, readAngularJson, type Finding, type Level, type Sent } from '../audit/rules.js';
import { KNOWN_ISSUES, type KnownIssue } from '../audit/known-issues.js';
import { MAX_RESPONSE_CHARS, READ_ONLY, closestMany, moreLine, pageFacts, pageInputs, paginate, responseFormat, toolError, toolResult } from '../util.js';

export const MAX_TOTAL_CHARS = 200_000;
/** At most this many findings are returned, most serious first. */
export const MAX_FINDINGS = 60;

export const auditInput = z.strictObject({
  files: z
    .array(
      z.strictObject({
        path: z.string().max(300).describe('For example src/froala/froala-preset.ts, src/main.ts, index.html, angular.json or package.json'),
        content: z.string().max(100_000).describe('The whole file')
      })
    )
    .min(1)
    .max(20)
    .refine((files) => files.reduce((sum, f) => sum + f.content.length, 0) <= MAX_TOTAL_CHARS, { message: `Send at most ${MAX_TOTAL_CHARS.toLocaleString('en-US')} characters in total.` })
    .optional()
    .describe(
      'The files to audit. Send every file you changed that uses Froala, the file that imports its plugins and CSS, and package.json. Add angular.json, nuxt.config.ts or a CSS file if Froala is set up there.'
    ),
  package_json: z.string().max(50_000).optional().describe('The full package.json, when you do not send it in files. It selects the known issues for the project versions.'),
  target: z.enum(TARGETS).optional().describe('The kind of project, if package.json is not sent.'),
  symptom: z.string().min(2).max(200).optional().describe('What goes wrong, to search the known issues. Example: "blank page", "undo empties the document"'),
  issue: z.string().min(2).max(60).optional().describe('The id of one known issue, to read it in full. Example: "pasted-html-handlers"'),
  ...pageInputs(50, 20),
  response_format: responseFormat
});

const ORDER: Record<Level, number> = { error: 0, warning: 1, tip: 2 };
const CODE_FILE = /\.(m?[jt]sx?|cjs|vue|svelte|html?)$/i;

const describeIssue = (i: KnownIssue) => `## ${i.title} (${i.id})\nAffects ${i.affects}.\n\n${i.problem}\n\n${i.fix}\n\nChecked: ${i.tested}`;
const issueData = ({ id, title, affects, problem, fix, tested, enhancement }: KnownIssue, applies?: string) => ({
  id,
  title,
  affects,
  ...(applies ? { applies } : {}),
  ...(enhancement ? { enhancement } : {}),
  problem,
  fix,
  tested
});
const forTarget = (i: KnownIssue, target?: Target) => !target || i.targets === 'all' || i.targets.includes(target);

/** How many issues fit in the given number of characters. At least one is always returned. */
function fitting(issues: KnownIssue[], room: number): number {
  let used = 0;
  let count = 0;
  for (const issue of issues) {
    used += describeIssue(issue).length + 1;
    if (used > room && count > 0) break;
    count += 1;
  }
  return count;
}

function searchIssues(symptom: string): KnownIssue[] {
  const words = symptom
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  const score = (i: KnownIssue) => {
    const title = `${i.id} ${i.title}`.toLowerCase();
    const text = `${i.problem} ${i.affects}`.toLowerCase();
    return words.reduce((sum, word) => sum + (title.includes(word) ? 3 : 0) + (text.includes(word) ? 1 : 0), 0);
  };
  return KNOWN_ISSUES.map((issue) => ({ issue, points: score(issue) }))
    .filter(({ points }) => points > 0)
    .sort((a, b) => b.points - a.points)
    .map(({ issue }) => issue);
}

/** Runs the code checks on the files. package.json and config files go first, so the checks know the project. */
function auditFiles(files: { path: string; content: string }[], target: Target | undefined, project: Project | undefined) {
  const sent: Sent = { files: [], project, configCss: [], configScripts: [], angularJson: false, nuxtConfig: false };
  const findings: Finding[] = [];
  const notChecked: string[] = [];
  for (const { path, content } of files) {
    if (/(^|\/)package\.json$/.test(path)) {
      try {
        sent.project = readProject(content, target);
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
  const angularBindings = Object.fromEntries(
    files.filter((f) => /\.html?$/i.test(f.path)).map((f) => [f.path.split('/').pop()!, [...f.content.matchAll(/\[froalaEditor\]\s*=\s*"([^"]*)"/g)].map((m) => m[1])])
  );
  const contexts = [];
  for (const { path, content } of files) {
    if (/(^|\/)(package|angular)\.json$|(^|\/)nuxt\.config\.[cm]?[jt]s$|\.(css|scss|sass|less)$/i.test(path)) continue;
    if (!CODE_FILE.test(path) && !content.trim().startsWith('{')) {
      notChecked.push(`${path}: this is not a code file this tool reads.`);
      continue;
    }
    try {
      contexts.push(readCode(content, path, target ?? sent.project?.target, { angularBindings }));
    } catch {
      notChecked.push(`${path}: this file could not be read.`);
    }
  }
  // A button registered in one file is valid in the settings of another.
  const registered = contexts.flatMap((ctx) => [...ctx.registeredCommands]);
  for (const ctx of contexts) registered.forEach((name) => ctx.registeredCommands.add(name));
  // Settings named in one file and defined in another one that was sent count as checked.
  const definedElsewhere = new Set(contexts.flatMap((ctx) => [...ctx.settingsNames]));
  for (const ctx of contexts) {
    notChecked.push(...ctx.notChecked.map((note) => `${ctx.fileName}: ${note}`));
    notChecked.push(...ctx.defined.filter(({ name }) => !definedElsewhere.has(name)).map(({ note }) => `${ctx.fileName}: ${note}`));
    if (ctx.parsed) sent.files.push(ctx);
  }
  for (const ctx of sent.files) findings.push(...FILE_CHECKS.flatMap((check) => check(ctx).map((f) => ({ file: ctx.fileName, ...f }))));
  findings.push(...PROJECT_CHECKS.flatMap((check) => check(sent)));
  findings.sort((a, b) => ORDER[a.level] - ORDER[b.level] || (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0));
  return { sent, findings, notChecked };
}

/** The known issues for a project. Code that was sent narrows them down, and installed enhancements remove theirs. */
function issuesFor(project: Project | undefined, target: Target | undefined, code: string | undefined) {
  const enhanced = code !== undefined && /installFroalaEnhancements\s*\(/.test(code);
  const skipped = new Set(code?.match(/skip\s*:\s*\[([^\]]*)\]/)?.[1].match(/\w+/g) ?? []);
  const sure: KnownIssue[] = [];
  const maybe: KnownIssue[] = [];
  for (const issue of KNOWN_ISSUES) {
    if (!forTarget(issue, target ?? project?.target)) continue;
    if (issue.enhancement && enhanced && !skipped.has(issue.enhancement)) continue;
    const answer: Answer = project ? issue.applies(project) : 'unknown';
    if (answer === 'no') continue;
    const inCode = issue.codeMatch && code !== undefined ? issue.codeMatch.test(code) : undefined;
    if (inCode === false) continue;
    (inCode || answer === 'yes' ? sure : maybe).push(issue);
  }
  return { sure, maybe };
}

export function audit({ files, package_json, target, symptom, issue, limit = 20, offset = 0, response_format: format }: z.input<typeof auditInput>) {
  if (issue) {
    const found = KNOWN_ISSUES.find((i) => i.id === issue);
    if (found) return toolResult(describeIssue(found), { ...SOURCE, issues: [issueData(found)] }, format);
    const suggestions = closestMany(
      issue,
      KNOWN_ISSUES.map((i) => i.id)
    );
    return toolError(`There is no known issue called "${issue}".${suggestions.length ? ` Did you mean ${suggestions.join(', ')}?` : ''} Call froala_audit_code with a symptom to search.`);
  }
  if (symptom) {
    const found = searchIssues(symptom).filter((i) => forTarget(i, target));
    const wanted = paginate(found, limit, offset).items;
    const page = paginate(found, fitting(wanted, MAX_RESPONSE_CHARS - 500), offset);
    const text = found.length
      ? [`Known issues that match "${symptom}".`, '', ...page.items.map(describeIssue), '', moreLine(page)].join('\n').trim()
      : `No known issue matches "${symptom}". Send the files and package.json for a full audit, or search the docs with froala_query_docs.`;
    return toolResult(text, { ...SOURCE, ...pageFacts(page), issues: page.items.map((i) => issueData(i)) }, format);
  }
  let project: Project | undefined;
  if (package_json) {
    try {
      project = readProject(package_json, target);
    } catch (error) {
      return toolError((error as Error).message);
    }
  }
  if (!files && !project && !target) {
    return toolError('Send files, package_json, target, symptom or issue. For example, call froala_audit_code with files set to the Froala files of the project and package.json.');
  }
  const { sent, findings, notChecked } = files ? auditFiles(files, target, project) : { sent: undefined, findings: [] as Finding[], notChecked: [] as string[] };
  project = sent?.project ?? project;
  const shown = findings.slice(0, MAX_FINDINGS);
  // The enhancements file names itself in its own comments, so it does not count as project code.
  const codeFiles = files?.filter((f) => !/\.json$/.test(f.path) && !/froala-enhancements\.[jt]s$/.test(f.path)) ?? [];
  const code = codeFiles.length ? codeFiles.map((f) => f.content).join('\n') : undefined;
  const { sure, maybe } = issuesFor(project, target, code);

  const froalaFound = !!sent && (sent.angularJson || sent.files.some((f) => f.configs.length > 0 || f.createsEditor || f.paths.some((p) => /froala/i.test(p))));
  const count = (level: Level) => findings.filter((f) => f.level === level).length;
  const summary = { errors: count('error'), warnings: count('warning'), tips: count('tip') };
  const where = (f: Finding) => [f.file, f.line && `line ${f.line}`].filter(Boolean).join(', ');

  const lines: string[] = [];
  if (files) {
    lines.push(`Audited ${files.length} file(s): ${files.map((f) => f.path).join(', ')}.`);
    if (findings.length === 0) lines.push(froalaFound ? 'No findings in the code checked.' : 'No Froala code found in these files.');
    else {
      lines.push(
        `${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.tips} tip(s). Errors are confirmed problems, warnings are likely problems to confirm, and tips are optional.`,
        ''
      );
      lines.push(shown.map((f) => `[${f.level}] ${f.check}${where(f) ? ` (${where(f)})` : ''}\n${f.message}\nFix: ${f.fix}`).join('\n\n'));
      if (findings.length > shown.length) lines.push('', `${findings.length - shown.length} more finding(s) not shown. Fix these first, then audit again.`);
    }
    if (notChecked.length) lines.push('', 'Not checked:', ...notChecked.map((n) => `- ${n}`));
  } else if (project) {
    lines.push(`Project: ${describeProject(project) || 'no framework packages found'}.`);
  }
  const newer = project && newerNote(project);
  if (newer) lines.push('', newer);
  if (!project && froalaFound) lines.push('', 'Send package.json as well, so the checks can use the versions your project has.');
  const closing = [
    ...(maybe.length
      ? ['', `These may apply, depending on your code (${maybe.length}). Call froala_audit_code with issue set to an id for the details.`, ...maybe.map((i) => `- ${i.id}: ${i.title}`)]
      : []),
    ...(froalaFound ? ['', 'These checks look for common Froala mistakes. Build and run the app to confirm it works.'] : [])
  ];
  // Findings and the list of possible issues always fit. Known issues take the room that is left, and the rest come with offset.
  const room = MAX_RESPONSE_CHARS - lines.join('\n').length - closing.join('\n').length - 500;
  const page = paginate(sure, fitting(paginate(sure, limit, offset).items, room), offset);
  if (sure.length) lines.push('', `Known issues that apply to this project (${sure.length}).`, '', ...page.items.map(describeIssue));
  const more = moreLine(page);
  if (more) lines.push('', more);
  lines.push(...closing);

  return toolResult(
    lines.join('\n').trim(),
    {
      ...SOURCE,
      files: files?.map((f) => f.path) ?? [],
      summary,
      findings: shown,
      findings_not_shown: findings.length - shown.length,
      not_checked: notChecked,
      project: project ? describeProject(project) : null,
      newer_note: newer ?? null,
      ...pageFacts(page),
      issues: page.items.map((i) => issueData(i, 'yes')),
      issues_to_check: maybe.map(({ id, title }) => ({ id, title }))
    },
    format
  );
}

export const auditTool = {
  names: ['froala_audit_code'],
  instruction:
    'After writing or changing Froala code, or when it fails with a blank page or a build error, call froala_audit_code with the changed files and package.json. Fix errors, confirm warnings before changing code, and treat tips as optional. Then build and run the app.',
  register(server: McpServer) {
    server.registerTool(
      'froala_audit_code',
      {
        title: 'Froala Code Audit',
        description:
          'Use this after writing Froala code, and whenever Froala code fails. It finds wrong option, event and button names, wrong option values, plugins, CSS and helper libraries that are not loaded, imports that break with your bundler, mismatched Froala versions, server rendering problems, and unsafe settings, and it suggests a fix for each. ' +
          'It also returns the known Froala issues that apply to the project versions, with tested fixes. Send the changed files together with package.json. Use symptom to search known issues, and issue to read one. Use froala_get_setup for new setup code and froala_query_docs for API names. ' +
          'Examples: { files: [{ path: "src/Editor.tsx", content: "..." }, { path: "package.json", content: "..." }] } and { symptom: "blank page", target: "react" }.',
        inputSchema: auditInput,
        annotations: READ_ONLY
      },
      async (args) => audit(args)
    );
  }
};
