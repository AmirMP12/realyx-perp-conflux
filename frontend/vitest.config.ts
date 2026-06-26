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
    // The v8/istanbul coverage providers race on per-worker temp files under
    // parallelism on Windows (intermittent ENOENT on coverage/.tmp). Running
    // test files sequentially makes the coverage merge deterministic.
    fileParallelism: false,
    env: {
      VITE_WS_URL: 'ws://localhost:3002',
    },
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'istanbul',
      // Pre-created coverage/.tmp + clean:false avoids the intermittent Windows
      // ENOENT where the per-file coverage temp dir is removed mid-run.
      clean: false,
      cleanOnRerun: false,
      reporter: ['text', 'json', 'html'],
      all: true,
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
