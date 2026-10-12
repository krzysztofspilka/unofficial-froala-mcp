# Response to the implementation audit of 12 October 2026

The audit listed 36 findings. This page says what changed for each, and what is still open. Every fix has a test in `test/`, and the counterexamples from the audit are now test cases.

Status: **30 fixed, 5 partly fixed, 1 open.** Some fixed findings note a smaller follow-up.

## P1 findings

| # | Finding | Status | What changed |
|---|---|---|---|
| F01 | The checker can't reliably identify a Froala configuration | Fixed | Settings count only when the code hands them to Froala: `new FroalaEditor(selector, settings)` (also with an imported alias), a wrapper's `config` prop, Vue `:config`, Angular `[froalaEditor]` (also from a separate .html template), Svelte `config`, a file that is only a settings object, or a variable named like Froala settings. Unrelated objects and JSON-LD scripts are ignored. |
| F02 | Partial analysis is reported as success | Fixed | Answers list what wasn't checked: script blocks that couldn't be read, settings defined in another file, spread settings and files that aren't code. A clean result says "No findings in the code checked" and asks to build and run the app. |
| F03 | Plugin advice can remove required functionality | Fixed | The "drop the plugins bundle" check is gone. |
| F04 | The event-handler fix can change correct code | Fixed | A handler is reported only when it uses editor parts as objects, such as `this.html.get()` or `editor.selection.get()`. `this.save()` in a class is left alone, and the fix says when to keep the arrow function. |
| F05 | Instructions turn uncertain advice into mandatory edits | Fixed | Instructions and prompts now say: fix errors, confirm a warning applies before changing code, treat tips as optional, then build and run. The review prompt shows the findings before changing anything. |
| F06 | "All plugins" is wrong for third-party integrations | Fixed | The data records which plugins `plugins.pkgd.min.js` contains (7 aren't in it) and which plugins have CSS outside `froala_editor.pkgd.min.css` (5 third-party ones). Checks and lookup use both, and a new check reports missing third-party CSS. |
| F07 | Types are inferred from default values | Fixed | Types come from the docs (302 options) or the package's `index.d.ts`. The 24 undocumented options, such as `imageUploadToAzure`, say "not documented" instead of guessing. |
| F08 | Defaults are silently cut | Fixed | Defaults are stored in full (`htmlAllowedTags` has all 106 tags). Answers shorten defaults over 1,500 characters and say so. |
| F09 | Guidance isn't tied to installed versions | Partly fixed | Setup, check_code and workarounds read package.json. Install commands pin the tested version, and answers warn when the project is newer than the data. Open: data for older Froala releases (one snapshot per server release). |
| F10 | The body limit depends on Content-Length | Fixed | The worker reads at most 512 KB of the body, whatever the header says, before parsing or logging. Tested without Content-Length (413) in tests and in the Workers runtime. |
| F11 | No Origin validation | Fixed | Browser requests are allowed only from local development pages (such as MCP Inspector) and origins in `ALLOWED_ORIGINS`. Clients without an Origin header work as before. Tested in the Workers runtime (403). |
| F17 | Workarounds use the wrong package version | Fixed | Each rule reads the package it concerns, with real semver ranges. Ranges package.json can't pin down (tags, links) make a fix "may apply" instead of "applies". Open: reading lockfiles. |
| F20 | Setup and workarounds contradict each other | Fixed | Setup and workarounds share one project model. Setup writes the fix into the code it returns, follows Nuxt 3 and 4 layouts, Angular server rendering, the bundler's environment variables (Vite, Create React App, Vue CLI) and the SvelteKit 3 `#lib` alias. |
| F22 | Search fails important queries | Fixed | Each option, event and method is its own search entry with its anchor ("contentChanged event" now finds it first). Partial matches are labelled with the missing words, and topics the docs don't cover (Next.js, Nuxt, Svelte, Vite 8) point to the right tool. Open: framework and version filters. |
| F28 | Data generation can publish incomplete data | Fixed | The builders stop when a plugin fails to load, a required page is missing or more than 2% of pages fail, and they write files atomically. `npm run check:data` checks counts, required pages and versions before every publish. |
| F29 | Licensing answers conflict | Fixed | The licensing answer is based on tests (in Chrome and jsdom, dated): no key works fully on localhost; other domains show a banner and block most toolbar buttons; a free trial key unlocks everything. Plans were checked on the pricing page, with the date. |
| F30 | The response budget doesn't bound the response | Fixed | check_code returns at most 60 findings and the count of the rest. Lists are capped, and a guard limits structured data to 60,000 characters. |
| F34 | Tests can't show the integration works | Fixed | The audit's counterexamples are tests, search has relevance tests including topics the docs don't cover, and `eval/try-setup.mjs` builds the exact setup code in fresh apps. All 8 targets were built and checked in Chrome (see EVALUATION.md). Open: running the browser check in CI. |
| F36 | The README overstates the product | Fixed | Rewritten for the 8 tools, current checks, limits, privacy and licensing, with known limitations and troubleshooting. LICENSE, SECURITY.md and server.json ship with the repository. |

## P2 findings

| # | Finding | Status | What changed |
|---|---|---|---|
| F12 | Editor instances and import bindings are mixed | Fixed | Each editor's settings, toolbar and `pluginsEnabled` are checked on their own. `FE.RegisterCommand` works with any name the editor is imported as. |
| F13 | Valid names with invalid values pass | Partly fixed | Literal values are checked against the documented type (`imageUpload: 'false'`, `toolbarButtons: 42`), `pluginsEnabled` names and event names are checked. Open: nested option shapes. |
| F14 | Helper-library and sanitizer checks match words | Fixed | Checks read code, not comments. A helper library counts when it is assigned to `window.<name>` or loaded by a script tag; a sanitizer counts when it is called. |
| F15 | SSR check satisfied by an unrelated component | Fixed | A `dynamic(..., { ssr: false })` import counts only for the file it loads. `ssr: false` in a Server Component is now an error, as Next.js reports it. Angular and SvelteKit server rendering are handled by setup. |
| F16 | Asset advice isn't scoped | Fixed | Font Awesome advice only where Froala is used, the editor stylesheet is told apart from the content stylesheet, query strings are ignored, and CDN versions must be exact (5.5 is reported). |
| F18 | Workaround applicability is overstated | Fixed | Answers separate fixes that apply to the versions from fixes that depend on the code. Nuxt fixes need Nuxt 4.5 or newer. Entries stay when a release fixes them, so older projects still get them. |
| F19 | JavaScript projects get TypeScript-only fixes | Fixed | The fixes give JavaScript and TypeScript versions where they differ. |
| F21 | The display recipe isn't a copyable file | Fixed | Separate React (with `npm install dompurify`) and HTML examples. The React one is parsed in tests. |
| F23 | The docs data has noise | Partly fixed | 148 inline images removed, relative links made absolute, and 20 pages with Froala 2 code marked and ranked lower, with a note in answers. Open: version labels on every page. |
| F24 | Page retrieval loses the anchor and splits code | Fixed | `#anchor` returns that section, an invalid part number is an error, parts never cut a code block, and very long lines are cut between words. |
| F25 | URL normalisation changes the host | Fixed | Only froala.com URLs are accepted; others return an error. |
| F26 | Lookup is inconsistent | Fixed | Wrapper settings are in the catalog, lists and case-insensitive lookup. Docs links are given only for documented options, and the instructions say to link only to URLs the tools return. |
| F27 | The API model is a name and default index | Partly fixed | Lookup now covers 146 events and 289 methods with their arguments, return values and descriptions, and takes several names at once. Open: payload types, cancellation and version history. |
| F31 | Structured contracts are incomplete | Partly fixed | Answers carry `froala_version` and `docs_snapshot`, get_page includes the Markdown and licensing has structured data. Open: declared output schemas. |
| F32 | Invalid package input gives inconsistent errors | Fixed | A package.json that isn't valid JSON or isn't an object is a tool error with a short message. Dependencies with a wrong type are ignored. |
| F33 | Telemetry can record arbitrary input | Fixed | Logs keep only known tool names and MCP methods, a client name of at most 40 characters, the HTTP status, timing and country. Open: recording tool errors separately. |
| F35 | Important information isn't available as workflows | Open | Uploads end to end, forms, saving, AI and collaboration setups, and migrations are next. The evaluation showed uploads matter most (agents met blob: URLs). |

## Found by the evaluation, beyond the audit

- The React, Vue and Angular wrappers depend on exactly the same froala-editor version. Setup now pins both, and check_code reports a mismatch.
- Images added by URL go through Froala's hosted proxy by default. Setup sets `imageUploadRemoteUrls: false`.
- Tailwind removes list bullets and heading sizes inside the editor. Setup adds a small CSS file when Tailwind is installed.
- Angular's default budget fails with plugins imported at the top of a component. Setup now loads them after start (496 kB initial bundle).
- Agents looked up toolbar buttons one at a time (102 of 180 calls). Lookup takes several names, and the rate limit counts tool calls only.
