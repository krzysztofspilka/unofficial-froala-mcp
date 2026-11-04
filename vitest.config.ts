import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'markdown-as-text',
      transform(code, id) {
        if (id.endsWith('.md')) return { code: `export default ${JSON.stringify(code)};`, map: null };
      }
    }
  ],
  test: {
    include: ['test/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/stdio.ts', 'src/**/*.d.ts'],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 }
    }
  }
});
