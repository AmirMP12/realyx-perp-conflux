import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Coverage instrumentation slows userEvent-driven tests; give them headroom
    // so they don't flakily time out under the default 5s.
    testTimeout: 20000,
  // Coverage + jsdom is memory-heavy; keep a single worker and run files serially.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    env: {
      VITE_WS_URL: 'ws://localhost:3002',
    },
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      clean: true,
      cleanOnRerun: true,
      reporter: ['text', 'html'],
      // Instrument only modules loaded by tests (not the entire include glob).
      all: false,
      include: [
        'src/services/**/*.ts',
        'src/utils/**/*.ts',
        'src/hooks/**/*.ts',
        'src/components/**/*.{ts,tsx}',
        'src/pages/**/*.{ts,tsx}',
        'src/stores/**/*.ts',
        'src/providers/**/*.{ts,tsx}',
        'src/App.tsx',
      ],
      exclude: [
        'node_modules/',
        'src/test/**',
        'src/contracts/**',
        'src/abi/**',
        'src/config/**',
        'src/main.tsx',
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        'src/vite-env.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
