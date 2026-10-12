// What we know about the user's project, read from its package.json, and the known Froala problems
// that depend on it. froala_get_setup uses this to write code that works with the project's versions,
// froala_check_code to spot those problems, and froala_workarounds to pick the fixes that apply.
import semver from 'semver';
import { FROALA_VERSION } from './data.js';

export const FRAMEWORKS = ['react', 'vue', 'angular', 'nextjs', 'nuxt', 'svelte', 'vanilla', 'cdn'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

/** 'unknown' when package.json doesn't say, for example when a version is a tag such as "latest". */
export type Answer = 'yes' | 'no' | 'unknown';

export interface Project {
  /** False when no package.json was sent and we assume a project created today. */
  fromPackageJson: boolean;
  framework?: Framework;
  typescript: boolean;
  /** "type": "module" in package.json. Every current starter sets it. */
  isModule: boolean;
  has: (name: string) => boolean;
  /** The lowest version the range in package.json allows ("^8.3.4" gives "8.3.4"), or undefined when it can't be read. */
  version: (name: string) => string | undefined;
}

export const FROALA_PACKAGES = ['froala-editor', 'react-froala-wysiwyg', 'vue-froala-wysiwyg', 'angular-froala-wysiwyg', 'svelte-froala-wysiwyg'];

/** The wrapper package each framework uses. */
export const WRAPPER_FOR: Partial<Record<Framework, string>> = {
  react: 'react-froala-wysiwyg',
  nextjs: 'react-froala-wysiwyg',
  vue: 'vue-froala-wysiwyg',
  nuxt: 'vue-froala-wysiwyg',
  angular: 'angular-froala-wysiwyg',
  svelte: 'svelte-froala-wysiwyg'
};

function lowestVersion(range: string): string | undefined {
  if (/^\s*(\*|x|latest|next)?\s*$/i.test(range)) return undefined;
  try {
    return semver.minVersion(range)?.version;
  } catch {
    return undefined; // a URL, a file or workspace link, or a typo
  }
}

// The first package found decides the framework (Next.js projects also list react, so next comes first).
const FRAMEWORK_PACKAGES: [string, Framework][] = [
  ['next', 'nextjs'],
  ['nuxt', 'nuxt'],
  ['@angular/core', 'angular'],
  ['svelte', 'svelte'],
  ['vue', 'vue'],
  ['react', 'react'],
  ['vite', 'vanilla']
];

function fromDependencies(deps: Record<string, string>, extra: Pick<Project, 'fromPackageJson' | 'isModule'> & { framework?: Framework }): Project {
  const has = (name: string) => name in deps;
  return {
    ...extra,
    framework: extra.framework ?? FRAMEWORK_PACKAGES.find(([name]) => has(name))?.[1],
    typescript: has('typescript'),
    has,
    version: (name) => (has(name) ? lowestVersion(deps[name]) : undefined)
  };
}

/** Reads package.json. Throws an Error with a short explanation if it isn't a package.json. */
export function readProject(packageJson: string, framework?: Framework): Project {
  let pkg: unknown;
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    throw new Error("package_json isn't valid JSON. Send the whole file as it is.");
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
  return fromDependencies(deps, { framework, fromPackageJson: true, isModule: fields.type === 'module' });
}

/** What each official starter installs today (checked October 2026). Used when no package.json is sent. */
const STARTERS: Record<Framework, Record<string, string>> = {
  react: { react: '19.3.0', vite: '8.3.4' },
  vue: { vue: '3.5.43', vite: '8.3.4' },
  nextjs: { next: '16.4.0', react: '19.3.0', tailwindcss: '4.0.0' },
  nuxt: { nuxt: '4.6.1', vue: '3.5.43' },
  angular: { '@angular/core': '22.2.2' },
  svelte: { svelte: '5.57.1', '@sveltejs/kit': '3.0.0', vite: '8.3.4' },
  vanilla: { vite: '8.3.4' },
  cdn: {}
};

export function newProject(framework: Framework, typescript = true): Project {
  const deps = { ...STARTERS[framework], ...(typescript ? { typescript: '6.0.3' } : {}) };
  return fromDependencies(deps, { framework, fromPackageJson: false, isModule: framework !== 'cdn' && framework !== 'angular' });
}

/** A short description of the versions that matter, for example "React 19.3.0, Vite 8.3.4, TypeScript". */
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

/** The version of a Froala package. If it isn't installed yet, it's the release this server covers. */
export const froalaPackageVersion = (p: Project, pkg: string) => (p.has(pkg) ? p.version(pkg) : FROALA_VERSION);

const atMost = (version: string | undefined, max: string): Answer => (version === undefined ? 'unknown' : semver.lte(version, max) ? 'yes' : 'no');
const atLeast = (version: string | undefined, min: string): Answer => (version === undefined ? 'unknown' : semver.gte(version, min) ? 'yes' : 'no');
const both = (a: Answer, b: Answer): Answer => (a === 'no' || b === 'no' ? 'no' : a === 'unknown' || b === 'unknown' ? 'unknown' : 'yes');

/** True when a listed package is at least this version. */
export const isAtLeast = (p: Project, pkg: string, min: string): Answer => (p.has(pkg) ? atLeast(p.version(pkg), min) : 'no');

/** True when a Froala package (installed, or the release this server covers) is at most this version. */
export const froalaAtMost = (p: Project, pkg: string, max: string): Answer => atMost(froalaPackageVersion(p, pkg), max);

/**
 * Froala 5.5.0 and older ship the React and Vue wrappers as CommonJS. In a "type": "module" project,
 * Vite 8 (also used by Nuxt 4.5 and newer) returns the whole module for a default import, so the editor never appears.
 */
export function wrapperImportBug(p: Project, wrapper: 'react-froala-wysiwyg' | 'vue-froala-wysiwyg'): Answer {
  if (!p.isModule) return 'no';
  const bundler = p.has('vite') ? isAtLeast(p, 'vite', '8.0.0') : isAtLeast(p, 'nuxt', '4.5.0');
  return both(bundler, froalaAtMost(p, wrapper, '5.5.0'));
}

/** Angular apps created with server rendering (ng new --ssr). */
export const usesAngularSsr = (p: Project) => p.has('@angular/ssr');

/** Froala packages newer than the release this server's data covers, e.g. ["froala-editor 5.6.0"]. */
export function newerThanData(p: Project): string[] {
  return FROALA_PACKAGES.filter((name) => {
    const v = p.version(name);
    return v !== undefined && semver.gt(v, FROALA_VERSION);
  }).map((name) => `${name} ${p.version(name)}`);
}

/** A note to add to answers when the project uses a newer Froala than the data. */
export function newerNote(p: Project): string | undefined {
  const newer = newerThanData(p);
  return newer.length
    ? `Your project uses ${newer.join(' and ')}, which is newer than the Froala ${FROALA_VERSION} data this server has. Most answers still apply; check the Froala changelog for what changed.`
    : undefined;
}
