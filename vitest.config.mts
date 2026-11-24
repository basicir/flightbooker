import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@core': resolve('src/core'), '@browser-demo': resolve('src/renderer/src/browserDemo/browserDemoApi.ts') } },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
