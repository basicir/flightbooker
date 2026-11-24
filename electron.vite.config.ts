import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * A renderer CSP-je élesben `connect-src 'none'`: a felület semmilyen hálózati
 * kapcsolatot nem nyithat (ALP-02). Fejlesztés közben a Vite HMR websocketje
 * miatt csak a helyi dev szerver engedett.
 */
function rendererCsp(): Plugin {
  let isServe = false
  return {
    name: 'flightbooker-renderer-csp',
    configResolved(config) {
      isServe = config.command === 'serve'
    },
    transformIndexHtml(html) {
      const connect = isServe ? "connect-src ws://localhost:* http://localhost:*" : "connect-src 'none'"
      const script = isServe ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
      return html.replace('__CSP_CONNECT_SRC__', connect).replace('__CSP_SCRIPT_SRC__', script)
    },
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@core': resolve('src/core') } },
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@core': resolve('src/core') } },
    plugins: [react(), rendererCsp()],
  },
})
