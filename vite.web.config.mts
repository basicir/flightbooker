import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Böngészős előnézet a felület fejlesztéséhez: csak a renderert szolgálja ki, a memóriabeli
 * híddal (`@browser-demo`: szintetikus adat, hálózat nélkül). Csak helyi gépen fut, a programba
 * nem kerül.
 */
function devCsp(): Plugin {
  return {
    name: 'flightbooker-web-csp',
    transformIndexHtml: (html) =>
      html.replace('__CSP_CONNECT_SRC__', 'connect-src ws://localhost:* http://localhost:*').replace('__CSP_SCRIPT_SRC__', "script-src 'self' 'unsafe-inline'"),
  }
}

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@browser-demo': resolve('src/renderer/src/browserDemo/browserDemoApi.ts'),
      '@dev-tools/ui': resolve('src/renderer/src/components/devTools.tsx'),
    },
  },
  plugins: [react(), devCsp()],
  server: { host: 'localhost', port: 5199, strictPort: true },
})
