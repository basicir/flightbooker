import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@browser-demo': resolve('src/renderer/src/browserDemo/browserDemoApi.ts'),
      '@dev-tools/main': resolve('src/main/dev/devTools.ts'),
      '@dev-tools/ui': resolve('src/renderer/src/components/devTools.tsx'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
