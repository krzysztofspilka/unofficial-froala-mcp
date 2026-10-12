# Evaluation scripts

How we checked that the MCP helps AI agents, and that its setup code works. The results are in [docs/EVALUATION.md](../docs/EVALUATION.md).

## Check the setup code in fresh apps

`try-setup.mjs` writes the exact output of `froala_get_setup` into a fresh starter app, installs what it says, and adds only the line that shows the editor. Then you build and open the app.

```bash
npm run build                      # build dist/stdio.js first
npm create vite@latest react-app -- --template react-ts && (cd react-app && npm install)
node eval/try-setup.mjs react react-app
cd react-app && npm run build && npx vite preview
```

Frameworks: `react`, `vue`, `angular`, `nextjs`, `nuxt`, `svelte` and `vanilla`. In the browser, check that the editor appears and that bold, lists and the table picker work. Use localhost: without a key, other host names block most toolbar buttons.

The starters we used are listed in [docs/EVALUATION.md](../docs/EVALUATION.md). Angular CLI 22 needs Node 22.22.3, 24.15 or newer.

## Compare agents with and without the MCP

1. Create each starter once and copy it twice, one copy per agent.
2. Run the MCP server with `npm run dev`. Agents that can't connect to MCP servers can call it with `FROALA_MCP_URL=http://localhost:8787/mcp node scripts/call.mjs <tool> name=value`. Set `FROALA_MCP_LOG` to a file to record each call.
3. Give both agents the same task, and give one of them the MCP. Record tokens, tool calls and time.
4. Summarise the transcripts with `python3 eval/analyze-transcripts.py <folder with the agents' .output files>`. Edit the agent ids at the top of the script first.
5. Rebuild every app yourself and open it in a browser on localhost.
