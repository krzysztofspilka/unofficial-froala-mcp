// ESLint checks the JavaScript files. The TypeScript files are checked by tsc, with the strict settings in tsconfig.json.
import js from '@eslint/js';

export default [
  { ignores: ['dist', 'node_modules', 'coverage', 'data', '.wrangler'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        Buffer: 'readonly',
        window: 'readonly',
        document: 'readonly',
        FroalaEditor: 'readonly',
        DataTransfer: 'readonly',
        ClipboardEvent: 'readonly',
        getComputedStyle: 'readonly'
      }
    }
  }
];
