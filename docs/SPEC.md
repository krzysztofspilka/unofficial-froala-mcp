# Froala MCP server: build spec

> **Status, 12 October 2026.** This was the build plan, and the server is now built. It grew from six tools to eight (`froala_recipes` and `froala_workarounds` were added), `froala_check_code` takes several files and package.json, and `froala_lookup` also covers events and methods. The README describes the current server, [EVALUATION.md](EVALUATION.md) the test with AI agents, and [AUDIT-RESPONSE.md](AUDIT-RESPONSE.md) the fixes after the code audit.

A handover for one developer working with AI coding tools. Planned for 3 days. Version 1, 12 October 2026.

## 1. The idea in one minute

- **What MCP is.** MCP (Model Context Protocol) is a standard way for AI coding assistants to use outside tools. With a Froala MCP server, Claude Code, Cursor, VS Code Copilot, Codex and Windsurf can ask Froala directly how to set up the editor, and check the code they write.
- **What developers get:**
  - a working editor on the first try;
  - the right option names and plugin imports;
  - quick, accurate answers from the docs.
- **One codebase, published to npm as `@froala/mcp`.** You can use it two ways:
  - **Hosted** at `https://mcp.froala.com/mcp`. Paste the URL into your AI tool and you're done: nothing to install, no sign-up.
  - **Local** with `npx -y @froala/mcp`, for tools that prefer to run a small program on your machine.
- **It covers the latest Froala release.**
- **Coming later:**
  - an offline package with every 5.x version;
  - scanning a whole project;
  - extra CLI commands.

## 2. The tools

Each tool only reads data; none of them changes anything. Each answers in plain text, plus the same data as JSON so the assistant can work with it.

| Tool | What it does |
|---|---|
| `froala_check_code` | Checks Froala code (new or existing) and suggests clear fixes |
| `froala_get_setup` | Gives ready-to-use setup code for a framework, matched to the project's versions |
| `froala_recipes` | Gives ready-made settings for common uses (added during the build) |
| `froala_workarounds` | Lists fixes for known problems with the project's versions (added during the build) |
| `froala_search_docs` | Searches the Froala docs and examples |
| `froala_get_page` | Reads a whole docs or examples page, or one section |
| `froala_lookup` | Explains options, plugins, toolbar buttons, events and methods |
| `froala_licensing` | Explains the free trial and where the licence key goes |

### 2.1 `froala_check_code`: the most important tool

Karthik's idea: let the assistant check Froala code it has just written, or code already in the project, and get friendly, specific fixes back.

**What it receives**

| Field | Type | Notes |
|---|---|---|
| `files` | list, required, up to 20 files and 200,000 characters | Each file has a `path` and its `content`: the changed files, the file that loads Froala's plugins and CSS, and `package.json` (the first plan took one file as `code` and `file_name`) |
| `framework` | one of `react`, `vue`, `angular`, `nextjs`, `nuxt`, `svelte`, `vanilla`; optional | Makes the advice framework-specific |

**How it finds the Froala settings**

1. For `.vue` and `.html` files, take the code inside the `<script>` tags.
2. Read the code with `@babel/parser` (turn on `jsx` and `typescript`). If the code can't be read, reply with one friendly note, `parse-error`, and stop.
3. Treat any object with at least two known Froala option names as Froala settings. An object containing `toolbarButtons` or `pluginsEnabled` counts too.
4. List every import, `require` and `<script src>`, to see which plugins are loaded. If `froala-editor/js/plugins.pkgd.min.js` is imported, every plugin is loaded.

**What it checks**

| Check | Level | When it appears | Suggested fix |
|---|---|---|---|
| `unknown-option` | warning | A setting name isn't a Froala option | The closest real option, e.g. `placeholder` → `placeholderText` |
| `unknown-button` | warning | A toolbar entry isn't a Froala button (`\|` and `-` are fine) | The closest real button |
| `button-plugin-missing` | warning | A toolbar button needs a plugin that isn't imported | The exact import line, e.g. `import 'froala-editor/js/plugins/table.min.js';` |
| `plugin-library-missing` | warning | A plugin needs a helper library that isn't in the code | How to install and connect it (see the table in section 4) |
| `azure-access-key` | error | Azure uploads use `accessKey` | Use a SAS token created on your server, so the storage key stays private |
| `client-only-loading` | warning | On Next.js or Nuxt, the editor is imported at the top of a file | Next.js: load it with `next/dynamic` and `ssr: false`. Nuxt: a `.client` plugin plus `<ClientOnly>`. |
| `licence-key` | tip | The settings have no `key` | Where to add the licence key for this framework. Never ask for, or show, a real key. |
| `css-missing` | tip | The file creates an editor but no Froala CSS is imported | Import `froala-editor/css/froala_editor.pkgd.min.css` once in the app |

**Where to look in the settings:**
- Toolbar buttons can be a simple list or grouped (`moreText.buttons` and so on).
- Check `toolbarButtonsMD`, `toolbarButtonsSM` and `toolbarButtonsXS` as well.
- The Azure check applies to `imageUploadToAzure`, `fileUploadToAzure`, `videoUploadToAzure` and `filesManagerUploadToAzure`.

**Example answer**

```json
{
  "froala_version": "5.5.0",
  "summary": { "errors": 0, "warnings": 2, "tips": 1 },
  "findings": [
    { "check": "unknown-option", "level": "warning", "line": 9,
      "message": "placeholder isn't a Froala option.", "fix": "Use placeholderText." },
    { "check": "button-plugin-missing", "level": "warning", "line": 11,
      "message": "The insertTable button needs the table plugin.",
      "fix": "import 'froala-editor/js/plugins/table.min.js';" },
    { "check": "licence-key", "level": "tip",
      "message": "Add your licence key to remove the trial notice.",
      "fix": "Add key: '<your key>' to the settings. froala_licensing has the details." }
  ]
}
```

### 2.2 `froala_get_setup`

**What it receives:**
- `framework`, required: `react`, `vue`, `angular`, `nextjs`, `nuxt`, `svelte` or `vanilla`;
- `typescript`: yes or no, default yes;
- `plugins`: `essentials` or `all`, default `essentials`.

**What it returns:**
- the Froala version;
- the install command;
- the files to create, each with its path and content;
- short notes, such as where the licence key goes;
- a link to the matching docs page.

**How to build it:** write one small TypeScript file per framework in `src/templates/`, based on the official docs.
- `essentials` loads these plugins, with a matching toolbar: align, lists, link, image, table, paragraph format, font size and colours.
- `all` loads `plugins.pkgd.min.js`.

### 2.3 `froala_search_docs`

**What it receives:** `query` (2–200 characters), `limit` (1–10, default 5).

**What it returns:** a list of `{ title, url, section, snippet }`, with each snippet up to 400 characters.

**How to build it:**
- The search covers every page under `https://froala.com/wysiwyg-editor/docs/` and `https://froala.com/wysiwyg-editor/examples/`, so answers always come from official pages.
- Use MiniSearch, and count matches in titles 3× and in headings 2×.

### 2.4 `froala_get_page`

**What it receives:**
- `url`: a page returned by the search. For anything else, suggest the closest pages.
- `part`: a number, default 1.

**What it returns:** the page as Markdown, in parts of up to 15,000 characters, plus how many parts there are.

Search finds the right page; this tool lets the assistant read all of it.

### 2.5 `froala_lookup`

**What it receives:**
- `kind`: `option`, `plugin` or `button`;
- `name`: exact name, any letter case;
- or `query`: part of a name.

With neither `name` nor `query`, it lists every name of that kind.

**What it returns:**
- **Option:** its default value, type, the plugin it belongs to, the import line and a docs link.
- **Plugin:** its options, buttons, import line and any helper libraries.
- **Button:** its plugin and import line.
- **Unknown name:** `{ found: false, suggestions: [...] }`.

### 2.6 `froala_licensing`

It receives nothing and returns the text of `content/licensing.md`.

**Karthik writes this file.** It covers:
- where the key goes in each framework;
- what the trial includes;
- how domains work;
- a link to pricing.

## 3. Prompts and the welcome note

Prompts are ready-made tasks that users can start from their AI tool's menu.

**`add-froala`** (needs `framework`; `typescript` is optional):

> Add the Froala editor to this {framework} project. 1) Call froala_get_setup. 2) Create or update the files it returns. 3) Run froala_check_code on every file you changed and apply the fixes. 4) Start the dev server and confirm the editor appears. Tell the user where their licence key goes; never make one up.

**`review-froala`** (no input):

> Find every file that uses Froala. Run froala_check_code on each one, apply the fixes, and summarise what changed.

**Welcome note.** The server sends this text to the assistant when it connects:

> Tools for the Froala WYSIWYG editor, latest release. Before writing Froala setup code, call froala_get_setup. After writing or changing Froala code, call froala_check_code and apply its fixes. Use froala_lookup for option, plugin and button names. Link only to pages returned by froala_search_docs. Never ask for or show licence keys.

## 4. Where the data comes from

Two scripts build the data from the latest Froala release and save it in `data/`. That data then ships with both the npm package and the hosted server. Run them again on each Froala release.

**`scripts/build-metadata.mjs` creates `data/metadata.json`**

1. Install the latest `froala-editor`.
2. In `jsdom`, load `js/froala_editor.min.js` and save the names in `FroalaEditor.DEFAULTS`. These are the core options.
3. Load each file in `js/plugins/` and `js/third_party/` one at a time. The new names that appear in `DEFAULTS` belong to that plugin. The new entry in `FroalaEditor.PLUGINS` gives the plugin's name and file.
4. Read `FroalaEditor.COMMANDS` for every toolbar button and its `plugin`. Core buttons such as `bold` have no plugin.
5. Work out each option's type from its default value.

**Backup plan:** if loading in `jsdom` gives trouble, read the `Object.assign(…DEFAULTS, {…})` blocks straight from the files.

**Helper libraries.** Add these by hand to the metadata:

| Plugin | Helper library |
|---|---|
| Import from Word | `mammoth` |
| Export to Word | `html-docx-js` and `file-saver` |
| Code view (optional) | `codemirror` |
| Print and PDF export | `html2pdf.js` |
| Filestack | `filestack-js` |

**`scripts/build-docs.mjs` creates `data/docs.json`**

1. Read the froala.com sitemap and keep the docs and examples pages.
2. Download each page, gently: 2 pages a second, User-Agent `froala-mcp-indexer`.
3. Take the main content with `cheerio` and turn it into Markdown with `turndown`.
4. Save `{ url, title, section, headings, markdown }` for each page.

## 5. Folder layout

```text
froala-mcp/
  src/
    server.ts          createFroalaServer(): the 6 tools and 2 prompts
    tools/             one file per tool
    templates/         one file per framework, for froala_get_setup
    worker.ts          hosted version: fair-use limit, then the MCP handler
    stdio.ts           local version: serveStdio(createFroalaServer)
  data/                metadata.json and docs.json, made by the scripts
  content/licensing.md written by Karthik
  scripts/             build-metadata.mjs and build-docs.mjs
  test/fixtures/       example files for testing froala_check_code
  server.json          entry for the official MCP Registry
  glama.json           claims the Glama listing
  package.json         @froala/mcp, bin froala-mcp, mcpName com.froala/mcp
```

## 6. Hosting, fair-use limits and privacy

- **Hosting: Cloudflare Workers** on `mcp.froala.com`. froala.com already uses Cloudflare, so this is a natural fit.
  - With the official SDK (version 2), the hosted server is `createMcpHandler(createFroalaServer)`, exported as the Worker's default handler.
  - Keep it stateless (no sessions).
  - Add a `GET /health` page.
  - If `docs.json` makes the Worker too large, keep the file in Workers KV or R2 instead.
- **Fair-use limits.** There's no sign-up, so limits keep the server fast for everyone. They're generous:
  - **120 requests a minute per IP address**, using the Workers Rate Limiting binding.
  - A Cloudflare rule as a safety net: 3,000 requests per 10 minutes per IP address.
  - Over the limit, reply with HTTP 429, a `Retry-After` header, and: "You've reached the limit of 120 requests a minute. Please try again in a minute."
  - Accept up to 100,000 characters of code. Keep answers under 25,000 characters; trim longer ones and say so.
- **Privacy:**
  - Don't store the code or questions people send; code can contain licence keys.
  - For statistics, record only: tool name, success or error, how long it took, country, and the AI tool's name (from the `initialize` message).
- **Local version:** the same tools and data, with no limits and no statistics.

## 7. Recommended tools

Everything here is from 2025 or later and well maintained.

| Tool | What it's for |
|---|---|
| Claude Code (or Cursor) with Anthropic's official `mcp-builder` skill | Writing the server with AI help |
| MCP TypeScript SDK, version 2: `@modelcontextprotocol/server` 2.3 | The official SDK: `McpServer`, `registerTool`, `createMcpHandler`, `serveStdio`. Please use version 2. AI tools sometimes reach for the older `@modelcontextprotocol/sdk`, so point them at the version 2 docs. |
| `zod` 4 | Describing each tool's input |
| `@babel/parser` and `minisearch` | Reading code and searching the docs |
| `jsdom`, `cheerio` and `turndown` | The two data scripts |
| `vitest` | Tests |
| MCP Inspector 2 (`@modelcontextprotocol/inspector`) | Trying the tools by hand, plus a quick automated check |
| Wrangler | Deploying to Cloudflare |

Good alternatives: Vercel's `mcp-handler` (for Vercel hosting) and Cloudflare's `agents` SDK (if the server ever needs to remember things between requests).

## 8. The 3-day plan

**Ready before day 1.** Krzysztof sorts these out:
- publishing rights for the `froala` npm account, which owns `@froala`;
- Cloudflare access for `mcp.froala.com`;
- a new GitHub repo, `froala/froala-mcp`;
- `content/licensing.md` from Karthik;
- a DNS TXT record on froala.com for the MCP Registry (Denis).

**Day 1: the skeleton and the data.**
- **Work:**
  - Set up the repo, TypeScript and the SDK.
  - Write `createFroalaServer()` with the 6 tools, each replying "coming soon" for now.
  - Add the local (`stdio.ts`) and hosted (`worker.ts`) versions.
  - Write both data scripts.
- **Done when:**
  - MCP Inspector shows all 6 tools, both locally and through `wrangler dev`.
  - `metadata.json` includes `placeholderText`, `toolbarButtons` and `imageUploadURL`, each with the right plugin.
  - `docs.json` contains every docs and examples page.

**Day 2: the tools.**
- **Work:**
  - Morning: `froala_lookup`, `froala_search_docs`, `froala_get_page` and `froala_licensing`.
  - Midday: the 7 setup templates.
  - Afternoon: `froala_check_code` with its 8 checks, test files and unit tests.
- **Done when:** all tests pass, and each test file produces exactly the expected findings.

**Day 3: ship it.**
- **Work:**
  - Try each template in a fresh project: Vite React, create-vue, `ng new`, `create-next-app`, `nuxi init`, `sv create`, and a plain HTML page.
  - Deploy to `mcp.froala.com` with the limits.
  - Publish to npm.
  - Add the registry entry and the listings (section 9), and write the README.
- **Done when:**
  - every template shows a working editor;
  - the final test below passes.

**Final test (30 minutes).** In a new Claude Code session and a new Cursor session, each connected to `https://mcp.froala.com/mcp`, ask: "Add the Froala editor to a new Vite React app." It passes when:
- the assistant uses `froala_get_setup` and then `froala_check_code`;
- the editor appears;
- `froala_check_code` finds nothing left to fix.

Then repeat once in Claude Code with `npx -y @froala/mcp`.

**If day 3 gets busy:** launch the hosted server and the npm package first. The listings can happily wait a day.

## 9. Publishing and getting listed

**`package.json` needs:**
- `"mcpName": "com.froala/mcp"`, which the official registry checks;
- `"bin": { "froala-mcp": "dist/stdio.js" }`;
- `files` set to `dist` and `data` only;
- `"license": "MIT"`;
- `"engines": { "node": ">=20" }`.

**`server.json`** lists both ways to connect:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "com.froala/mcp",
  "title": "Froala",
  "description": "Set up the Froala WYSIWYG editor and check Froala code, right from your AI coding assistant.",
  "repository": { "url": "https://github.com/froala/froala-mcp", "source": "github" },
  "version": "1.0.0",
  "packages": [
    { "registryType": "npm", "identifier": "@froala/mcp", "version": "1.0.0", "transport": { "type": "stdio" } }
  ],
  "remotes": [
    { "type": "streamable-http", "url": "https://mcp.froala.com/mcp" }
  ]
}
```

**Where to list it.** Start with the official registry, because several other directories copy from it.

| Where | How | Account | Time |
|---|---|---|---|
| Official MCP Registry | Install `mcp-publisher` (`brew install mcp-publisher`), then run `mcp-publisher init`, `mcp-publisher login`, `mcp-publisher publish`. The `com.froala/` name is confirmed through a DNS record on froala.com; `io.github.froala/` with a GitHub login is the easy fallback. | GitHub or DNS | 30 min |
| MCPLookup | Copies the official registry automatically. Handsontable showed up there one day after its registry entry. | None | — |
| Glama | Add `glama.json` with `"maintainers": ["<github-user>"]` to the repo, then claim the server on glama.ai. The hosted server also appears there as a "connector". | GitHub | 10 min |
| Smithery | `npm i -g smithery`, `smithery auth login`, then `smithery mcp publish "https://mcp.froala.com/mcp" -n froala/froala` | Smithery | 10 min |
| PulseMCP | Usually picks up registry entries. If Froala isn't there after a few days, submit on pulsemcp.com. | Email | 5 min |
| mcp.so | Submit on the site | GitHub | 5 min |
| MCP Market | Submit on mcpmarket.com | Email | 5 min |
| Cursor Directory | Submit on cursor.directory/mcp, and add an "Add to Cursor" button to the README and docs | GitHub | 15 min |
| awesome-mcp-servers | Open a pull request on `punkpeye/awesome-mcp-servers` | GitHub | 10 min |
| Cline MCP Marketplace | Submit through Cline's marketplace repo | GitHub | 10 min |

**Also mention the server in:**
- llms.txt;
- the docs home page and each framework guide;
- the npm pages of `froala-editor` and the framework wrappers;
- the `froala/froala-claude` skills;
- Context7.

**The README gets one copy-paste line per AI tool:**
- **Claude Code:** `claude mcp add --transport http froala https://mcp.froala.com/mcp`
- **Cursor:** `.cursor/mcp.json`, plus the install button
- **VS Code:** `.vscode/mcp.json`
- **Codex:** `codex mcp add froala --url https://mcp.froala.com/mcp`
- **Windsurf**
- **Local:** `npx -y @froala/mcp`

## 10. What we'll measure

- **Every week:**
  - calls per tool;
  - which AI tools connect (Claude Code, Cursor, VS Code…);
  - which frameworks people set up;
  - how often `froala_check_code` finds something to fix;
  - npm downloads of `@froala/mcp`.
- **Every month:** run the final test with React, Vue, Angular and Next.js. Goal: a working editor on the first try, every time.

## 11. Why this design

The full research is in `docs/RESEARCH.md`.

- **Hosted first.** It's quickly becoming the standard, and enterprise security teams prefer it, because no outside code runs on developers' machines. It also keeps answers current, and it shows Froala how the server is used.
- **Checking as well as searching.** The best UI-library servers today (AG Grid, Ant Design, MUI, Handsontable) answer questions. Froala's server also checks the code itself, which makes it stand out.
- **No sign-up.** Agents connect in one step; generous limits keep it fast for everyone.

## 12. References

**Directories and registries**

- Official MCP Registry: https://registry.modelcontextprotocol.io ; how to publish: https://github.com/modelcontextprotocol/registry
- Glama: https://glama.ai/mcp/servers
- Smithery: https://smithery.ai
- PulseMCP: https://www.pulsemcp.com
- mcp.so: https://mcp.so
- MCP Market: https://mcpmarket.com
- Cursor Directory: https://cursor.directory/mcp
- MCPLookup: https://mcplookup.com
- awesome-mcp-servers: https://github.com/punkpeye/awesome-mcp-servers

**Great MCP servers to learn from**

- **AG Grid:** version-aware docs search, version detection, and two ready-made prompts (start a project, upgrade). Docs: https://www.ag-grid.com/react-data-grid/mcp-server/ ; npm `ag-mcp` ; skills: https://github.com/ag-grid/skills
- **Ant Design CLI (offline):** all component data built in, plus `doctor`, `lint`, `migrate` and `setup` commands. A model for our later offline version. https://github.com/ant-design/ant-design-cli
- **MUI:** docs catalog built from llms.txt, plus optional code generation. https://github.com/mui/mui-x (folder `packages/mcp`) ; docs: https://mui.com/material-ui/getting-started/mcp/
- **Handsontable:** a hosted docs server with no install and no sign-up, and the closest to our plan. https://handsontable.com/docs/vue-data-grid/docs-mcp-server/ ; skills: https://github.com/handsontable/handsontable-skills
- **Context7:** up-to-date docs for many libraries in one server. https://github.com/upstash/context7
- **GitHub's official MCP server:** a polished example of a large hosted server. https://github.com/github/github-mcp-server
- **Official reference servers:** https://github.com/modelcontextprotocol/servers

**Guides and building blocks**

- MCP TypeScript SDK, version 2: https://ts.sdk.modelcontextprotocol.io/v2/ ; repo: https://github.com/modelcontextprotocol/typescript-sdk
- Anthropic's `mcp-builder` skill: https://github.com/anthropics/skills/tree/main/skills/mcp-builder
- MCP Inspector: https://github.com/modelcontextprotocol/inspector
- Registry quickstart examples: https://github.com/modelcontextprotocol/quickstart-resources
- Cloudflare Agents SDK: https://github.com/cloudflare/agents
- Vercel `mcp-handler`: https://github.com/vercel-labs/mcp-handler
- MCP specification: https://modelcontextprotocol.io
