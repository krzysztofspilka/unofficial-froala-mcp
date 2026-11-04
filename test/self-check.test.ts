// Everything the server hands out must pass its own checks.
import { describe, expect, test } from 'vitest';
import { audit } from '../src/tools/audit.js';
import { getSetup } from '../src/setup/index.js';
import { TARGETS, newProject, readProject, type Project, type Target } from '../src/project.js';
import { PRESETS, pluginsUsedBy, presetRequirements, presetSettings } from '../src/presets.js';
import { metadata, EXTRA_CONFIG_KEYS } from '../src/data.js';

/** Errors and warnings for a set of files. Tips are fine. */
const problems = (files: { path: string; content: string }[], target?: Target) =>
  (audit({ files, target }).structuredContent as { findings: { level: string; check: string; file?: string }[] }).findings.filter((f) => f.level !== 'tip');

/** Anything the audit could not check in a set of files. */
const unchecked = (files: { path: string; content: string }[], target?: Target) => (audit({ files, target }).structuredContent as { not_checked: string[] }).not_checked;

/** package.json files for a project created today, and for one with older tools. */
const PACKAGE_JSON: Record<string, Record<string, object>> = {
  today: {
    react: { type: 'module', dependencies: { react: '^19.3.0' }, devDependencies: { vite: '^8.3.4', typescript: '~6.0.3' } },
    vue: { type: 'module', dependencies: { vue: '^3.5.43' }, devDependencies: { vite: '^8.3.4', typescript: '~6.0.3' } },
    angular: { dependencies: { '@angular/core': '^22.2.2', '@angular/ssr': '^22.2.2' }, devDependencies: { typescript: '~6.0.3' } },
    nextjs: { dependencies: { next: '16.0.0', react: '^19.3.0' }, devDependencies: { typescript: '^6' } },
    nuxt: { type: 'module', dependencies: { nuxt: '^4.6.1', vue: '^3.5.43' } },
    svelte: { type: 'module', devDependencies: { svelte: '^5.0.0', '@sveltejs/kit': '^2.0.0', vite: '^8.3.4', typescript: '^6' } },
    typescript: { type: 'module', devDependencies: { vite: '^8.3.4', typescript: '~6.0.3' } },
    javascript: { type: 'module', devDependencies: { vite: '^8.3.4' } }
  },
  older: {
    react: { dependencies: { react: '^18.3.0' }, devDependencies: { vite: '^7.1.0' } },
    vue: { type: 'module', dependencies: { vue: '^3.4.0' }, devDependencies: { vite: '^7.1.0' } },
    angular: { dependencies: { '@angular/core': '^19.0.0' } },
    nextjs: { dependencies: { next: '15.0.0', react: '^19.0.0' } },
    nuxt: { type: 'module', dependencies: { nuxt: '^4.3.0', vue: '^3.5.0' } },
    svelte: { type: 'module', devDependencies: { svelte: '^5.0.0', vite: '^7.0.0' } },
    typescript: { devDependencies: { vite: '^7.0.0', typescript: '^5.0.0' } },
    javascript: { devDependencies: { vite: '^7.0.0' } }
  }
};

const buildFiles = (target: Target, preset: (typeof PRESETS)[number], typescript: boolean, age: string) => {
  const pkg = age === 'none' ? undefined : JSON.stringify(PACKAGE_JSON[age][target]);
  const project = pkg ? { ...readProject(pkg), target } : newProject(target, typescript);
  const setup = getSetup(target, { typescript, preset, project });
  const files = setup.files.filter((f) => !f.path.endsWith('.d.ts'));
  if (pkg) files.push({ path: 'package.json', content: pkg });
  return files;
};

describe('setup code passes froala_audit_code', () => {
  for (const target of TARGETS) {
    for (const preset of PRESETS.filter((p) => ['simple', 'comment-box', 'everything'].includes(p.id))) {
      for (const typescript of [true, false]) {
        for (const age of ['none', 'today', 'older']) {
          test(`${target}, ${preset.id}, ${typescript ? 'TypeScript' : 'JavaScript'}, package.json: ${age}`, () => {
            const files = buildFiles(target, preset, typescript, age);
            expect(problems(files, target).filter((f) => f.check !== 'plugin-library-missing')).toEqual([]);
            expect(unchecked(files, target)).toEqual([]);
          });
        }
      }
    }
  }
});

describe('every preset', () => {
  for (const preset of PRESETS) {
    test(`${preset.id} uses real options and buttons, and passes froala_audit_code in React`, () => {
      for (const option of Object.keys(presetSettings(preset))) {
        expect(metadata.options[option] || EXTRA_CONFIG_KEYS.has(option), option).toBeTruthy();
      }
      for (const button of preset.buttons) expect(metadata.buttons[button], button).toBeTruthy();
      for (const plugin of pluginsUsedBy(preset)) expect(metadata.plugins[plugin], plugin).toBeTruthy();
      const found = problems(buildFiles('react', preset, true, 'today'), 'react');
      // The notes of a preset tell people to add its helper libraries, so the audit may still ask for them.
      expect(found.filter((f) => f.check !== 'plugin-library-missing')).toEqual([]);
      if (found.length) expect(presetRequirements(preset).length).toBeGreaterThan(0);
    });
  }
});

test('new projects need no import fix, because the setup installs Froala 5.6.0', () => {
  const simple = PRESETS.find((p) => p.id === 'simple')!;
  const component = (project: Project) => getSetup('react', { typescript: true, preset: simple, project }).files.find((f) => f.path.endsWith('.tsx'))!.content;
  for (const project of [newProject('react'), { ...readProject(JSON.stringify(PACKAGE_JSON.older.react)), target: 'react' as const }]) {
    expect(component(project)).toContain("import FroalaEditorComponent from 'react-froala-wysiwyg';");
    expect(component(project)).not.toContain('.default ??');
  }
});
