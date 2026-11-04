# Contributing

Thank you for helping. This page explains how the project is laid out and what a change needs before it is merged. Use Node.js 22.13 or newer for development.

## Project layout

```text
src/
  server.ts          the list of tools
  project.ts         reads package.json and decides what applies to a project
  presets.ts         turns content/presets.json into settings
  toolbar.ts         the toolbar order of the Froala website
  tools/             one file per tool, with its inputs and description
  setup/             setup code for each target
  audit/             how froala_audit_code reads code, its checks and the known issues
  docs/              search, page reading and API lookup
  worker.ts          hosted version on Cloudflare Workers
  stdio.ts           local version for npx @froala/mcp
kit/                 froala-enhancements.ts, the file every setup delivers
content/             presets, integrations, licensing text and the toolbar order
data/                generated data, built by scripts/
scripts/             data builds, the bundle, and the smoke test
test/                unit tests, and browser tests in test/browser
eval/                fresh-app runs and evaluation questions
```

## Commands

| Command                         | What it does                                                       |
| ------------------------------- | ------------------------------------------------------------------ |
| `npm run lint`                  | Runs ESLint on the scripts and Prettier on every file              |
| `npm run typecheck`             | Runs TypeScript on the server, the tests and the enhancements file |
| `npm test`                      | Runs the unit tests                                                |
| `npm run test:coverage`         | Runs the unit tests and enforces the coverage limits               |
| `npm run build`                 | Builds `dist/stdio.js`                                             |
| `npm run smoke`                 | Calls every tool through the official MCP client                   |
| `npm run test:eval`             | Checks that the ten evaluation answers are in the tool answers     |
| `npm run test:browser`          | Runs every enhancement, preset and extension in Chrome             |
| `npm run test:apps -- <folder>` | Creates a fresh app for every target and checks it in Chrome       |
| `npm run inspect`               | Opens the MCP Inspector on the local version                       |

`node scripts/call.mjs <tool> name=value` calls one tool from the command line.

## Before you open a pull request

1. Add a test that fails without your change.
2. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run smoke`.
3. If you changed setup code or `kit/froala-enhancements.ts`, run `npm run test:browser` and `npm run test:apps -- <folder>`.
4. Add a line to `CHANGELOG.md`.

## Writing style

Write comments, tool text and documentation in plain, formal English. Use short sentences and name things exactly. Describe what the code does today. A test in `test/content.test.ts` checks public text for words that must not appear.
