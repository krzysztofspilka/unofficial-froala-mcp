# Does the Froala MCP help AI agents? Evaluation, 12 October 2026

We asked 14 AI coding agents to add the Froala editor to 7 freshly created apps: 7 agents with the Froala MCP server and 7 without it. Then we checked every app ourselves, with a build and in a real browser.

## Summary

- **All 14 apps work.** Every app builds, and in Chrome every editor renders, applies bold, makes bulleted lists and opens the table picker.
- **With the MCP, agents used 14.5% fewer tokens overall** (2.50 million against 2.93 million) and finished 13% sooner. The saving was largest for plain TypeScript (29%), React (18%), Next.js (33%) and SvelteKit (34%).
- **The MCP's main effect is first-time-right code.** Agents with the MCP had the Vite 8 import fix from the setup code (React at step 24, Nuxt at step 27). Agents without it wrote the documented import first, got a blank page, and found the fix at step 63 (React) and step 50 (Nuxt) after building their own test harness.
- **For Vue and Angular the MCP cost more** (6% and 25% more tokens). The Angular setup code imported plugins at the top of the component, which breaks Angular's default 1 MB budget, and the agent spent many steps on it. That template is fixed now.
- **Most effort went into checking, not coding.** Both groups spent about 45% of their steps building browser-free test harnesses (jsdom), because they couldn't open a browser. With a browser, the difference in favour of the MCP would likely be larger.

## Method

- **Apps.** Each starter was created with its official command and installed once, then copied for both agents (so both started from identical code).

  | App | Created with | Versions |
  |---|---|---|
  | Plain TypeScript | `npm create vite@9.2.1 -- --template vanilla-ts` | Vite 8.3, TypeScript 6.0 |
  | React | `npm create vite@9.2.1 -- --template react-ts` | Vite 8.3, React 19.2 |
  | Vue | `npm create vue@3.24.0 -- --ts` | Vite 8.2, Vue 3.5 |
  | Angular | `ng new --defaults` (CLI 22.2.2, Node 25.9) | Angular 22.2 |
  | Next.js | `create-next-app@16.4.0 --yes` | Next.js 16.4, Tailwind 4 |
  | Nuxt | `create-nuxt@4.0.1 --template minimal` | Nuxt 4.6 |
  | SvelteKit | `sv@1.1.1 create --template minimal --types ts` | SvelteKit 3.0, Svelte 5.57 |

- **Agents.** Claude Sonnet 5.5 as Claude Code subagents, all started at the same time, one run per app and condition. The task was the same for everyone: add a Froala editor with a basic toolbar (bold, italic, underline, headings, lists, links, images, tables, undo, redo) to the main page, make `npm run build` pass, and make sure it renders. They couldn't use a browser.
- **The MCP server** ran locally in the Cloudflare Workers runtime (`wrangler dev`), the same code as the hosted version. Agents called it through a small command-line bridge (`scripts/call.mjs`), because subagents can't connect to new MCP servers.
- **Without the MCP**, agents used their own knowledge and the public web (froala.com docs, npm, GitHub).
- **Checks we did ourselves**: rebuilt every app, then served the production build on localhost and drove the real toolbar in Chrome.

## Results

| App | Tokens with MCP | Tokens without | Steps with / without | Minutes with / without | Build | Works in Chrome |
|---|---|---|---|---|---|---|
| Plain TypeScript | 308,909 | 437,877 | 87 / 136 | 25 / 39 | ✓ / ✓ | ✓ / ✓ |
| React | 402,701 | 493,525 | 119 / 154 | 39 / 46 | ✓ / ✓ | ✓ / ✓ |
| Vue | 346,488 | 328,093 | 124 / 96 | 30 / 31 | ✓ / ✓ | ✓ / ✓ |
| Angular | 488,390 | 389,161 | 195 / 130 | 48 / 35 | ✓ / ✓ | ✓ / ✓ |
| Next.js | 329,644 | 489,528 | 116 / 157 | 26 / 42 | ✓ / ✓ | ✓ / ✓ |
| Nuxt | 342,383 | 355,179 | 125 / 108 | 32 / 34 | ✓ / ✓ | ✓ / ✓ |
| SvelteKit | 284,674 | 434,286 | 95 / 117 | 32 / 39 | ✓ / ✓ | ✓ / ✓ |
| **Total** | **2,503,189** | **2,927,649** | **861 / 898** | **232 / 265** | | |

Where the steps went (from the transcripts, `eval/analyze-transcripts.py`):

| App | MCP calls | Docs lookups with / without | Coding with / without | Checking with / without | Vite 8 import fix written at step |
|---|---|---|---|---|---|
| Plain TypeScript | 25 | 1 / 9 | 40 / 63 | 36 / 61 | not needed |
| React | 26 | 1 / 1 | 48 / 70 | 60 / 78 | 24 / 63 |
| Vue | 45 | 3 / 9 | 51 / 46 | 53 / 34 | 26 / found by test |
| Angular | 14 | 3 / 3 | 84 / 67 | 94 / 54 | not needed |
| Next.js | 24 | 1 / 8 | 64 / 82 | 37 / 62 | not needed |
| Nuxt | 27 | 2 / 10 | 46 / 47 | 64 / 50 | 27 / 50 |
| SvelteKit | 19 | 1 / 4 | 32 / 57 | 51 / 49 | not needed |

"MCP calls" counts calls the server received. 102 of the 180 calls were `froala_lookup` for one toolbar button at a time, and some agents hit the rate limit because all of them shared one address.

## What the agents ran into

Some problems cost the agents without the MCP extra steps. Others no agent was told about, and several found them on their own. The MCP already handled the ones marked ✓, and we fixed the rest after this run.

| Problem | Who ran into it | In the MCP |
|---|---|---|
| React and Vue wrapper import gives a blank page with Vite 8 and Nuxt 4.6 | without MCP: React, Vue, Nuxt | ✓ setup code includes the fix |
| Froala breaks server rendering in Next.js and SvelteKit | without MCP: Next.js, SvelteKit (HTTP 500) | ✓ setup code loads it in the browser only |
| The wrappers depend on exactly froala-editor 5.5.0, so a newer core installs two copies | noticed by 7 agents | fixed: setup pins both, check_code warns |
| Angular: static plugin imports break the 1 MB budget | both Angular agents | fixed: setup loads plugins after start |
| Images added by URL go through Froala's hosted proxy | noticed by 8 agents | fixed: setup sets imageUploadRemoteUrls: false |
| Uploads without imageUploadURL become blob: URLs that vanish on reload | noticed by 6 agents | fixed: setup notes say so |
| Tailwind's preflight removes list bullets and heading sizes inside the editor | both Next.js agents | fixed: setup adds froala-content.css with Tailwind |
| Without a key, other domains block most toolbar buttons | found by 3 agents | fixed: licensing text and tips explain it |

## What changed in the MCP after this run

- `froala_lookup` takes several names at once, and the rate limit now counts tool calls only.
- Angular setup loads plugins with `import()` after start. Its initial bundle is 496 kB, within the default budget.
- Setup pins `froala-editor` and the wrapper to the same version, adds `imageUploadRemoteUrls: false`, ships the Tailwind CSS fix and explains uploads and keys.
- The licensing answer now says exactly what works without a key (below).

## Without a key: what we tested

| Where the app runs | Toolbar | Banner | Added to saved HTML |
|---|---|---|---|
| localhost, 127.0.0.1, *.localhost, *.test | all buttons work | none, only "Powered by Froala" under the editor | nothing |
| any other domain, LAN address or preview deployment | only bold, italic and underline; other buttons say the feature isn't available | red "unlicensed version" banner | a "Powered by Froala Editor" paragraph |

Tested in Chrome on localhost and a LAN address, and in jsdom with other host names (froala-editor 5.5.0, 12 October 2026). A free trial key from froala.com/get-trial-key unlocks every feature for 30 days.

## The setup code itself, unchanged

The agents adapted the MCP's code (most trimmed the toolbar). To check the exact code the MCP returns, `eval/try-setup.mjs` writes it unchanged into a fresh copy of each starter, adds only the line that shows the editor, and builds it. All 8 targets build, and in Chrome each renders and applies bold, lists and tables: React, Vue, Angular, Next.js, Nuxt, SvelteKit, plain TypeScript and the CDN page.

## Did the MCP help?

Yes, in the way it should: the agents with the MCP got working code first, and the agents without it had to discover the same problems by failing. On a fresh Vite 8 project the documented React and Vue imports give a blank page with no error, and three of the agents without the MCP (React, Vue and Nuxt) would have shipped that page had they not built their own test harness. In everyday use, where an agent doesn't spend half its steps on a harness, that difference matters more than the token count.

It isn't free. Agents used the MCP heavily (180 calls), mostly one lookup per button, and a wrong template (Angular) cost more than having no MCP. Both are fixed, and the next run should show it.

## Limits of this test

- One run per app and condition, with one model. Agent runs vary; treat single-app differences as indicative.
- The agents couldn't use a browser, so they spent about 45% of their steps on their own checking.
- The MCP was called through a command-line bridge, not native MCP tool calls, so the server's instructions reached the agents only when they asked for them.
- All 14 agents ran at the same time on one machine, which slowed the builds equally for both groups.

## Reproduce it

The apps, logs and scripts are in `froala-build/repro/mcp-eval/` (apps, bridge scripts, call logs) and `froala-mcp/eval/` (`analyze-transcripts.py`, `try-setup.mjs`, `README.md`).
