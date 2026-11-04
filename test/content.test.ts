// The hand-written content, which is the enhancements file, the integrations, and the words public text must not use.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { transform } from 'esbuild';
import { describe, expect, test } from 'vitest';
import { buildContent, parseFrontMatter } from '../scripts/build-content.mjs';
import { content, knowledge } from '../src/data.js';
import { KNOWN_ISSUES } from '../src/audit/known-issues.js';
import { PRESETS } from '../src/presets.js';
import { TARGETS } from '../src/project.js';

const canBuild = typeof stripTypeScriptTypes === 'function';

describe('the enhancements file', () => {
  test.runIf(canBuild)('data/content.json matches the sources, so run npm run build:content after changing them', () => {
    expect(content).toEqual(buildContent());
  });

  test('the JavaScript copy is the same program as the TypeScript file', async () => {
    const minified = async (code: string, loader: 'ts' | 'js') => (await transform(code, { loader, minifyWhitespace: true, minifySyntax: true, format: 'esm', target: 'es2022' })).code;
    expect(await minified(content.enhancements.javascript, 'js')).toBe(await minified(content.enhancements.typescript, 'ts'));
  });

  test('the JavaScript copy keeps the comments and has no type syntax left', () => {
    const { javascript } = content.enhancements;
    expect(javascript).toContain('Froala enhancements');
    expect(javascript).toContain('Removes scripts and event handlers');
    expect(javascript).not.toMatch(/\binterface\b|\bas HTML|: Editor\b|<HTMLElement>/);
  });

  test('it reads well in both languages', () => {
    for (const line of content.enhancements.javascript.split('\n')) expect(line).toBe(line.trimEnd());
    expect(content.enhancements.javascript).not.toMatch(/\S {2,}[=(,)]/);
  });

  test('every enhancement named in a known issue exists', () => {
    for (const issue of KNOWN_ISSUES.filter((i) => i.enhancement)) expect(content.enhancements.typescript, issue.id).toContain(`'${issue.enhancement}'`);
  });
});

describe('integrations', () => {
  test('each file has its fields and known targets', () => {
    for (const integration of content.integrations) {
      expect(integration.markdown.startsWith('# '), integration.id).toBe(true);
      for (const target of integration.targets) expect(TARGETS, integration.id).toContain(target);
    }
  });

  test('a file without front matter or a field is refused', () => {
    expect(() => parseFrontMatter('# Title', 'x.md')).toThrow('front matter');
    expect(() => parseFrontMatter('---\ntitle: X\n---\nBody', 'x.md')).toThrow('summary');
  });
});

describe('known issues', () => {
  test('ids are unique, and each issue has a problem, a fix and a check', () => {
    expect(new Set(KNOWN_ISSUES.map((i) => i.id)).size).toBe(KNOWN_ISSUES.length);
    for (const issue of KNOWN_ISSUES) {
      expect(issue.problem.length, issue.id).toBeGreaterThan(20);
      expect(issue.fix.length, issue.id).toBeGreaterThan(10);
      expect(issue.tested.length, issue.id).toBeGreaterThan(10);
    }
  });

  test('snippets are in the knowledge file', () => {
    for (const name of ['undoFloor', 'historyView', 'printKey', 'popupTaps', 'pointerFocus']) expect(knowledge.snippets[name]).toContain(`export {`);
  });
});

describe('presets', () => {
  test('ids are unique, and extensions exist', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    const extensions = knowledge.extensions.map((e) => e.id);
    for (const preset of PRESETS) for (const id of preset.extensions) expect(extensions, preset.id).toContain(id);
  });

  test('the first buttons follow the website', () => {
    for (const preset of PRESETS.filter((p) => p.buttons.includes('undo'))) expect(preset.buttons.slice(0, 2), preset.id).toEqual(['undo', 'redo']);
  });
});

test('server.json and package.json have the same version', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const server = JSON.parse(readFileSync('server.json', 'utf8'));
  expect(server.version).toBe(pkg.version);
  expect(server.packages[0].version).toBe(pkg.version);
});

describe('the README', () => {
  const readme = readFileSync('README.md', 'utf8');

  test('it lists every tool and every target', async () => {
    const { TOOL_NAMES } = await import('../src/server.js');
    for (const tool of TOOL_NAMES) expect(readme).toContain(`\`${tool}\``);
    for (const target of TARGETS) expect(readme).toContain(`\`${target}\``);
  });

  test('its counts match the data', () => {
    expect(readme).toContain(`${PRESETS.length} presets, ${knowledge.examples.length} samples, ${knowledge.whitepapers.length} whitepapers and ${knowledge.extensions.length} extensions`);
  });

  test('it names no hosting address or repository', () => {
    expect(readme).not.toMatch(/mcp\.froala\.com|github\.com\/[a-z]/);
  });

  test('it has no contractions', () => {
    expect(readme).not.toMatch(/\b\w+n't\b|\b(it|you|we)'(s|re|ll)\b/i);
  });
});

describe('public text', () => {
  const files = (folder: string): string[] =>
    readdirSync(folder).flatMap((name) => {
      const full = path.join(folder, name);
      return statSync(full).isDirectory() ? files(full) : [full];
    });
  const sources = [...files('src'), ...files('kit'), ...files('content'), 'README.md'].filter((file) => /\.(ts|md|json)$/.test(file));

  test('nothing uses the words this project avoids', () => {
    for (const file of sources) expect(readFileSync(file, 'utf8'), file).not.toMatch(/workaround|\bplanned\b|\bpending\b|coming soon/i);
  });

  test('no long dashes', () => {
    for (const file of sources) expect(readFileSync(file, 'utf8'), file).not.toMatch(/—/);
  });
});
