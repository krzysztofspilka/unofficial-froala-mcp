# Evaluation

This page records how the server was tested on 4 November 2026.

## Fresh apps

`eval/run-apps.mjs` creates each app with its official starter, follows the output of `froala_get_setup` without changes, audits the files, builds the app, and checks it in Chrome on localhost.

Each app is checked for these things.

- The editor appears, and the toolbar follows the website's order.
- Bold, bulleted lists and undo work.
- The toolbar and the text area have their roles and names.
- Pasted HTML runs nothing.
- The toolbar fits one row at phone width.
- The page has no errors.

| App                           | Starter           | Result |
| ----------------------------- | ----------------- | ------ |
| React with TypeScript         | `create-vite`     | Passed |
| React with JavaScript         | `create-vite`     | Passed |
| React in development mode     | `create-vite`     | Passed |
| Vue with TypeScript           | `create-vite`     | Passed |
| Vue with JavaScript           | `create-vite`     | Passed |
| TypeScript                    | `create-vite`     | Passed |
| JavaScript                    | `create-vite`     | Passed |
| Web page with no build step   | None              | Passed |
| Angular                       | `ng new`          | Passed |
| Angular with server rendering | `ng new --ssr`    | Passed |
| Next.js with Tailwind CSS     | `create-next-app` | Passed |
| Nuxt                          | `nuxi init`       | Passed |
| SvelteKit                     | `sv create`       | Passed |

These runs used the froala-editor 5.5.0 package with Vite's older CommonJS behaviour turned on, because they ran before the 5.6.0 package was on npm. Repeat them with `npm run test:apps` on each new release.

## Enhancements, presets and extensions

| Check                                                                           | Result   |
| ------------------------------------------------------------------------------- | -------- |
| Enhancement cases that show the problem without the enhancement and not with it | 19 of 19 |
| Presets that start with every button in the website's order                     | 31 of 31 |
| Extensions that start with their buttons                                        | 10 of 10 |

## Protocol and service

| Check                                                  | Result                                            |
| ------------------------------------------------------ | ------------------------------------------------- |
| Unit tests                                             | 355 passed, with 96 percent of statements covered |
| Official MCP client on the local version               | All checks passed, on Node.js 20 and 24           |
| Official MCP client on the Workers runtime             | All checks passed                                 |
| A browser page on another origin, calling the server   | Passed                                            |
| Package installed from `npm pack` into an empty folder | 5 tools, 0 dependencies                           |

## Questions for agents

`eval/questions.xml` holds ten questions. An AI agent with only the tools answered 10 of 10 correctly in 10 tool calls.

## Agents with and without the server

On 12 October 2026, 14 AI agents added Froala to 7 fresh apps, 7 agents with the server and 7 without it. This run used the earlier eight tools.

| Measure                  | With the server | Without it   |
| ------------------------ | --------------- | ------------ |
| Apps that work in Chrome | 7 of 7          | 7 of 7       |
| Tokens                   | 2.50 million    | 2.93 million |
| Steps                    | 861             | 898          |
| Minutes                  | 232             | 265          |
