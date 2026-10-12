// Bundles the local version (npx @froala/mcp) into one file: dist/stdio.js.
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

await build({
  entryPoints: ['src/stdio.ts'],
  outfile: 'dist/stdio.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  loader: { '.md': 'text' },
  legalComments: 'none',
  // Some bundled dependencies use require(); give them one in the ES module output.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" }
});
chmodSync('dist/stdio.js', 0o755);
console.log('Built dist/stdio.js');
