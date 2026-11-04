// A thin or inconsistent dataset must never replace a good one.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { cleanMarkdown, pageFlags, tooManyLost } from '../scripts/build-docs.mjs';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function stagedCopy() {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'froala-data-'));
  folders.push(folder);
  for (const file of ['docs.json', 'metadata.json']) cpSync(path.join('data', file), path.join(folder, file));
  return folder;
}

const check = (folder: string) => {
  try {
    execFileSync(process.execPath, ['scripts/check-data.mjs'], { env: { ...process.env, DATA_DIR: folder }, stdio: 'pipe' });
    return 'passed';
  } catch (error) {
    return String((error as { stderr: Buffer }).stderr);
  }
};

test('the committed data passes', () => {
  expect(check('data')).toBe('passed');
});

test('thin docs fail the check', () => {
  const folder = stagedCopy();
  const docs = JSON.parse(readFileSync(path.join(folder, 'docs.json'), 'utf8'));
  writeFileSync(path.join(folder, 'docs.json'), JSON.stringify({ ...docs, pages: docs.pages.slice(0, 20) }));
  expect(check(folder)).toContain('expected at least');
});

test('empty pages fail the check', () => {
  const folder = stagedCopy();
  const docs = JSON.parse(readFileSync(path.join(folder, 'docs.json'), 'utf8'));
  writeFileSync(path.join(folder, 'docs.json'), JSON.stringify({ ...docs, pages: docs.pages.map((page: object) => ({ ...page, markdown: '' })) }));
  expect(check(folder)).toContain('expected at least');
});

test('docs and metadata from different builds fail the check', () => {
  const folder = stagedCopy();
  const docs = JSON.parse(readFileSync(path.join(folder, 'docs.json'), 'utf8'));
  writeFileSync(path.join(folder, 'docs.json'), JSON.stringify({ ...docs, builtAt: '2020-01-01T00:00:00.000Z' }));
  expect(check(folder)).toContain('built from an older docs.json');
});

test('empty pages count against the docs build, as failed pages do', () => {
  expect(tooManyLost(0, 0, 340)).toBe(false);
  expect(tooManyLost(3, 3, 340)).toBe(false);
  expect(tooManyLost(0, 300, 340)).toBe(true);
  expect(tooManyLost(5, 5, 340)).toBe(true);
});

test('Markdown cleanup makes links absolute and removes inline images', () => {
  const url = 'https://froala.com/wysiwyg-editor/docs/overview/';
  expect(cleanMarkdown('[a](../options/) ![x](data:image/png;base64,AAAA)', url)).toBe('[a](https://froala.com/wysiwyg-editor/docs/options/)');
  expect(pageFlags('function (e, editor) {}')).toEqual({ legacyCode: true });
  expect(pageFlags('function () {}')).toEqual({});
});
