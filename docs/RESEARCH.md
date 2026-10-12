# MCP research: AG Grid, Ant Design, MUI, Handsontable

Draft, 12 October 2026. Research on AG Grid, Ant Design, MUI and Handsontable, checked against their published code and, for Handsontable, the live server.

## 1. Summary

- **The four leaders take three different approaches.**
  - **Hosted search.** Handsontable runs one `search_docs` tool, with no install and no login.
  - **Thin local client with remote search.** AG Grid and MUI install a small local server that searches a remote index.
  - **Fully offline.** Ant Design bundles a versioned copy of every prop, token, demo and changelog entry, so it needs no network.
- **Ant Design is the most complete.** It has 8 tools, 2 prompts, and a CLI with 18 commands, including `doctor`, `lint`, `migrate` and `setup`. It is also the most used: about 17k weekly downloads, and 27 releases since March 2026.
- **None of the four checks the code or config an agent writes; they only answer questions.** Froala can lead here, with tools that *check* (project setup, editor config, toolbar ↔ plugin mapping) as well as tools that *search*. Karthik's Q4FY27 line already says "validate integrations".
- **Recommended design: a hosted docs search plus a local `@froala/mcp` package.**
  - **Hosted search** (`mcp.froala.com`): streamable HTTP, no login, ships first.
  - **Local package** (`@froala/mcp`, stdio): works offline, and carries the editor's options, plugins, commands and events for every 5.x minor version. It is generated from Froala's source by the same step that should also produce the TypeScript declarations, llms.txt and the Markdown docs.

## 2. What the four ship today

Checked by reading each npm package (not running it) and by calling Handsontable's live endpoint, on 12 October 2026.

| | AG Grid | Ant Design | MUI | Handsontable |
|---|---|---|---|---|
| How you run it | `npx ag-mcp` (local stdio) | `npx -y @ant-design/cli mcp` (local stdio) | `npx -y @mui/mcp@latest` (local stdio) | `https://docs-assistant.handsontable.com/mcp` (hosted, streamable HTTP) |
| Where answers come from | Remote search API (`search.ag-grid.com`) | Bundled offline data: 26 MB, per-minor snapshots for v3–v6 | Remote docs catalog built from llms.txt (`chat-backend.mui.com`) | Hosted semantic index: docs, API, HyperFormula, skill recipes, release notes, GitHub issues, blog |
| Tools | 4 | 8, all marked read-only | 3 (one needs a paid API key) | 1 |
| Prompts | 2 | 2 | 0 | 0 |
| Resources | 3 collections | 0 | 0 | 0 |
| Version handling | Detects version and framework from `package.json`; can pin a version | `--version` pin; every minor bundled; API diff between versions | Agent is told to read `package.json` and pass the major version | Always indexes the latest release; warns when you pass another version |
| Login | None | None | None for docs; API key for code generation | None |
| Package | MIT, v1.0.0, last published 2025-09-21, ~4.3k weekly downloads | MIT, v6.6.6, 27 versions since 2026-03-17, ~17k weekly | MIT, v0.1.7, last published 2026-10-06, ~12k weekly | Listed in the official MCP registry as `com.handsontable/docs` |
| Agent skills | `ag-grid/skills` repo | Skill bundled with the CLI (`npx skills add ant-design/ant-design-cli`) | None found | `handsontable/handsontable-skills` repo |

### AG Grid (`ag-mcp`)

- **Tools:**
  - `search_docs` {query, version?, framework?}
  - `detect_version` {path?}: reads `package.json`
  - `list_versions` {}
  - `set_versions` {version, framework}
- **Prompts:**
  - `quick-start` {framework, projectType?, typescript?, features?}: builds a step-by-step setup brief that tells the agent which tools to call.
  - `migrate-version` {version, currentVersion?, framework?}: plans an upgrade one version at a time.
- **Resources:** `ag-mcp://articles`, `ag-mcp://definitions` and `ag-mcp://examples`. These are versioned, condensed Markdown, and each item is also addressable on its own.
- **Remembers settings:** the detected version and framework are saved in the user's cache folder, so later searches default to them.
- **Lesson 1: the docs drifted from the code.** The docs name the tool `set_version` and the prompt `upgrade-grid`, but the code ships `set_versions` and `migrate-version`. Generate the docs from the server code.
- **Lesson 2: the package hasn't been republished in a year.** Search stays current only because the index is remote.

### Ant Design (`@ant-design/cli`, `antd mcp`)

- **Tools:**
  - `antd_list`: all components
  - `antd_info` {component, detail?}: props, types, defaults
  - `antd_doc` {component}: full Markdown docs
  - `antd_demo` {component, name?}: runnable demos
  - `antd_token` {component?}: design tokens
  - `antd_design_md`: the design-language document
  - `antd_semantic` {component}: DOM structure and styling hooks
  - `antd_changelog` {version? | v1, v2, component?}: changelog, or an API diff between two versions
- **Every tool is marked read-only** (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`).
- **Prompts:** `antd-expert` and `antd-page-generator`.
- **The CLI around the server is the real product:**
  - `doctor`: 10 project checks, including installed versions that have known bugs, duplicate installs and peer dependencies.
  - `lint`: deprecated, a11y, usage and performance rules, derived from the version metadata.
  - `migrate <from> <to>`: steps with before/after code, plus an `--apply` mode that writes an agent prompt.
  - `usage`, `env` and `bug`: usage scan, environment report, issue report.
  - `setup --client claude|cursor|vscode|codex`: writes the MCP and/or skill configuration for you.
- **Agent-friendly details:** JSON output on every command, typo suggestions ("Buttn" → "Button"), and every answer in English and Chinese.
- **Lesson:** offline, version-exact data plus project checks is what makes it trustworthy. It answers for *your* version, not "latest".

### MUI (`@mui/mcp`)

- **Tools:**
  - `useMuiDocs` {sources}: returns the docs catalog (URLs and summaries) for a package, built from llms.txt.
  - `fetchDocs` {urls}: fetches full pages, using only URLs that the catalog returned.
  - `generateReactCode` {prompt, threadId?, designContext?, muiPairing?, model?}: code generation, optionally from a Figma frame. It needs `MUI_RECIPES_API_KEY` and is a paid product.
- **MUI's docs page lists only the first two tools.**
- **Tool list updates live:** `useMuiDocs` is registered once the catalog loads, and the server announces it with `tools/listChanged`.
- **Lessons:**
  - Pushing agents toward real URLs ("only URLs present in the returned content") is a cheap fix for made-up links.
  - Code generation behind an API key is a possible paid tier later.

### Handsontable (hosted docs server)

- **One tool:** `search_docs` {query (1–1000 chars), limit? (1–20, default 8), ht_version?, hf_version?}.
- **No prompts or resources**, and no session needed.
- **Server instructions guard against made-up links:**
  - "`url` is null when a snippet has no public page … never fabricate a link."
  - Scores are for ranking only.
  - Guides repeat once per framework, so the agent should remove duplicates.
- **Live test:** the query "React quick start with Vite" with `ht_version: 16.0.0` answered in 1.8 s. The answer started with a clear note on version coverage ("this KB covers 18.1.2"). **But the top result was a 2024 blog post, not the quick-start guide.**
- **Lesson:** retrieval quality decides whether the server helps. Rank official guides above blog posts, and filter by framework.

### Competitors, for context

- **CKEditor** runs a hosted docs MCP on Kapa (`https://ckeditor5.mcp.kapa.ai`). It requires Google or GitHub sign-in; it returned 401 without it. It also publishes agent skills.
- **CKEditor AI**, a separate product, can call customers' MCP tools from inside the editor. That is a different track: Froala's AI Assist acting as an MCP *client*.
- **TinyMCE and Tiptap:** I found no official MCP listing.
- **Froala has no MCP today.** Its agent skills (`froala/froala-claude`) would ship alongside it.

## 3. What Froala's MCP should cover

These are the questions agents need exact, version-specific answers to when they add Froala to a project.

| What the agent needs | Why it matters | MCP answer |
|---|---|---|
| Setup for the exact framework and bundler | React, Vue, Angular, Next.js, Nuxt and Vite each need different imports, and Next.js and Nuxt need client-only loading | `froala_get_setup` returns code tested in CI for that combination |
| Compatibility notes for the project | Server rendering, the Angular build budget when every plugin is imported, TypeScript strict mode | `froala_detect_project` and `froala_doctor` report them, with the fix |
| Correct option names | Agents carry option names over from other editors: `placeholder` works in CKEditor and TinyMCE, but Froala's is `placeholderText` | `froala_validate_config` flags unknown options and suggests the right one |
| Which plugin each toolbar button needs | A button is shown only when its plugin is loaded | `froala_toolbar` maps each button to the imports it needs |
| Outside libraries that plugins use | Word import uses Mammoth; Word export uses html-docx-js and FileSaver; code view uses CodeMirror; PDF export uses html2pdf | `froala_plugin` lists each plugin's requirements and tested versions |
| Licensing | Where the key goes, what the trial covers, how domains work | `froala_licensing` gives one canonical answer |
| Secure configuration | Some upload options can expose storage credentials if they are set in the browser | `froala_validate_config` raises them as security errors |
| Version differences | 5.x minors and the v4 → v5 upgrade | `froala_changelog` and the `froala-upgrade` prompt |

## 4. Proposed design

### 4.1 Architecture

- **One generator, many outputs.** At release time a script extracts a versioned metadata file from Froala's source. It holds options (type, default, owning plugin, version added, deprecated), commands and toolbar buttons (each mapped to a plugin), events with their signatures, methods, plugins (CSS file, outside globals, licence tier) and known issues. The same file generates:
  - the MCP's data;
  - correct TypeScript declarations (fixing today's `[key: string]: any`);
  - `llms.txt` and the Markdown docs;
  - the agent skills.
- **Part 1, hosted search:** `https://mcp.froala.com`, streamable HTTP, no login, rate limited.
  - It indexes docs, the API reference, examples, release notes and the answered GitHub issues.
  - It ranks official guides above blog posts.
  - It must be allow-listed in Cloudflare, so the 7 October block can't happen to it.
  - Build it ourselves (Handsontable's model) or host it on Kapa (CKEditor's model). Kapa is faster to launch, but CKEditor's setup requires sign-in, which adds friction for every agent.
- **Part 2, local package:** `@froala/mcp`, stdio, run with `npx -y @froala/mcp`.
  - It bundles the metadata for each 5.x minor, works offline, and reads the user's `package.json` and config files read-only.
  - It forwards `froala_search_docs` to the hosted index when online.

### 4.2 Tools

All tools are read-only (`readOnlyHint: true`) and return text plus structured JSON. Every name starts with `froala_`, so agents with several MCP servers loaded can't confuse them.

| Tool | Input | Returns | Phase |
|---|---|---|---|
| `froala_search_docs` | query, version?, framework?, limit? | Ranked snippets with `url` (null when there's no public page), kind (guide, API, example, release note, issue), version, and a coverage note | 1 |
| `froala_detect_project` | path? | froala-editor and wrapper versions; framework (React, Vue, Angular, Next.js, Nuxt, Svelte, plain JS); bundler and version; TypeScript strictness; SSR; compatibility notes for that combination | 1 |
| `froala_get_setup` | framework, version?, typescript?, ssr?, features[]?, template? | Install commands, files with paths, CSS imports, where the licence key goes, and the build in which this exact code last passed CI | 1 |
| `froala_validate_config` | config (object or source text), version?, framework? | Errors and warnings: unknown options with suggestions, toolbar buttons without their plugin, deprecated options, plugins missing a global, insecure options, missing licence key | 1 |
| `froala_option` | name? \| query? | One option (type, default, plugin, version added, example), or a filtered list, with typo suggestions | 1 |
| `froala_plugin` | name? | Plugins and their options, commands, events, outside requirements, CSS file and licence tier | 1 |
| `froala_toolbar` | buttons[] | For each button: the plugin and imports it needs, plus warnings for any that won't render | 1 |
| `froala_events_methods` | name? | Signatures and examples (for example the correct `focus` handler signature) | 1 |
| `froala_licensing` | question? | The canonical answers: trial, behaviour without a key, where to put the key, domains | 1 |
| `froala_doctor` | path? | Project checks: core and wrapper versions match, duplicate installs, CSS imported, the import style your bundler needs, Angular budget, Next.js SSR, Vue types, and versions with known bugs | 2 |
| `froala_changelog` | from, to, plugin? | Changes and breaking changes between versions, with before/after code | 2 |
| `froala_template` | name (simple, email, document, markdown, collaborative, chat), framework | Starter code for the template, tested in CI | 2 |
| `froala_troubleshoot` | error (message or stack), framework? | Matching known issues and fixes, from the issue tracker | 2 |
| `froala_check_content` | html, checks[]? | Accessibility and clean-up findings for a piece of content, run headless with the v5.6 Accessibility Checker. None of the four leaders offers this. | 3 |

Example `froala_validate_config` result:

```json
{
  "version": "5.5.0",
  "errors": [
    { "path": "imageUploadToAzure.accessKey", "code": "insecure-option",
      "message": "Signs uploads in the browser with the storage account key, which grants full access to the account.",
      "fix": "Generate a SAS token on your server and pass imageUploadToAzure.SASToken instead." }
  ],
  "warnings": [
    { "path": "placeholder", "code": "unknown-option", "message": "Not a Froala option; it is ignored.", "suggestion": "placeholderText" },
    { "path": "toolbarButtons.moreRich.buttons[2]", "code": "button-plugin-missing",
      "message": "insertTable won't render: the table plugin isn't loaded.",
      "fix": "import 'froala-editor/js/plugins/table.min.js';" },
    { "path": "key", "code": "licence-missing", "message": "No licence key: the editor shows an unlicensed notice." }
  ]
}
```

### 4.3 Prompts

| Prompt | Arguments | What it does |
|---|---|---|
| `froala-quick-start` | framework, typescript?, ssr?, features? | Tells the agent to call `froala_detect_project`, then `froala_get_setup`, then `froala_validate_config` before finishing, and to open the page and check the editor renders |
| `froala-upgrade` | to, from? | Plans an upgrade one version at a time using `froala_changelog` and `froala_doctor` |
| `froala-troubleshoot` | error | Runs `froala_troubleshoot`, then `froala_doctor`, and proposes the smallest fix |
| `froala-template` | use case, framework | Picks the closest template and adapts it |

### 4.4 Resources

- `froala://docs/{version}/{slug}`: docs pages as Markdown.
- `froala://api/{version}/options|events|methods|commands|plugins`: the generated metadata as JSON.
- `froala://examples/{framework}/{name}`: examples that are tested in CI.
- `froala://llms.txt`

### 4.5 Server instructions (draft)

> Answers are for the Froala version in the user's project. Call froala_detect_project first, and prefer froala_get_setup over writing setup code yourself. Before you finish an integration, run froala_validate_config on the final config. Never invent option names, toolbar buttons or URLs: if a tool returns no URL, don't link. Never ask the user for their licence key; tell them where it goes.

### 4.6 Versions

- The package version follows the core: `@froala/mcp@5.6.x` ships the metadata for every 5.x minor up to 5.6.
- Answers are for the detected version. The user can pin a version, as with AG Grid's `set_versions` or Ant's `--version`.
- The hosted index always covers the latest release, and adds Handsontable's style of coverage note when the project's version differs.

### 4.7 Distribution and setup

- **Install command:** `npx froala setup --client claude|cursor|vscode|codex`, which writes the MCP configuration and installs the agent skills (Ant's pattern).
- **Registries and plugins:**
  - The official MCP registry, as `com.froala/mcp` for the local package and `com.froala/docs` for the hosted server.
  - The Claude Code plugin in `froala/froala-claude`, bundling the MCP with the skills.
- **Links from every place an agent looks:** llms.txt, the docs home, each framework guide, the npm READMEs of the core and wrappers, and Context7.
- **Each tool documented on one page, generated from the server code**, so names can't drift as they did at AG Grid.

### 4.8 Security and privacy

- **Read-only.** No tool writes files. `setup` is a separate CLI command the user runs.
- **Narrow file access.** `froala_detect_project` and `froala_doctor` read only `package.json`, lockfiles and config files under the path given.
- **No secrets.** Licence keys and API keys are never requested or logged.
- **Hosted endpoint:** rate limited, with no personal data stored. Log only anonymous tool name, version and framework, to measure usage.

### 4.9 Testing

- **Contract tests in the release pipeline.** Every `froala_get_setup` and `froala_template` output is built and opened in a headless browser, in each starter project (Vite React, create-vue, `ng new`, Next.js, Nuxt), on every release. The MCP never returns code that hasn't passed this.
- **Agent evaluations, monthly and on every MCP release.** Run the blind agent task ("add Froala to a new React / Vue / Angular / Next.js app") with and without the MCP. Record steps, whether the editor works on the first try, and errors.
- **Drift tests.** The tool names in the docs, the skills and the server must match.
- **Retrieval tests.** A fixed set of questions with expected top results (for example "React quick start with Vite" must return the React guide, not a blog post).

## 5. Phased plan, mapped to Karthik's Board outline

| Board line | Proposal | Estimate (rough, for one engineer with AI tools) |
|---|---|---|
| Q3FY27: MCP research complete | This document, plus the metadata generator and the hosted `froala_search_docs` | 2–3 weeks |
| Q4FY27: first MCP tools released | `@froala/mcp` 1.0 with all phase 1 tools, `froala-quick-start`, `setup`, registry listing | 4–6 weeks |
| Q1FY28: extended toolset | Phase 2: `froala_doctor`, `froala_changelog` and the upgrade prompt, templates, troubleshooting from known issues | 4–6 weeks |
| Later | Phase 3: `froala_check_content`; MCP client support in AI Assist (CKEditor AI already does this) | To be decided |

## 6. Success measures

| Measure | Target | Benchmark |
|---|---|---|
| Agent gets a working editor on the first try (React, Vue, Angular, Next.js) | 4 of 4, every month | CKEditor, TinyMCE and Tiptap: first try in our test |
| Agent steps to a working React editor | 24 or fewer | Rivals: 22–24 |
| Wrong options, buttons without their plugin, insecure options caught before the code runs | Caught by `froala_validate_config` across the evaluation set | None of the four leaders checks config |
| Weekly downloads of `@froala/mcp` | Growing month on month | ag-mcp 4.3k, @mui/mcp 12k, @ant-design/cli 17k |
| Setup-related support tickets | Down after 1.0 (target to agree) | Baseline needed |

## 7. Decisions needed

1. **Who builds the hosted search:** ourselves or Kapa? And no login (Handsontable) or sign-in (CKEditor)? Recommendation: no login, rate limited.
2. **Package name and repo:** `@froala/mcp` under the `froala` GitHub org, open source (MIT), like all four leaders. (Decided later: the server is under the Froala license terms, not MIT.)
3. **One CLI or a separate MCP package.** Ant's single CLI (`antd mcp`, `antd doctor`, `antd setup`) is the strongest pattern. Recommendation: one package, `@froala/cli`, with an `mcp` command, if the team can carry it.
4. **Whether to gate anything behind the licence key** (as MUI does with code generation). Recommendation: no gating in 1.0; agents need to work during the trial.

## 8. Sources

- AG Grid MCP docs: https://www.ag-grid.com/react-data-grid/mcp-server/ ; package `ag-mcp` 1.0.0 (dist/handlers/tools.js, prompts/, handlers/resources.js)
- Ant Design MCP docs: https://ant.design/docs/react/mcp ; package `@ant-design/cli` 6.6.6 (dist/index.js, README, data/, skills/)
- MUI MCP docs: https://mui.com/material-ui/getting-started/mcp/ ; package `@mui/mcp` 0.1.7 (README, docs/register.js, codegen/)
- Handsontable docs MCP: https://handsontable.com/docs/vue-data-grid/docs-mcp-server/ ; live `initialize`, `tools/list` and `tools/call` on https://docs-assistant.handsontable.com/mcp
- CKEditor agents page: https://ckeditor.com/docs/ckeditor5/latest/getting-started/ai-coding-agents.html
- Official MCP registry: https://registry.modelcontextprotocol.io (Handsontable listed; no AG Grid, Ant Design, CKEditor or Tiptap entries found; other searches timed out)
