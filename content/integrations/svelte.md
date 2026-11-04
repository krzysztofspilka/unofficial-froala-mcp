---
title: Svelte and SvelteKit
summary: Uses the Svelte wrapper, and turns off server rendering for the route that shows the editor.
targets: svelte
checked: Tested with Svelte 5.57, SvelteKit 3.1 and Froala 5.5.0 in Chrome.
---

# Froala with Svelte

The `svelte-froala-wysiwyg` wrapper needs Svelte 5.

## Set it up

Call `froala_get_setup` with target `svelte`. It gives these files in `src/lib/froala/`.

| File                  | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `froala-enhancements` | Adds safe pasting, keyboard access and screen reader names |
| `froala-preset`       | Holds the plugins, the CSS and the settings                |
| `FroalaEditor.svelte` | Renders the editor                                         |

In a TypeScript project it also adds `src/froala.d.ts`, because the wrapper ships without types.

## SvelteKit

SvelteKit renders pages on the server, and Froala needs the browser. Turn server rendering off for the route that shows the editor, in its `+page.ts` or `+layout.ts`.

```ts
export const ssr = false;
```

SvelteKit 3 renamed the `$lib` alias to `#lib`.

```svelte
<script lang="ts">
  import FroalaEditor from '#lib/froala/FroalaEditor.svelte';
</script>

<FroalaEditor />
```

## The licence key

Set your licence key as `VITE_FROALA_KEY` in `.env`. The preset uses the public trial key until you do.
