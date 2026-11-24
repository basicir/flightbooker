import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Böngészős bemutató a felület fejlesztéséhez: csak a renderert szolgálja ki, a
 * memóriabeli bemutató-híddal (szintetikus adat, hálózat nélkül). Csak helyi gépen fut.
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
  resolve: { alias: { '@core': resolve('src/core') } },
  plugins: [react(), devCsp()],
  server: { host: 'localhost', port: 5199, strictPort: true },
})
