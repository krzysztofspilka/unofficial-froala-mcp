# Evaluation

These scripts check the server the way people use it. The latest results are in [docs/EVALUATION.md](../docs/EVALUATION.md).

## Fresh apps

`run-apps.mjs` creates a fresh app for every target with its official starter, sends the app's package.json to `froala_get_setup`, installs what it says, writes its files unchanged, and adds only the line that shows the editor. Then it audits the files, builds the app, serves it on localhost, and checks it in Chrome.

```bash
npm run build
npm run test:apps -- ../froala-apps
```

Add app names after the folder to run some of them, for example `npm run test:apps -- ../froala-apps react-ts nuxt`. The names are `react-ts`, `react-js`, `react-dev`, `vue-ts`, `vue-js`, `typescript`, `javascript`, `html-page`, `angular`, `angular-ssr`, `nextjs`, `nuxt` and `svelte`.

The script writes `results.json` and one screenshot for each app.

## Questions

`questions.xml` holds ten questions in the mcp-builder evaluation format. `run-questions.mjs` checks that each answer is in the tool answer named by its check.

```bash
npm run build
npm run test:eval
```

To measure a model, give it the questions and the tools, without the answers, and compare what it returns.

## Call a tool by hand

`scripts/call.mjs` calls one tool from the command line, which also suits agents that can run shell commands and cannot connect to MCP servers.

```bash
node scripts/call.mjs froala_get_setup target=react package_json=@package.json
```

Set `FROALA_MCP_URL` to call a running server, and `FROALA_MCP_LOG` to a file to record each call.
