---
title: Next.js
summary: Runs the editor in a client component that loads without server rendering.
targets: nextjs
checked: Tested with Next.js 16.4, React 19.3 and Froala 5.5.0 in Chrome.
---

# Froala with Next.js

Next.js renders client components on the server once, and Froala needs the browser. Importing it in a `'use client'` file is not enough, because `next build` then fails with `ReferenceError: Element is not defined`.

## Set it up

Call `froala_get_setup` with target `nextjs`. It gives four files in `app/froala/`.

| File                  | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `froala-enhancements` | Adds safe pasting, keyboard access and screen reader names |
| `froala-preset`       | Holds the plugins, the CSS and the settings                |
| `FroalaEditorClient`  | The client component that renders the editor               |
| `FroalaEditor`        | Loads `FroalaEditorClient` with `ssr: false`               |

Import `FroalaEditor`, never `FroalaEditorClient`, in your pages.

```tsx
import FroalaEditor from './froala/FroalaEditor';

export default function Page() {
  return <FroalaEditor />;
}
```

## The rules that keep the build working

- Keep every import of `froala-editor` and `react-froala-wysiwyg` in files that only `FroalaEditorClient` reaches.
- Call `dynamic()` with `ssr: false` in a file that starts with `'use client'`. Next.js rejects it in a Server Component.
- Set your licence key in `NEXT_PUBLIC_FROALA_KEY`. The preset uses the public trial key until you do.

## Tailwind CSS

`create-next-app` adds Tailwind by default, and its preflight removes list bullets and heading sizes in the editor. `froala_get_setup` adds `froala-content.css` when package.json lists `tailwindcss`.

## Pages Router

Put the folder in `components/`. `next/dynamic` with `ssr: false` works the same way.
