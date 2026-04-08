import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
      all: false,
      include: [
        'src/services/**/*.ts',
        'src/utils/**/*.ts',
      ],
      exclude: [
        'node_modules/',
        'src/test/setup.ts',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/vite-env.d.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
