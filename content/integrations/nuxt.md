---
title: Nuxt
summary: Registers the wrapper in a client-only plugin and keeps the editor out of server rendering.
targets: nuxt
checked: Tested with Nuxt 4.6, Vue 3.5 and Froala 5.5.0 in Chrome.
---

# Froala with Nuxt

Nuxt renders pages on the server, and Froala needs the browser. Everything that loads Froala goes in a plugin that ends in `.client`, and the component wraps the editor in `<ClientOnly>`.

## Set it up

Call `froala_get_setup` with target `nuxt`. It gives these files.

| File                              | What it does                                                               |
| --------------------------------- | -------------------------------------------------------------------------- |
| `app/froala/froala-enhancements`  | Adds safe pasting, keyboard access and screen reader names                 |
| `app/froala/froala-config`        | Holds the settings, with no Froala import, so the server can read it       |
| `app/plugins/froala.client`       | Loads Froala, its plugins and CSS in the browser, and registers `<froala>` |
| `app/components/FroalaEditor.vue` | Renders the editor inside `<ClientOnly>`                                   |

Nuxt imports components for you, so use `<FroalaEditor />` in any page.

## The licence key

The preset uses the public trial key until you set your own. Add the key to the runtime config, and set `NUXT_PUBLIC_FROALA_KEY` in `.env`.

```ts
export default defineNuxtConfig({
  runtimeConfig: { public: { froalaKey: '' } }
});
```

## Nuxt 4.5 and newer

These versions use Vite 8. With Froala 5.5.0 or older, the build passes and the page shows an inert `<froala>` element. Froala 5.6.0 fixes this, so upgrade both Froala packages together.

## Nuxt 3

Nuxt 3 keeps `plugins` and `components` at the top level. `froala_get_setup` follows the version in package.json.
