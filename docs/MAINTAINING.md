# Maintaining the server

This page explains the routine work. Each task ends with `npm test`.

## Add a preset

1. Add an entry to `content/presets.json`. List its `features`, and add `options` and `notes` as needed.
2. If it uses a feature that is new to this server, add the feature to one of the two tables at the top of `src/presets.ts`.
3. Update the number of presets in `README.md`.
4. Run `npm run build` and `node test/browser/presets.mjs`.

The toolbar order comes from `content/toolbar-order.json`, so a preset never sets its own order.

## Add an integration

1. Add a Markdown file to `content/integrations/`. Start it with these fields.

   ```markdown
   ---
   title: Tailwind CSS
   summary: One sentence about what the guide does.
   targets: react, vue
   checked: How the guide was tested.
   ---
   ```

2. Run `npm run build:content`.

The file name becomes the integration name. No code changes are needed.

## Add a known issue

Add an entry to `src/audit/known-issues.ts`. `applies` decides from package.json, and `codeMatch` decides from the code sent. When a Froala release fixes a problem, keep the entry, set `applies` and `affects` to the last version with the problem, and remove its `enhancement` field if the enhancement goes.

## Change the enhancements file

1. Edit `kit/froala-enhancements.ts`. It is the only copy to edit.
2. Run `npm run build:content`, which writes the JavaScript copy.
3. Add a case to `test/browser/enhancements.mjs` that shows the problem without the enhancement.
4. Run `npm run build` and `npm run test:browser`.

## Prepare for a Froala release

1. Update `froala-editor` in `package.json`, run `npm install`, and update the version in `content/release.json`.
2. Run `npm run build:data`. It downloads the docs, builds the metadata in `data/.staging`, checks both files together, and replaces the files in `data/` only if the check passes.
3. Set `FROALA_SITE_DIR` to the froala.com site repository, and run `npm run build:knowledge`. Set it for step 2 as well, so its docs pages are used.
4. Run `npm run build` and `npm run test:browser`. A failed case that says the editor now behaves this way means the enhancement and its case can go.
5. Run `npm run test:apps -- <folder>`, and update `STARTERS` in `src/project.ts` and the table in `README.md` with the versions it reports.
6. Review the `affects` text of the known issues, and update `docs/EVALUATION.md` and `CHANGELOG.md`.

## Release

1. Set the new version in `package.json`, `package-lock.json` and both fields of `server.json`, and date the `CHANGELOG.md` entry.
2. Run the **Publish** workflow on GitHub. It checks the data, runs the tests and publishes to npm.
3. Run `npm run deploy` to update the Cloudflare Workers version. It checks the data first.
