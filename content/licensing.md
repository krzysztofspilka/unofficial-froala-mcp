<!--
Returned by the froala_licensing tool (HTML comments are removed first).
Owned by the Froala product team. Keep it short, friendly and factual, and update the dates when you check it again.
Behaviour tested with froala-editor 5.5.0 on 12 October 2026 (Chrome and jsdom). Plans read from the pricing page on 12 October 2026.
-->
# Try Froala for free

You can start right away. While you develop, Froala needs no sign-up and no key.

- **On localhost** (and local test domains such as app.localhost or app.test) the editor works fully, with every bundled plugin. The only sign of the trial is a small "Powered by Froala" line under the editor.
- **On any other domain without a key**, such as a preview deployment or a LAN address, the editor shows a red "unlicensed version" banner. Only bold, italic and underline work; other toolbar buttons say the feature isn't available in the unlicensed version. It also adds a "Powered by Froala Editor" line to the HTML it returns.
- **To try it on a real domain**, get a free 30-day trial key, with every feature unlocked: https://froala.com/get-trial-key/

## When you're ready to ship

Using Froala in production needs a licence. Every plan is a flat price with unlimited editor loads, users and developers.

- **Professional** for internal and mobile apps: one product on up to three domains.
- **Enterprise** for SaaS, OEM and on-premise products: unlimited products and domains.
- **Custom** for negotiated terms.

Plans and prices: https://froala.com/wysiwyg-editor/pricing/ (checked 12 October 2026).

## Where the key goes

Put the trial key or licence key in the `key` setting of the editor.

- **React and Next.js.** In the `config` object of the editor component, for example `key: import.meta.env.VITE_FROALA_KEY` with Vite or `key: process.env.NEXT_PUBLIC_FROALA_KEY` with Next.js.
- **Vue and Nuxt.** In the `config` object of the `<froala>` component. In Nuxt, read it from `useRuntimeConfig().public.froalaKey`.
- **Angular.** In the options object bound to `[froalaEditor]`.
- **Svelte.** In the `config` prop.
- **Plain TypeScript or JavaScript.** In the settings of `new FroalaEditor('#editor', { key: '...' })`.

Keep the key in an environment variable or your app's settings rather than in a public repository. How activation works: https://froala.com/wysiwyg-editor/docs/activation/
