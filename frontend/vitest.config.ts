import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    env: {
      VITE_WS_URL: 'ws://localhost:3002',
    },
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
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
