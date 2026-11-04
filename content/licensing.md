# Build with Froala

You can start right away, with no sign-up. Every feature works with any key, and with no key at all. The key only decides which notice the editor shows.

## The public trial key

Froala has a public trial key for evaluation.

```text
TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE
```

The presets from `froala_get_setup` use this key unless you set your own, so the key is never missing. It works on every host, it shows the trial notice, and it is not for production. Never use it in place of a commercial key, even an expired one.

## What the editor shows

The notice sits next to the "Powered by Froala" line, and the same text appears once in the browser console. It looks the same on localhost and on a public site.

| Key         | Notice                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| No key      | The license key for Froala Editor is missing. To evaluate, use the trial key. To buy a license, go to froala.com.    |
| Trial key   | You are using a 30-day trial version of Froala Editor, which is not for production use. Buy a license at froala.com. |
| Invalid key | The license key for Froala Editor is invalid. Make sure to use the trial key or buy a license.                       |
| Expired key | The license key for Froala Editor expired, please renew at froala.com or contact our sales team.                     |
| Valid key   | No notice.                                                                                                           |

- A term key keeps a clean editor for 15 days after it expires. After that it shows the expired notice.
- An expired key shows the same notice on localhost and on a hosted site.
- The editor checks that its notice stays visible, so do not hide it with CSS.

These rules apply from Froala 5.6.0. Froala 5.5.0 and older show a red unlicensed banner on hosted sites, and only bold, italic and underline work there without a key.

## When you are ready to ship

Using Froala in production needs a licence. Every plan is a flat price with unlimited editor loads, users and developers.

- **Professional** for internal and mobile apps, with one product on up to three domains.
- **Enterprise** for SaaS, OEM and on-premise products, with unlimited products and domains.
- **Custom** for negotiated terms.

Plans and prices are at https://froala.com/wysiwyg-editor/pricing/ (checked 12 October 2026). To buy a licence, go to https://cart.froala.com, and to renew one, contact sales at https://froala.com/wysiwyg-editor/contact/?department=sales

## Where your key goes

Set your licence key in an environment variable. The presets read it first, and use the trial key only when it is empty.

| Project                                                | Where the key goes                       |
| ------------------------------------------------------ | ---------------------------------------- |
| React, Vue, Svelte, TypeScript or JavaScript with Vite | `VITE_FROALA_KEY` in `.env`              |
| Next.js                                                | `NEXT_PUBLIC_FROALA_KEY` in `.env.local` |
| Nuxt                                                   | `NUXT_PUBLIC_FROALA_KEY` in `.env`       |
| Angular                                                | The `key` setting in `froala-preset.ts`  |
| A web page with no build step                          | The `key` setting in `index.html`        |

If a project already sets a key, keep it. How activation works is at https://froala.com/wysiwyg-editor/docs/activation/
