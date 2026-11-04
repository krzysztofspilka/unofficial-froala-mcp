// The facts about the user's project, read from its package.json. froala_get_setup uses them to write
// code that fits the project's versions, and froala_audit_code uses them to pick the checks that apply.
import semver from 'semver';
import { FROALA_VERSION } from './data.js';

/** The kinds of project this server supports. "typescript" and "javascript" mean no framework. */
export const TARGETS = ['react', 'vue', 'angular', 'nextjs', 'nuxt', 'svelte', 'typescript', 'javascript'] as const;
export type Target = (typeof TARGETS)[number];

/** 'unknown' when package.json does not say, for example when a version is a tag such as "latest". */
export type Answer = 'yes' | 'no' | 'unknown';

export interface Project {
  /** False when no package.json was sent, so the project is taken to be one created today. */
  fromPackageJson: boolean;
  target?: Target;
  /** The name of a framework this server does not support, such as "Next.js", when package.json lists one. */
  unsupported?: string;
  typescript: boolean;
  /** "type": "module" in package.json. Every current starter sets it. */
  isModule: boolean;
  has: (name: string) => boolean;
  /** The text in package.json, such as "^8.3.4". npm decides the installed version, so decisions use this and not version(). */
  range: (name: string) => string | undefined;
  /** The lowest version the range allows ("^8.3.4" gives "8.3.4"), for messages. It is not always the installed version. */
  version: (name: string) => string | undefined;
}

export const FROALA_PACKAGES = ['froala-editor', 'react-froala-wysiwyg', 'vue-froala-wysiwyg', 'angular-froala-wysiwyg', 'svelte-froala-wysiwyg'];

/** The wrapper package each framework uses. */
export const WRAPPER_FOR: Partial<Record<Target, string>> = {
  react: 'react-froala-wysiwyg',
  nextjs: 'react-froala-wysiwyg',
  vue: 'vue-froala-wysiwyg',
  nuxt: 'vue-froala-wysiwyg',
  angular: 'angular-froala-wysiwyg',
  svelte: 'svelte-froala-wysiwyg'
};

function lowestVersion(range: string): string | undefined {
  try {
    return semver.minVersion(range)?.version;
  } catch {
    return undefined; // a tag, a URL, a file or workspace link, or a typo
  }
}

// Frameworks this server has no setup for.
const UNSUPPORTED_PACKAGES: [string, string][] = [
  ['astro', 'Astro'],
  ['solid-js', 'SolidJS'],
  ['@remix-run/react', 'Remix']
];

// The first package found decides the target (Next.js projects also list react, so next comes first).
const TARGET_PACKAGES: [string, Target][] = [
  ['next', 'nextjs'],
  ['nuxt', 'nuxt'],
  ['@angular/core', 'angular'],
  ['svelte', 'svelte'],
  ['vue', 'vue'],
  ['react', 'react']
];

function fromDependencies(deps: Record<string, string>, extra: Pick<Project, 'fromPackageJson' | 'isModule'> & { target?: Target }): Project {
  const has = (name: string) => name in deps;
  const typescript = has('typescript');
  return {
    ...extra,
    target: extra.target ?? TARGET_PACKAGES.find(([name]) => has(name))?.[1] ?? (has('vite') ? (typescript ? 'typescript' : 'javascript') : undefined),
    unsupported: UNSUPPORTED_PACKAGES.find(([name]) => has(name))?.[1],
    typescript,
    has,
    range: (name) => deps[name],
    version: (name) => (has(name) ? lowestVersion(deps[name]) : undefined)
  };
}

/** Reads package.json. Throws an Error with a short explanation if it is not a package.json. */
export function readProject(packageJson: string, target?: Target): Project {
  let pkg: unknown;
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    throw new Error('package_json is not valid JSON. Send the whole file as it is.');
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package_json must be a JSON object, the content of package.json.');
  const fields = pkg as Record<string, unknown>;
  const deps: Record<string, string> = {};
  for (const field of ['peerDependencies', 'devDependencies', 'dependencies']) {
    const list = fields[field];
    if (list && typeof list === 'object') {
      for (const [name, range] of Object.entries(list)) if (typeof range === 'string') deps[name] = range;
    }
  }
  return fromDependencies(deps, { target, fromPackageJson: true, isModule: fields.type === 'module' });
}

/** What each official starter installs today (checked 4 November 2026). Used when no package.json is sent. */
const STARTERS: Record<Target, Record<string, string>> = {
  react: { react: '19.3.1', vite: '8.3.5' },
  vue: { vue: '3.5.44', vite: '8.3.5' },
  angular: { '@angular/core': '22.2.4' },
  nextjs: { next: '16.4.5', react: '19.3.1', tailwindcss: '4.3.4' },
  nuxt: { nuxt: '4.6.4', vue: '3.5.44' },
  svelte: { svelte: '5.57.3', '@sveltejs/kit': '3.1.1', vite: '8.3.5' },
  typescript: { vite: '8.3.5' },
  javascript: { vite: '8.3.5' }
};

export function newProject(target: Target, typescript = true): Project {
  const deps = { ...STARTERS[target], ...(typescript ? { typescript: '7.0.2' } : {}) };
  return fromDependencies(deps, { target, fromPackageJson: false, isModule: target !== 'angular' });
}

/** A short description of the versions that matter, for example "React 19.3.1, Vite 8.3.5, TypeScript". */
export function describeProject(p: Project): string {
  const names: [string, string][] = [
    ['next', 'Next.js'],
    ['nuxt', 'Nuxt'],
    ['@angular/core', 'Angular'],
    ['@sveltejs/kit', 'SvelteKit'],
    ['svelte', 'Svelte'],
    ['vue', 'Vue'],
    ['react', 'React'],
    ['vite', 'Vite'],
    ['froala-editor', 'froala-editor']
  ];
  const parts = names.filter(([pkg]) => p.has(pkg)).map(([pkg, label]) => `${label} ${p.version(pkg) ?? '(version not readable)'}`);
  if (p.has('@angular/ssr')) parts.push('server rendering');
  if (p.typescript) parts.push('TypeScript');
  if (p.isModule) parts.push('"type": "module"');
  return parts.join(', ');
}

/**
 * Answers whether every version a package.json range allows is inside another range. A range that crosses the
 * boundary, a tag and a workspace link all give 'unknown', because only the lockfile knows the installed version.
 */
function rangeIsWithin(range: string | undefined, boundary: string): Answer {
  if (range === undefined || semver.validRange(range) === null) return 'unknown';
  if (semver.subset(range, boundary)) return 'yes';
  return semver.intersects(range, boundary) ? 'unknown' : 'no';
}

const both = (a: Answer, b: Answer): Answer => (a === 'no' || b === 'no' ? 'no' : a === 'unknown' || b === 'unknown' ? 'unknown' : 'yes');

/** True when a listed package is at least this version. */
export const isAtLeast = (p: Project, pkg: string, min: string): Answer => (p.has(pkg) ? rangeIsWithin(p.range(pkg), `>=${min}`) : 'no');

/** True when a Froala package (as listed, or the release this server covers) is at most this version. */
export const froalaAtMost = (p: Project, pkg: string, max: string): Answer => rangeIsWithin(p.range(pkg) ?? FROALA_VERSION, `<=${max}`);

/**
 * The React and Vue wrappers of Froala 5.5.0 and older ship as CommonJS. In a "type": "module" project,
 * Vite 8 (also used by Nuxt 4.5 and newer) returns the whole module for a default import. Froala 5.6.0 fixes this.
 */
export function wrapperImportBug(p: Project, wrapper: 'react-froala-wysiwyg' | 'vue-froala-wysiwyg'): Answer {
  if (!p.isModule) return 'no';
  const bundler = p.has('vite') ? isAtLeast(p, 'vite', '8.0.0') : isAtLeast(p, 'nuxt', '4.5.0');
  return both(bundler, froalaAtMost(p, wrapper, '5.5.0'));
}

/** Angular apps created with server rendering (ng new --ssr). */
export const usesAngularSsr = (p: Project) => p.has('@angular/ssr');

/** Froala packages newer than the release this server's data covers, such as ["froala-editor 5.6.0"]. */
export function newerThanData(p: Project): string[] {
  return FROALA_PACKAGES.filter((name) => {
    const lowest = p.version(name);
    return lowest !== undefined && semver.gt(lowest, FROALA_VERSION);
  }).map((name) => `${name} ${p.version(name)}`);
}

/** A note to add to answers when the project uses a newer Froala than the data. */
export function newerNote(p: Project): string | undefined {
  const newer = newerThanData(p);
  return newer.length
    ? `Your project uses ${newer.join(' and ')}, which is newer than the Froala ${FROALA_VERSION} data this server has. Most answers still apply. Check the Froala changelog for what changed.`
    : undefined;
}

/** The message for a project built on a framework this server does not support. */
export const unsupportedMessage = (framework: string) =>
  `This server has no setup for ${framework}. It supports React, Vue, Angular, Next.js, Nuxt, Svelte, TypeScript and JavaScript projects. Use froala_query_docs to read what the Froala docs say.`;
