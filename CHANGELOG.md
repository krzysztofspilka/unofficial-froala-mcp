# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-11-04

### Added

- Add `froala_find_presets`, which searches 31 presets, 89 samples, 6 whitepapers and 10 extensions.
- Add `froala_get_integration`, with guides for Tailwind CSS, TanStack, Salesforce, Next.js, Nuxt and Svelte.
- Add the `froala-enhancements` file to every setup.
- Add `response_format`, `limit` and `offset` to the tools.
- Add browser tests for every enhancement, preset and extension, a fresh-app test for every target, and ten evaluation questions.

### Changed

- Target Froala 5.6.0, with its licence notices, its localhost rule and its Vite 8 fix.
- Use the public trial key in every preset unless the project sets its own key, and never replace a commercial key.
- Build every setup around the Simple preset, with the toolbar order of the Froala website.
- Merge `froala_check_code` and the known issues into `froala_audit_code`.
- Merge documentation search, page reading, API lookup and licensing into `froala_query_docs`.
- Rename the `framework` input to `target`, and name the plain targets `typescript` and `javascript`.
- Refresh the documentation data, and build `docs.json` and `metadata.json` in a staging folder.

### Fixed

- Count every tool call in a batch toward the rate limit, and refuse requests with more than 20 messages.
- Send CORS headers to allowed origins on every response, and answer preflight requests.
- Follow JavaScript scope in the audit, so an unrelated variable cannot replace the real settings.
- Follow real module paths in the Next.js server rendering check.
- Base setup code on the Froala version the install command installs, which removes the import fix from new projects.
- Treat a version range that crosses a compatibility boundary as unknown.
- Return a diagnostic for an `angular.json` with an unexpected shape, and for a broken URL fragment.
- Keep code blocks inside list items whole when a page is split into parts.

## [0.1.0] - 2026-10-12

### Added

- Add the first version of the server.
