// Builds docs.json from the Froala docs and examples pages on froala.com.
// It reads the sitemap, downloads each page politely (2 at a time, 500 ms apart),
// keeps the <main> content and converts it to Markdown. When FROALA_SITE_DIR names the
// froala.com site repository, its pages replace the downloaded copy.
// The script stops with an error if a required page is missing or too many pages fail,
// so an incomplete set of docs is never written. npm run build:data runs it in a staging folder.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const USER_AGENT = 'froala-mcp-indexer';
const SITEMAP_INDEX = 'https://froala.com/sitemap_index.xml';
const KEEP = /^https:\/\/froala\.com\/wysiwyg-editor\/(docs|examples)\//;
const CONCURRENCY = 2;
const DELAY_MS = 500;
const MAX_FAILED_SHARE = 0.02;
// The tools read the fields of these three pages, and the site repository writes them in another format.
const KEEP_DOWNLOADED = /\/docs\/(options|events|methods)\/$/;
// Pages the tools rely on. The build fails without them.
export const REQUIRED_PAGES = [
  'https://froala.com/wysiwyg-editor/docs/overview/',
  'https://froala.com/wysiwyg-editor/docs/options/',
  'https://froala.com/wysiwyg-editor/docs/events/',
  'https://froala.com/wysiwyg-editor/docs/methods/',
  'https://froala.com/wysiwyg-editor/docs/plugins/',
  'https://froala.com/wysiwyg-editor/docs/framework-plugins/react/',
  'https://froala.com/wysiwyg-editor/docs/framework-plugins/vue-js-3/',
  'https://froala.com/wysiwyg-editor/docs/framework-plugins/angular/',
  'https://froala.com/wysiwyg-editor/docs/activation/'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`${res.status} for ${url}`);
    await sleep(2000 * attempt);
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'form', 'button']);

function sectionOf(url) {
  const m = url.match(/wysiwyg-editor\/(docs|examples)\/([^/]+)?/);
  if (!m) return 'other';
  if (m[1] === 'examples') return 'examples';
  return m[2] ? `docs/${m[2]}` : 'docs';
}

export function toPage(url, html) {
  const $ = cheerio.load(html);
  const main = $('main').first().length ? $('main').first() : $('body');
  // Removes the page chrome, which is the docs menu, the table of contents, other menus and the breadcrumbs.
  main.find('nav, header, footer, aside, .sticky-column, .lwptoc, .jupiterx-widget, .elementor-widget-nav-menu, .elementor-widget-breadcrumbs, .elementor-widget-table-of-contents').remove();
  // Keeps code samples as fenced blocks.
  main.find('pre').each((_, el) => {
    const text = $(el).text();
    $(el).replaceWith(`<pre><code>${cheerio.load('<x></x>')('x').text(text).html()}</code></pre>`);
  });
  const title = (main.find('h1').first().text() || $('title').text()).replace(/\s+/g, ' ').trim();
  const headings = main
    .find('h2, h3')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .slice(0, 80);
  let markdown = turndown
    .turndown(main.html() || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Drop the closing sales block that ends most pages.
  const cut = markdown.search(/^#{1,6}\s*Ready to dive in/im);
  if (cut > 0) markdown = markdown.slice(0, cut).trim();
  // Drop the breadcrumb lines above the page title.
  const firstHeading = markdown.search(/^#\s/m);
  if (firstHeading > 0 && firstHeading < 2000) markdown = markdown.slice(firstHeading);
  markdown = cleanMarkdown(markdown.replace(/^\[(Try Froala Free|Back to [A-Za-z ]+)\]\([^)]*\)\s*$/gm, ''), url);
  return { url, title, section: sectionOf(url), headings: headings.filter((h) => !/^Ready to dive in/i.test(h)), markdown, ...pageFlags(markdown) };
}

/** Removes inline images, makes every link absolute and tidies blank lines. */
export function cleanMarkdown(markdown, url) {
  return markdown
    .replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '')
    .replace(/\]\((?!https?:|#|mailto:|data:)([^)\s]+)/g, (_, href) => {
      try {
        return `](${new URL(href, url).href}`;
      } catch {
        return `](${href}`;
      }
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Pages whose code uses Froala 2 event handlers, function (e, editor), are marked so the tools can warn. */
export const pageFlags = (markdown) => (/function\s*\(\s*e\s*,\s*editor\b/.test(markdown) ? { legacyCode: true } : {});

// Sentences in the docs that describe releases before the current one, and what replaces them.
const CURRENT_FACTS = [
  [/^> ?Plugins are fully functional during your trial once you've added your trial key to the setup\.\n\n?/gm, ''],
  [/^Plugins are fully functional during your trial once you've added your trial key to the setup\.\n\n?/gm, ''],
  [/With your trial key in the setup, every plugin works for the whole trial\./g, 'Every plugin works with any key.'],
  [/Without a valid key, Froala shows an unlicensed banner\./g, 'Without a valid key, Froala shows a small notice, and every feature keeps working.'],
  [/^.*\/\/ In a Vite 8 app, add legacy: \{ inconsistentCjsInterop: true \}.*\n/gm, ''],
  [/In a Vite 8 app, set one option in vite\.config\.ts first, or the page stays blank\.\s*/g, ''],
  [/^## Configure Vite\n[\s\S]*?(?=^## )/gm, '']
];

/** The licensing and Vite behaviour of the current release, which every page must state. */
export function withCurrentFacts(pages) {
  const notice = readFileSync(path.join(root, 'content/licensing.md'), 'utf8');
  const section = notice.slice(notice.indexOf('## What the editor shows'), notice.indexOf('## When you are ready to ship')).trim();
  return pages.map((page) => {
    const current = CURRENT_FACTS.reduce((text, [from, to]) => text.replace(from, to), page.markdown);
    return { ...page, markdown: page.url.endsWith('/docs/activation/') ? current.replace(/## Without a Key[\s\S]*?(?=\n## |$)/, `${section}\n`) : current };
  });
}

/** True when the share of pages that gave no content is too high to trust the result. */
export const tooManyLost = (failed, skipped, total) => failed + skipped > total * MAX_FAILED_SHARE;

/** Every index.md under the site repository's site folder, with its froala.com URL. */
function sitePages(folder, prefix = '') {
  const pages = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) pages.push(...sitePages(path.join(folder, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name === 'index.md') pages.push({ url: `https://froala.com/${prefix}`, file: path.join(folder, entry.name) });
  }
  return pages;
}

/** Replaces downloaded pages with the site repository's Markdown, and adds the pages only it has. */
async function overlaySitePages(pages) {
  if (!process.env.FROALA_SITE_DIR) return pages;
  const site = path.resolve(root, process.env.FROALA_SITE_DIR, 'site');
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  for (const { url, file } of sitePages(site)) {
    if (KEEP_DOWNLOADED.test(url) || !url.startsWith('https://froala.com/wysiwyg-editor/')) continue;
    const markdown = cleanMarkdown(readFileSync(file, 'utf8'), url);
    if (markdown.length <= 50) continue;
    const headings = [...markdown.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].replace(/[`*]/g, '').trim()).slice(0, 80);
    const title = markdown.match(/^# (.+)$/m)?.[1].trim() ?? url;
    const known = byUrl.get(url);
    // A page the live site does not have stays out of links.
    const published = known ? true : (await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } })).ok;
    byUrl.set(url, { url, title, section: sectionOf(url), headings, markdown, ...pageFlags(markdown), ...(published ? {} : { published: false }) });
  }
  return [...byUrl.values()];
}

async function main() {
  const index = await get(SITEMAP_INDEX);
  const urls = [];
  for (const sitemap of locs(index)) {
    const xml = await get(sitemap);
    for (const loc of locs(xml)) if (KEEP.test(loc)) urls.push(loc);
  }
  const unique = [...new Set(urls)].sort();
  console.log(`Found ${unique.length} docs and examples pages`);

  const pages = [];
  const failed = [];
  const skipped = [];
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const url = unique[next++];
      try {
        const page = toPage(url, await get(url));
        if (page.markdown.length > 50) pages.push(page);
        else skipped.push(url);
      } catch (error) {
        failed.push(`${url}: ${error.message}`);
      }
      if ((pages.length + failed.length + skipped.length) % 50 === 0) console.log(`  ${pages.length + failed.length + skipped.length}/${unique.length}`);
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failed.length) console.log(`${failed.length} page(s) failed:\n${failed.join('\n')}`);
  if (skipped.length) console.log(`${skipped.length} page(s) had no content and were skipped:\n${skipped.join('\n')}`);
  const missing = REQUIRED_PAGES.filter((url) => !pages.some((p) => p.url === url));
  if (missing.length) throw new Error(`Required pages are missing, so docs.json was not written:\n${missing.join('\n')}`);
  if (tooManyLost(failed.length, skipped.length, unique.length)) throw new Error(`${failed.length + skipped.length} of ${unique.length} pages gave no content, so docs.json was not written.`);

  const merged = withCurrentFacts(await overlaySitePages(pages));
  merged.sort((a, b) => a.url.localeCompare(b.url));
  const folder = path.resolve(root, process.env.DATA_DIR ?? 'data');
  mkdirSync(folder, { recursive: true });
  const out = { builtAt: new Date().toISOString(), source: SITEMAP_INDEX, pages: merged };
  // Write to a temporary file first, so a failed run never leaves a half-written file behind.
  const target = path.join(folder, 'docs.json');
  writeFileSync(`${target}.tmp`, JSON.stringify(out));
  renameSync(`${target}.tmp`, target);
  console.log(`Saved ${merged.length} pages (${Math.round(JSON.stringify(out).length / 1024)} KB)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
