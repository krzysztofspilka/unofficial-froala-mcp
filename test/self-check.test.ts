// Everything the server hands out must pass its own checks.
import { describe, expect, test } from 'vitest';
import { checkCode } from '../src/tools/check-code.js';
import { getSetup } from '../src/templates/index.js';
import { FRAMEWORKS, newProject, readProject, type Framework } from '../src/project.js';
import { RECIPES, recipePlugins } from '../src/tools/recipes.js';
import { metadata, EXTRA_CONFIG_KEYS } from '../src/data.js';

/** Errors and warnings for a set of files. Tips are fine. */
const problems = (files: { path: string; content: string }[], framework?: Framework) =>
  (checkCode({ files, framework }).structuredContent as { findings: { level: string; check: string; file?: string }[] }).findings.filter(
    (f) => f.level !== 'tip'
  );

/** package.json files for a project created today, and for one with older tools. */
const PACKAGE_JSON: Record<string, Record<string, object>> = {
  today: {
    react: { type: 'module', dependencies: { react: '^19.3.0' }, devDependencies: { vite: '^8.3.4', typescript: '~6.0.3' } },
    vue: { type: 'module', dependencies: { vue: '^3.5.43' }, devDependencies: { vite: '^8.3.4', typescript: '~6.0.3' } },
    angular: { dependencies: { '@angular/core': '^22.2.2', '@angular/ssr': '^22.2.2' }, devDependencies: { typescript: '~6.0.3' } },
    nextjs: { dependencies: { next: '16.0.0', react: '^19.3.0' }, devDependencies: { typescript: '^6' } },
    nuxt: { type: 'module', dependencies: { nuxt: '^4.6.1', vue: '^3.5.43' } },
    svelte: { type: 'module', devDependencies: { svelte: '^5.0.0', '@sveltejs/kit': '^2.0.0', vite: '^8.3.4', typescript: '^6' } },
    vanilla: { type: 'module', devDependencies: { vite: '^8.3.4', typescript: '~6.0.3' } }
  },
  older: {
    react: { dependencies: { react: '^18.3.0' }, devDependencies: { vite: '^7.1.0' } },
    vue: { type: 'module', dependencies: { vue: '^3.4.0' }, devDependencies: { vite: '^7.1.0' } },
    angular: { dependencies: { '@angular/core': '^19.0.0' } },
    nextjs: { dependencies: { next: '15.0.0', react: '^19.0.0' } },
    nuxt: { type: 'module', dependencies: { nuxt: '^4.3.0', vue: '^3.5.0' } },
    svelte: { type: 'module', devDependencies: { svelte: '^5.0.0', vite: '^7.0.0' } },
    vanilla: { devDependencies: { vite: '^7.0.0' } }
  }
};

describe('setup code passes froala_check_code', () => {
  for (const framework of FRAMEWORKS) {
    for (const plugins of ['essentials', 'all'] as const) {
      for (const typescript of [true, false]) {
        for (const age of framework === 'cdn' ? ['none'] : ['none', 'today', 'older']) {
          test(`${framework}, ${plugins} plugins, ${typescript ? 'TypeScript' : 'JavaScript'}, package.json: ${age}`, () => {
            const pkg = age === 'none' ? undefined : JSON.stringify(PACKAGE_JSON[age][framework]);
            const project = pkg ? { ...readProject(pkg), framework } : newProject(framework, typescript);
            const setup = getSetup(framework, { typescript, plugins, project });
            const files = setup.files.filter((f) => !f.path.endsWith('.d.ts'));
            if (pkg) files.push({ path: 'package.json', content: pkg });
            expect(problems(files, framework)).toEqual([]);
          });
        }
      }
    }
  }
});

test('setup code follows the Vite version', () => {
  const today = getSetup('react', { typescript: true, plugins: 'essentials', project: newProject('react') });
  expect(today.files[0].content).toContain('.default ??');
  const older = getSetup('react', { typescript: true, plugins: 'essentials', project: { ...readProject(JSON.stringify(PACKAGE_JSON.older.react)), framework: 'react' } });
  expect(older.files[0].content).toContain("import FroalaEditorComponent from 'react-froala-wysiwyg';");
  expect(older.files[0].content).not.toContain('.default ??');
});

describe('recipes', () => {
  for (const recipe of RECIPES.filter((r) => r.config)) {
    test(`${recipe.id} uses real options and buttons, and passes froala_check_code`, () => {
      for (const option of Object.keys(recipe.config!)) {
        expect(metadata.options[option] || EXTRA_CONFIG_KEYS.has(option), option).toBeTruthy();
      }
      const imports = recipePlugins(recipe).map((p) => `import '${metadata.plugins[p].file}';`);
      const content = `import FroalaEditor from 'froala-editor';
import 'froala-editor/css/froala_editor.pkgd.min.css';
${imports.join('\n')}
new FroalaEditor('#editor', { key: 'test', ...${JSON.stringify(recipe.config)} });`;
      expect(problems([{ path: 'main.js', content }])).toEqual([]);
    });
  }
});
