# Froala Rich Text Editor - MCP Server

An MCP server for the [Froala rich text editor](https://froala.com/wysiwyg-editor/). It gives AI coding assistants tested setup code, ready-made presets, a code audit and the official Froala documentation, which makes rich text editing easy to add to an application in the framework of your choice or in plain TypeScript or JavaScript.

This is an early release. Please report any issues to support@froala.com. Thank you for your help.

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=froala&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmcm9hbGEvbWNwIl19)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=froala&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40froala%2Fmcp%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=froala&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40froala%2Fmcp%22%5D%7D&quality=insiders)

## Supported projects

The server targets Froala 5.6.0.

| Project    | `target`     | Tested with                                           |
| ---------- | ------------ | ----------------------------------------------------- |
| React      | `react`      | React 19.3 and Vite 8.3, in TypeScript and JavaScript |
| Vue        | `vue`        | Vue 3.5 and Vite 8.3, in TypeScript and JavaScript    |
| Angular    | `angular`    | Angular 22.2, with and without server rendering       |
| Next.js    | `nextjs`     | Next.js 16.4 and Tailwind CSS 4                       |
| Nuxt       | `nuxt`       | Nuxt 4.6                                              |
| Svelte     | `svelte`     | Svelte 5.57 and SvelteKit 3.1                         |
| TypeScript | `typescript` | TypeScript 7.0 and Vite 8.3                           |
| JavaScript | `javascript` | Vite 8.3, or a web page with no build step            |

## What a first setup gives you

Every new project starts from the Simple preset, which uses the toolbar of the Froala website with undo and redo first.

| File                           | Purpose                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `froala-enhancements`          | Adds safe pasting, keyboard access to the toolbar, screen reader names and clear upload messages to every editor |
| `froala-preset`                | Holds the plugins, the CSS, the editor settings and the trial key                                                |
| A component for your framework | Shows the editor                                                                                                 |

## Tools

| Tool                     | Purpose                                                                                           | Main inputs                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `froala_get_setup`       | Returns the install command and the files for your project                                        | `target`, `package_json`, `preset`          |
| `froala_find_presets`    | Searches 31 presets, 89 samples, 6 whitepapers and 10 extensions                                  | `query`, `id`, `target`                     |
| `froala_audit_code`      | Finds common mistakes, and returns the known issues that apply to your versions with tested fixes | `files`, `package_json`, `symptom`, `issue` |
| `froala_query_docs`      | Looks up API names, searches and reads the documentation, and explains licensing                  | `mode`, `query`, `kind`, `names`, `url`     |
| `froala_get_integration` | Returns guides for Tailwind CSS, TanStack, Salesforce, Next.js, Nuxt and Svelte                   | `name`, `target`                            |

Two prompts are also available. `add-froala` adds Froala to a project, and `review-froala` reviews existing code.

## Example requests

- Add the Froala editor to this project.
- Add a comment box with a 1,000 character limit.
- The page is blank since I added Froala. Find out why.

To make an assistant use the server every time, add this line to your project rules, for example in `CLAUDE.md`.

```text
When you work with the Froala editor, use the Froala MCP tools instead of writing code from memory.
```

## Run the server locally

The npm package requires Node.js 20 or newer. For example, run `claude mcp add froala -- npx -y @froala/mcp`, or add the following to a JSON configuration file.

```json
{
  "mcpServers": {
    "froala": { "command": "npx", "args": ["-y", "@froala/mcp"] }
  }
}
```

## Build with Froala

- Every feature works with any key, on every host. The key only decides which notice the editor shows next to the "Powered by Froala" line.
- Every preset uses the public trial key `TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE` unless you set your own key, so the key is never missing. The trial key is not for production.
- A commercial key always takes priority. The server never replaces one, even if it has expired.
- `froala_query_docs` in `licensing` mode explains every notice and where the key belongs in each framework, and the [activation guide](https://froala.com/wysiwyg-editor/docs/activation/) describes how keys work.

## Limits and privacy

- `froala_audit_code` accepts up to 20 files and 200,000 characters, and returns up to 60 findings.
- Each answer is limited to 30,000 characters. Long pages arrive in parts, and long lists arrive in pages.
- The server requires no account or API key, reads only the data that ships with it, and never changes your files.

## Development

```bash
npm install
npm test
npm run build
npm run smoke
```

[CONTRIBUTING.md](CONTRIBUTING.md) explains the project, and [docs/MAINTAINING.md](docs/MAINTAINING.md) explains the routine work. Test results are in [docs/EVALUATION.md](docs/EVALUATION.md).

## Bugs, security and license

Please report bugs to support@froala.com, and security issues as described in [SECURITY.md](SECURITY.md).

The Froala MCP server, like the Froala editor, is subject to the Froala [license terms](https://froala.com/wysiwyg-editor/terms/). See [LICENSE](LICENSE).
