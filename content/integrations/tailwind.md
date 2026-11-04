---
title: Tailwind CSS
summary: Keeps list bullets, heading sizes and margins inside the editor when Tailwind's preflight is on.
targets: react, vue, angular, nextjs, nuxt, svelte, typescript, javascript
checked: Tested with Tailwind CSS 4 and Froala 5.5.0 in Chrome.
---

# Froala with Tailwind CSS

Tailwind's preflight removes list bullets, heading sizes and margins from every element on the page. The editor needs them, so its content looks unstyled until they come back.

## Add the styles

Create `froala-content.css` next to your other Froala files.

```css
.fr-view :where(h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote, pre, hr, a) {
  margin: revert;
  padding: revert;
  font-size: revert;
  font-weight: revert;
  list-style: revert;
  text-decoration: revert;
}
```

Import it after Froala's CSS. In React, Vue, TypeScript and JavaScript projects, add the import to `froala-preset`.

```ts
import './froala-content.css';
```

In an Angular project, add the file to the `styles` list in `angular.json`, after Froala's CSS.

`froala_get_setup` adds this file for you when package.json lists `tailwindcss`.

## Show saved content

The same styles apply to saved content, because it also uses the `fr-view` class.

```html
<div class="fr-view"><!-- the saved HTML --></div>
```

## Use Tailwind classes in the content

To give people Tailwind styles inside the text, list the classes in `paragraphStyles` or `inlineClasses`. Tailwind only generates classes it finds in your source files, so keep these class names in your code.

```ts
const froalaConfig = {
  paragraphStyles: { 'text-lg font-semibold': 'Lead paragraph' },
  inlineClasses: { 'bg-yellow-100': 'Highlight' }
};
```

These settings need the `paragraphStyle` and `inlineClass` plugins, and the `paragraphStyle` and `inlineClass` toolbar buttons.
